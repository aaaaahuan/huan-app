import { recordTranslation } from './history';
import { studyRequestSchema, lessonSchema, gradeSchema, vocabularySchema, type StudyResult, type StudyRequest } from '@shared/contracts/english-study';
import { createSpeechPlayback } from './speech';
import { readVocabulary, saveVocabulary, vocabularyKey } from './vocabulary';
import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { translationRequestSchema, lookupRequestSchema, speechRequestSchema, translatedContentSchema, type TranslationResult } from '@shared/contracts/translation';
import type { AgentHandle } from '@main/ai/agent/agent';
import type { TranslateToolContext } from '@main/ai/agent/translate-agent';
import { errorText, type createLocalModelRuntime } from '@main/ai/core/local-model';

// 翻译作为独立 Run 执行，保留原有单请求和停止语义。
export function registerTranslation(contents: WebContents, assertTrusted: (event: IpcMainInvokeEvent) => void,
  local: ReturnType<typeof createLocalModelRuntime>, agent: AgentHandle<TranslateToolContext>, lookupAgent: AgentHandle<TranslateToolContext>) {

  type Run = { requestId: string; controller: AbortController; settled?: Promise<void> };
  type Slot = { active?: Run; agent: AgentHandle<TranslateToolContext> };
  const primary: Slot = { agent };
  const lookup: Slot = { agent: lookupAgent };
  const speech = createSpeechPlayback();
  let closed = false;

  async function translate(input: unknown, task?: StudyRequest['task'], reserved?: Run, slot = primary): Promise<TranslationResult> {
    let run: Run | undefined;
    let query: import('@shared/contracts/translation').LookupRequest | undefined;
    let outcome: TranslationResult | undefined;
    let release: (() => void) | undefined;
    try {
      const request = (slot === lookup && !task ? lookupRequestSchema : translationRequestSchema).parse(input);
      if (!task) query = request;
      if (slot.active?.controller.signal.aborted) await slot.active.settled;
      if (closed) throw new Error('翻译服务已关闭。');
      if (slot.active && !slot.active.controller.signal.aborted && slot.active !== reserved) throw new Error('已有翻译请求正在处理，请先停止或等待完成。');
      run = reserved ?? { requestId: request.requestId, controller: new AbortController() };
      if (!reserved) run.settled = new Promise<void>(resolve => { release = resolve; });
      slot.active = run;
      const contextualLookup = slot === lookup && !task;
      // 上下文只供选中翻译消歧，不改变普通翻译及学习任务的输入格式。
      const prompt = contextualLookup
        ? JSON.stringify({ text: request.text, context: query?.source?.context ?? '' }) : request.text;
      const result = await slot.agent.execute({
        runId: request.requestId, prompt, toolContext: { direction: request.direction, task, contextualLookup }
      }, { signal: run.controller.signal });
      if (run.controller.signal.aborted) { outcome = { status: 'stopped', text: '', metrics: result.metrics }; return outcome; }
      let final = result.messages.at(-1);
      if (final?.role !== 'assistant') final = [...result.messages].reverse().find(message => message.role === 'assistant');
      const text = final?.role === 'assistant'
        ? final.content.filter(block => block.type === 'text').map(block => block.text).join('') : '';
      const status: TranslationResult['status'] = result.status === 'aborted' || (final?.role === 'assistant' && final.stopReason === 'aborted')
        ? 'stopped' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'length'
          ? 'truncated' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'stop' && text.trim()
            ? 'complete' : 'failed';
      outcome = { status, text, metrics: result.metrics, warning: result.record.state !== 'complete' ? 'AI 执行记录不完整。' : undefined, error: status === 'truncated' ? 'finish_reason=length（引擎未完整生成译文）'
        : status === 'failed' ? (final?.role === 'assistant' ? final.errorMessage : undefined) ??
          result.warning ?? result.failure?.code ?? '模型未返回有效译文。' : undefined };
      if (!task && status === 'complete') {
        try {
          const content = translatedContentSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
          outcome.text = content.text;
          outcome.phonetic = content.phonetic;
          outcome.contextualText = content.contextualText;
        } catch {
          outcome.phonetic = '';
        }
      } else if (!task) {
        // 截断的 JSON 不能作为译文展示或被复制。
        outcome.text = '';
      }
      return outcome;
    } catch (error) {
      outcome = run?.controller.signal.aborted ? { status: 'stopped', text: '' } : { status: 'failed', text: '', error: errorText(error) };
      return outcome;
    } finally {
      if (!reserved && run && slot.active === run) slot.active = undefined;
      release?.();
      if (query) {
        try { await recordTranslation(query, outcome ?? { status: run?.controller.signal.aborted ? 'stopped' : 'failed', text: '' }); }
        catch { if (outcome) outcome.warning = '查询记录保存失败，本次查询未完整归档。'; }
      }
    }
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
  return { lookup: (input: unknown) => translate(input, undefined, undefined, lookup), stop(requestId: string) { if (lookup.active?.requestId === requestId) lookup.active.controller.abort('USER_STOP'); }, hasWork: () => !!primary.active || !!lookup.active || speech.hasWork(), close() { closed = true; cancelAll(); speech.close(); } };
}
