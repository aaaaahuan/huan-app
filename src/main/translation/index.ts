import { studyRequestSchema, lessonSchema, gradeSchema, vocabularySchema, type StudyResult, type StudyRequest } from '@shared/contracts/english-study';
import { createSpeechPlayback } from './speech';
import { readVocabulary, saveVocabulary, vocabularyKey } from './vocabulary';
import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { translationRequestSchema, lookupRequestSchema, speechRequestSchema, type TranslationResult } from '@shared/contracts/translation';
import type { AgentHandle } from '@main/ai/agent/agent';
import type { TranslateToolContext } from '@main/ai/agent/translate-agent';
import { errorText, type createLocalModelRuntime } from '@main/ai/core/local-model';

// 翻译作为独立 Run 执行，保留原有单请求和停止语义。
export function registerTranslation(contents: WebContents, assertTrusted: (event: IpcMainInvokeEvent) => void,
  local: ReturnType<typeof createLocalModelRuntime>, agent: AgentHandle<TranslateToolContext>, lookupAgent: AgentHandle<TranslateToolContext>) {

  type Run = { requestId: string; controller: AbortController };
  type Slot = { active?: Run; agent: AgentHandle<TranslateToolContext> };
  const primary: Slot = { agent };
  const lookup: Slot = { agent: lookupAgent };
  const speech = createSpeechPlayback();
  let closed = false;

  async function translate(input: unknown, task?: StudyRequest['task'], reserved?: Run, slot = primary): Promise<TranslationResult> {
    let run: Run | undefined;
    try {
      const request = (slot === lookup && !task ? lookupRequestSchema : translationRequestSchema).parse(input);
      if (closed) throw new Error('翻译服务已关闭。');
      if (slot.active && slot.active !== reserved) throw new Error('已有翻译请求正在处理，请先停止或等待完成。');
      run = reserved ?? { requestId: request.requestId, controller: new AbortController() };
      slot.active = run;
      const result = await slot.agent.execute({
        runId: request.requestId, prompt: request.text, toolContext: { direction: request.direction, task }
      }, { signal: run.controller.signal });
      if (run.controller.signal.aborted) return { status: 'stopped', text: '', metrics: result.metrics };
      let final = result.messages.at(-1);
      if (final?.role !== 'assistant') final = [...result.messages].reverse().find(message => message.role === 'assistant');
      const text = final?.role === 'assistant'
        ? final.content.filter(block => block.type === 'text').map(block => block.text).join('') : '';
      const status: TranslationResult['status'] = result.status === 'aborted' || (final?.role === 'assistant' && final.stopReason === 'aborted')
        ? 'stopped' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'length'
          ? 'truncated' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'stop' && text.trim()
            ? 'complete' : 'failed';
      return { status, text, metrics: result.metrics, error: status === 'truncated' ? 'finish_reason=length（引擎未完整生成译文）'
        : status === 'failed' ? (final?.role === 'assistant' ? final.errorMessage : undefined) ??
          result.warning ?? result.failure?.code ?? '模型未返回有效译文。' : undefined };
    } catch (error) {
      if (run?.controller.signal.aborted) return { status: 'stopped', text: '' };
      return { status: 'failed', text: '', error: errorText(error) };
    } finally { if (!reserved && run && slot.active === run) slot.active = undefined; }
  }

  ipcMain.handle(IPC_CHANNELS.translation.vocabulary, event => { assertTrusted(event); return readVocabulary(); });
  ipcMain.handle(IPC_CHANNELS.translation.study, async (event, input: unknown): Promise<StudyResult> => {
    assertTrusted(event);
    let run: Run | undefined;
    let slot = primary;
    try {
      const request = studyRequestSchema.parse(input);
      if (closed) throw new Error('翻译服务已关闭。');
      slot = request.task === 'vocabulary' ? lookup : primary;
      if (slot.active) throw new Error('已有翻译请求正在处理，请先停止或等待完成。');
      run = { requestId: request.requestId, controller: new AbortController() };
      slot.active = run;
      if (request.task === 'vocabulary') {
        const existing = await readVocabulary();
        run.controller.signal.throwIfAborted();
        if (existing.cards.some(card => vocabularyKey(card.word) === vocabularyKey(request.source)))
          return { status: 'complete', saved: 'exists' };
      }
      const result = await translate({ requestId: request.requestId, direction: 'zh-en',
        text: JSON.stringify({ source: request.source, answer: request.answer, context: request.context }) }, request.task, run, slot);
      if (result.status === 'stopped') return { status: 'stopped' };
      if (result.status !== 'complete') return { status: 'failed', error: result.error ?? '模型未完整返回结果，请重试。' };
      let data: unknown;
      try { data = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
      catch { throw new Error('模型返回的格式不完整，请重试或切换模型。'); }
      if (request.task === 'lesson') return { status: 'complete', metrics: result.metrics, lesson: lessonSchema.parse(data) };
      if (request.task === 'grade') return { status: 'complete', metrics: result.metrics, grade: gradeSchema.parse(data) };
      // 词条标题由已校验的用户选择固定，模型只负责其余字段。
      const entry = vocabularySchema.parse({ ...(data && typeof data === 'object' ? data : {}), word: request.source });
      return { status: 'complete', metrics: result.metrics, saved: await saveVocabulary(entry, request.context ?? request.source, run.controller.signal) };
    } catch (error) {
      if (run?.controller.signal.aborted) return { status: 'stopped' };
      return { status: 'failed', error: error instanceof z.ZodError ? '请求或模型返回的字段不完整，请检查输入后重试，或切换模型。' : errorText(error) };
    } finally { if (run && slot.active === run) slot.active = undefined; }
  });

  ipcMain.handle(IPC_CHANNELS.translation.speak, (event, input: unknown) => {
    assertTrusted(event); return speech.speak(speechRequestSchema.parse(input));
  });
  ipcMain.handle(IPC_CHANNELS.translation.stopSpeech, (event, input: unknown) => {
    assertTrusted(event); speech.stop(z.uuid().parse(input));
  });
  ipcMain.handle(IPC_CHANNELS.translation.lookup, (event, input: unknown) => {
    assertTrusted(event); return translate(input, undefined, undefined, lookup);
  });
  ipcMain.handle(IPC_CHANNELS.translation.getStatus, event => { assertTrusted(event); return local.status(); });
  ipcMain.handle(IPC_CHANNELS.translation.translate, (event, input: unknown) => { assertTrusted(event); return translate(input); });
  ipcMain.handle(IPC_CHANNELS.translation.stop, (event, input: unknown) => {
    assertTrusted(event);
    const requestId = z.uuid().parse(input);
    for (const slot of [primary, lookup]) {
      if (slot.active?.requestId === requestId) slot.active.controller.abort('USER_STOP');
    }
  });
  ipcMain.handle(IPC_CHANNELS.translation.copy, (event, text: unknown) => { assertTrusted(event); clipboard.writeText(z.string().parse(text)); });
  const cancelAll = () => {
    for (const slot of [primary, lookup]) slot.active?.controller.abort('USER_STOP');
    speech.stop();
  };
  contents.on('did-start-navigation', event => {
    if (event.isMainFrame && !event.isSameDocument) cancelAll();
  });
  contents.on('render-process-gone', cancelAll);
  return { hasWork: () => !!primary.active || !!lookup.active || speech.hasWork(), close() { closed = true; cancelAll(); speech.close(); } };
}
