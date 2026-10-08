import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { algorithmIdSchema, setCompletedSchema, type OpenAlgorithmResult } from '@shared/contracts/algorithms';
import { validBookmarkUrl } from '@main/bookmarks/markdown';
import type { createAlgorithmLibrary } from './library';

export function registerAlgorithms(library: ReturnType<typeof createAlgorithmLibrary>, assertTrusted: (event: IpcMainInvokeEvent) => void) {
  ipcMain.handle(IPC_CHANNELS.algorithms.get, event => { assertTrusted(event); return library.get(); });
  ipcMain.handle(IPC_CHANNELS.algorithms.refresh, event => { assertTrusted(event); return library.refresh(); });
  ipcMain.handle(IPC_CHANNELS.algorithms.setCompleted, async (event, input: unknown) => {
    assertTrusted(event);
    const parsed = setCompletedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '完成状态参数无效。', library: await library.get() };
    return library.setCompleted(parsed.data);
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.open, async (event, input: unknown): Promise<OpenAlgorithmResult> => {
    assertTrusted(event);
    const parsed = algorithmIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '题目参数无效。' };
    const state = await library.get();
    const item = state.items.find(problem => problem.id === parsed.data);
    if (state.state !== 'ready' || !item || !validBookmarkUrl(item.url)) return { ok: false, message: '题目链接不可用，请刷新笔记。' };
    try { await shell.openExternal(item.url); return { ok: true }; }
    catch { return { ok: false, message: '无法打开浏览器，请重试。' }; }
  });
}
