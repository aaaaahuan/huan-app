import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { ownerSchema, sendSchema, type AIResult } from '@shared/contracts/ai';
import type { PageContext } from '@shared/contracts/page-context';
import type { createPageHost } from '@main/browser/page-host';
import type { createSettingsStore } from '@main/settings/store';
import { createConversations } from './conversations';

export function registerAI(window: BrowserWindow, host: ReturnType<typeof createPageHost>, settings: ReturnType<typeof createSettingsStore>,
  assertTrusted: (event: IpcMainInvokeEvent) => void) {

  const chat = createConversations(settings.getKey, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.ai.state, state);
  });

  // 发送时冻结快照；授权期间切页不改变本轮上下文，也不等待页面提取。
  const pageContext = (snapshot: PageContext) => async (signal: AbortSignal) => {
    if (!snapshot.pages.length) return undefined;
    signal.throwIfAborted();
    const result = await settings.load();
    if (!result.ok) throw new Error(result.message);
    if (result.settings.ai.consentVersion !== 2) {
      const answer = await dialog.showMessageBox(window, { type: 'question', signal, buttons: ['不附带页面', '允许附带'],
        defaultId: 0, cancelId: 0, message: '允许向 DeepSeek 发送阅读材料？',
        detail: '将向 DeepSeek 提供本次应用运行中缓存的页面目录，并允许 AI 按需读取这些页面的正文。可能计费和留存；不允许时仍可仅发送问题。' });
      if (answer.response !== 1) throw new Error('未授权发送页面材料。');
      signal.throwIfAborted();
      await settings.allowMaterials();
    }
    signal.throwIfAborted();
    return snapshot;
  };
  async function result<T>(operation: () => T | Promise<T>): Promise<AIResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '操作失败，请重试。' }; }
  }
  ipcMain.handle(IPC_CHANNELS.ai.get, (event, id: unknown) => {
    assertTrusted(event);
    return result(() => chat.get(ownerSchema.shape.key.parse(id)));
  });
  for (const command of ['stop', 'restart'] as const) {
    ipcMain.handle(IPC_CHANNELS.ai[command], (event, owner: unknown) => {
      assertTrusted(event); return result(() => chat[command](ownerSchema.parse(owner)));
    });
  }
  ipcMain.handle(IPC_CHANNELS.ai.draft, (event, owner: unknown, text: unknown) => {
    assertTrusted(event); return result(() => chat.draft(ownerSchema.parse(owner), z.string().max(8000).parse(text)));
  });
  ipcMain.handle(IPC_CHANNELS.ai.send, (event, input: unknown) => {
    assertTrusted(event);
    return result(() => {
      return chat.send(sendSchema.parse(input), pageContext(host.snapshot()));
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
        let response: Response;
        try {
          response = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', redirect: 'error',
            signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, thinking: { type: 'disabled' } }) });
        } catch { throw new Error('无法连接 DeepSeek，请检查网络；未自动重试。'); }
        await response.body?.cancel();
        if (!response.ok) throw new Error(`DeepSeek 返回 HTTP ${response.status}，请检查 Key、额度或稍后再试。`);
        return '连接成功。测试没有保存未保存的 API Key。';
      } finally { testing = false; }
    });
  });
  return chat;
}
