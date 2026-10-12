import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { AIResult } from '@shared/contracts/ai';
import { modelSelectionSchema } from '@shared/contracts/models';
import type { createSettingsStore } from '@main/settings/store';
import type { AgentHandle } from '@main/ai/agent/agent';

export function registerModelControls(window: BrowserWindow, settings: ReturnType<typeof createSettingsStore>,
  assertTrusted: (event: IpcMainInvokeEvent) => void,
  keyTestAgent: AgentHandle<Record<string, never>>, keyTestKeys: Map<string, string>) {
  async function result<T>(operation: () => T | Promise<T>): Promise<AIResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '操作失败，请重试。' }; }
  }

  ipcMain.handle(IPC_CHANNELS.ai.getSelection, event => {
    assertTrusted(event);
    return result(async () => {
      const current = await settings.load();
      if (!current.ok) throw new Error(current.message);
      return current.settings.model;
    });
  });
  ipcMain.handle(IPC_CHANNELS.ai.selectModel, (event, input: unknown) => {
    assertTrusted(event);
    return result(async () => {
      const selection = modelSelectionSchema.parse(input);
      const current = await settings.load();
      if (!current.ok) throw new Error(current.message);
      const saved = await settings.save({ ...current.settings, model: selection }, current.revision);
      if (!saved.ok) throw new Error(saved.message);
      return saved.settings.model;
    });
  });

  let testing = false;
  
  ipcMain.handle(IPC_CHANNELS.ai.testKey, (event, input: unknown) => {
    assertTrusted(event);
    return result(async () => {
      if (testing) throw new Error('连接测试正在进行。');
      const supplied = z.string().max(512).parse(input).trim();
      testing = true;
      try {
        const answer = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '测试连接'], defaultId: 0,
          cancelId: 0, message: '测试 DeepSeek 连接？', detail: '会发送一条不含页面内容的短请求，可能产生少量费用。' });
        if (answer.response !== 1) return '已取消测试。';
        const key = supplied || await settings.getKey();
        const runId = randomUUID();
        keyTestKeys.set(runId, key);
        try {
          const execution = await keyTestAgent.execute({
            runId, prompt: 'Reply OK.', toolContext: {}
          }, { signal: AbortSignal.timeout(20000) });
          if (execution.status === 'completed') return '连接成功。测试没有保存未保存的 API Key。';
          if (execution.failure?.httpStatus)
            throw new Error('DeepSeek 返回 HTTP ' + execution.failure.httpStatus + '，请检查 Key、额度或稍后再试。');
          throw new Error('无法连接 DeepSeek，请检查网络；未自动重试。');
        } finally {
          keyTestKeys.delete(runId);
        }
      } finally { testing = false; }
    });
  });
}
