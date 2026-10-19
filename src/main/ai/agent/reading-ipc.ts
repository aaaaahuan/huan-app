import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { ownerSchema, sendSchema, type AIResult } from '@shared/contracts/ai';
import type { ModelIdentity } from '@shared/contracts/ai-execution';
import type { PageContext } from '@shared/contracts/page-context';
import type { createPageHost } from '@main/browser/page-host';
import type { createSettingsStore } from '@main/settings/store';
import { createConversations } from '@main/ai/core/conversations';
import type { AgentHandle, RecordApprovalDecision } from './agent';
import type { ReaderToolContext } from './reading-agent';

export function registerReading(window: BrowserWindow, host: ReturnType<typeof createPageHost>, settings: ReturnType<typeof createSettingsStore>,
  assertTrusted: (event: IpcMainInvokeEvent) => void, subtitleSnapshot: () => PageContext['subtitles'],
  readingAgent: AgentHandle<ReaderToolContext>) {

  const chat = createConversations(readingAgent, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.ai.state, state);
  }, async () => {
    const result = await settings.load();
    if (!result.ok) throw new Error(result.message);
    return result.settings.notesPath ? realpath(result.settings.notesPath) : '';
  }, async (proposal, signal) => {
    signal.throwIfAborted();
    const result = await settings.load();
    if (!result.ok || !result.settings.notesPath || await realpath(result.settings.notesPath) !== proposal.root) return false;
    // 原生弹窗没有正文滚动区：只显示限长路径，不让笔记长度撑出屏幕。
    const path = proposal.path.replace(/[\r\n\t]/g, ' ');
    const displayPath = path.length > 160 ? `${path.slice(0, 64)}…${path.slice(-95)}` : path;
    const answer = await dialog.showMessageBox(window, { type: 'question', signal, buttons: ['取消', '确认保存'], defaultId: 0, cancelId: 0,
      message: proposal.operation === 'write' ? '允许在目标路径新建笔记？' : '允许修改目标路径的笔记？',
      detail: `目标路径（相对于已授权笔记库）：\n${displayPath}${path.length > 160 ? '\n（路径过长，已省略中间部分）' : ''}` });
    signal.throwIfAborted();
    const latest = await settings.load();
    return answer.response === 1 && latest.ok && latest.settings.notesPath === result.settings.notesPath;
  }, async signal => {
    const answer = await dialog.showMessageBox(window, { type: 'question', signal, buttons: ['取消', '允许发送'], defaultId: 0, cancelId: 0,
      message: '允许向在线模型发送此对话的离线历史？',
      detail: '继续此对话会把已有提问、回答和工具读取的正文、字幕或笔记内容发送给 DeepSeek，可能计费和留存。取消不会清空历史；也可新开对话避免发送旧内容。' });
    signal.throwIfAborted();
    return answer.response === 1;
  });

  // 授权期间切页不改变已冻结的本轮上下文。
  const pageContext = (snapshot: PageContext) => async (
    signal: AbortSignal, model: ModelIdentity, recordApprovalDecision: RecordApprovalDecision
  ) => {
    if (!snapshot.pages.length && !snapshot.subtitles) return undefined;
    signal.throwIfAborted();
    if (model.mode === 'offline') return snapshot;
    const result = await settings.load();
    if (!result.ok) throw new Error(result.message);
    let consent = result.settings.ai.consentVersion;
    const required = snapshot.subtitles ? 3 : 2;
    if (consent < required) {
      const answer = await dialog.showMessageBox(window, { type: 'question', signal, buttons: ['不附带新材料', '允许附带'],
        defaultId: 0, cancelId: 0, message: '允许向 DeepSeek 发送阅读材料？',
        detail: '将向 DeepSeek 提供本轮页面目录、视频信息及提问时播放位置，并允许 AI 按需读取已有页面正文和完整字幕。可能计费和留存；拒绝时保留此前已授权的文章材料，普通聊天继续。不会自动获取字幕或发送音频。' });
      signal.throwIfAborted();
      await recordApprovalDecision({ invocationId: randomUUID(),
        decision: answer.response === 1 ? 'approved' : 'declined', scope: 'preflight' });
      if (answer.response === 1) { await settings.allowMaterials(required); consent = Math.max(consent, required); }
    }
    signal.throwIfAborted();
    const filtered: PageContext = { pages: consent >= 2 ? snapshot.pages : [],
      currentPageId: consent >= 2 ? snapshot.currentPageId : undefined, subtitles: consent >= 3 ? snapshot.subtitles : undefined };
    return filtered.pages.length || filtered.subtitles ? filtered : undefined;
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
    assertTrusted(event); return result(() => chat.draft(ownerSchema.parse(owner), z.string().parse(text)));
  });
  ipcMain.handle(IPC_CHANNELS.ai.send, (event, input: unknown) => {
    assertTrusted(event);

    return result(() => {
      const request = sendSchema.parse(input);
      const subtitles = host.isSuspended() ? undefined : subtitleSnapshot();
      const capture = host.freezeSnapshot();
      return chat.send(request, async (signal, model, recordApprovalDecision) => {
        const snapshot: PageContext = structuredClone(await capture(signal));
        signal.throwIfAborted();
        snapshot.subtitles = subtitles;
        return pageContext(snapshot)(signal, model, recordApprovalDecision);
      });
    });
  });
  return chat;
}
