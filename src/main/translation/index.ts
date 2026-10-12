import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { translationRequestSchema, type TranslationResult } from '@shared/contracts/translation';
import type { AgentHandle } from '@main/ai/agent/agent';
import type { TranslateToolContext } from '@main/ai/agent/translate-agent';
import { errorText, type createLocalModelRuntime } from '@main/ai/core/local-model';

// 翻译作为独立 Run 执行，保留原有单请求和停止语义。
export function registerTranslation(contents: WebContents, assertTrusted: (event: IpcMainInvokeEvent) => void,
  local: ReturnType<typeof createLocalModelRuntime>, agent: AgentHandle<TranslateToolContext>) {

  let active: { requestId: string; controller: AbortController } | undefined;
  let closed = false;

  async function translate(input: unknown): Promise<TranslationResult> {
    let run: typeof active;
    try {
      const request = translationRequestSchema.parse(input);
      if (closed) throw new Error('翻译服务已关闭。');
      if (active) throw new Error('已有翻译请求正在处理，请先停止或等待完成。');
      run = { requestId: request.requestId, controller: new AbortController() };
      active = run;
      const result = await agent.execute({
        runId: request.requestId, prompt: request.text, toolContext: { direction: request.direction }
      }, { signal: run.controller.signal });
      if (run.controller.signal.aborted) return { status: 'stopped', text: '' };
      let final = result.messages.at(-1);
      if (final?.role !== 'assistant') final = [...result.messages].reverse().find(message => message.role === 'assistant');
      const text = final?.role === 'assistant'
        ? final.content.filter(block => block.type === 'text').map(block => block.text).join('') : '';
      const status: TranslationResult['status'] = result.status === 'aborted' || (final?.role === 'assistant' && final.stopReason === 'aborted')
        ? 'stopped' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'length'
          ? 'truncated' : result.status === 'completed' && final?.role === 'assistant' && final.stopReason === 'stop' && text.trim()
            ? 'complete' : 'failed';
      return { status, text, error: status === 'truncated' ? 'finish_reason=length（引擎未完整生成译文）'
        : status === 'failed' ? (final?.role === 'assistant' ? final.errorMessage : undefined) ??
          result.failure?.code ?? '模型未返回有效译文。' : undefined };
    } catch (error) {
      if (run?.controller.signal.aborted) return { status: 'stopped', text: '' };
      return { status: 'failed', text: '', error: errorText(error) };
    } finally { if (run && active === run) active = undefined; }
  }

  ipcMain.handle(IPC_CHANNELS.translation.getStatus, event => { assertTrusted(event); return local.status(); });
  ipcMain.handle(IPC_CHANNELS.translation.translate, (event, input: unknown) => { assertTrusted(event); return translate(input); });
  ipcMain.handle(IPC_CHANNELS.translation.stop, (event, input: unknown) => {
    assertTrusted(event);
    const requestId = z.uuid().parse(input);
    if (active?.requestId === requestId) active.controller.abort('USER_STOP');
  });
  ipcMain.handle(IPC_CHANNELS.translation.copy, (event, text: unknown) => { assertTrusted(event); clipboard.writeText(z.string().parse(text)); });
  contents.on('did-start-navigation', event => {
    if (event.isMainFrame && !event.isSameDocument) active?.controller.abort('USER_STOP');
  });
  contents.on('render-process-gone', () => active?.controller.abort('USER_STOP'));
  return { hasWork: () => !!active, close() { closed = true; active?.controller.abort('USER_STOP'); } };
}
