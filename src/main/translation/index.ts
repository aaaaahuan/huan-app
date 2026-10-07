import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { translationRequestSchema, type TranslationResult } from '@shared/contracts/translation';
import type { ModelTarget } from '@shared/contracts/models';
import type { createAIRuntime } from '@main/ai/runtime';
import { errorText, type createLocalModelRuntime } from '@main/ai/local-model';

// 翻译只调用一次模型，不进入 Agent 工具循环；与聊天共用 Provider 和 Worker。
export function registerTranslation(contents: WebContents, assertTrusted: (event: IpcMainInvokeEvent) => void,
  local: ReturnType<typeof createLocalModelRuntime>, runtime: ReturnType<typeof createAIRuntime>,
  getTarget: (signal: AbortSignal) => Promise<ModelTarget>) {
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
      const target = await getTarget(run.controller.signal);
      run.controller.signal.throwIfAborted();
      let answer: TranslationResult | undefined;
      await runtime.start({ type: 'translate', instanceId: randomUUID(), ...request, target }, run.controller.signal, event => {
        if (event.type === 'settled') answer = { status: event.status === 'generating' ? 'failed' : event.status, text: event.text, error: event.error };
      });
      if (run.controller.signal.aborted) return { status: 'stopped', text: '' };
      return answer ?? { status: 'failed', text: '', error: '模型请求未确认结束。' };
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
