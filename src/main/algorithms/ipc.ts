import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { algorithmIdSchema, copyAlgorithmNoteSchema, saveAlgorithmNoteSchema, setCompletedSchema, type OpenAlgorithmResult } from '@shared/contracts/algorithms';
import { z } from 'zod';
import { validBookmarkUrl } from '@main/bookmarks/markdown';
import type { createAlgorithmLibrary } from './library';
import { noteError, type createAlgorithmNotes } from './notes';

export function registerAlgorithms(library: ReturnType<typeof createAlgorithmLibrary>, notes: ReturnType<typeof createAlgorithmNotes>,
  assertTrusted: (event: IpcMainInvokeEvent) => void) {
  async function problem(input: unknown) {
    const id = algorithmIdSchema.safeParse(input);
    if (!id.success) throw new Error('题目参数无效。');
    const state = await library.get();
    const item = state.items.find(value => value.id === id.data);
    if (state.state !== 'ready' || !item) throw new Error('题目不可用，请刷新算法清单。');
    return item;
  }
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
  ipcMain.handle(IPC_CHANNELS.algorithms.getNote, async (event, input: unknown) => {
    assertTrusted(event);
    try { return { ok: true, note: await notes.get(await problem(input)) }; }
    catch (error) { return { ok: false, message: noteError(error) }; }
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.noteIndex, async event => {
    assertTrusted(event);
    try { return { ok: true, keys: await notes.index() }; }
    catch (error) { return { ok: false, message: noteError(error) }; }
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.saveNote, async (event, input: unknown) => {
    assertTrusted(event);
    const parsed = saveAlgorithmNoteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, kind: 'error', message: '心得保存参数无效。' };
    try { return await notes.save(await problem(parsed.data.id), parsed.data.content, parsed.data.expectedRevision); }
    catch (error) { return { ok: false, kind: 'error', message: noteError(error) }; }
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.copyNote, async (event, input: unknown) => {
    assertTrusted(event);
    const parsed = copyAlgorithmNoteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '心得副本参数无效。' };
    try { return { ok: true, path: await notes.copy(await problem(parsed.data.id), parsed.data.content) }; }
    catch (error) { return { ok: false, message: noteError(error) }; }
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.openNote, async (event, input: unknown): Promise<OpenAlgorithmResult> => {
    assertTrusted(event);
    try {
      const note = await notes.get(await problem(input));
      if (!note.exists) throw new Error('请先保存心得，再在 Obsidian 中打开。');
      await shell.openExternal(`obsidian://open?path=${encodeURIComponent(note.path)}`);
      return { ok: true };
    } catch (error) { return { ok: false, message: noteError(error) }; }
  });
  ipcMain.handle(IPC_CHANNELS.algorithms.openNoteLink, async (event, input: unknown): Promise<OpenAlgorithmResult> => {
    assertTrusted(event);
    const parsed = z.string().max(4096).safeParse(input);
    if (!parsed.success || !validBookmarkUrl(parsed.data)) return { ok: false, message: '只允许打开不带凭据的 HTTP(S) 链接。' };
    try { await shell.openExternal(parsed.data); return { ok: true }; }
    catch { return { ok: false, message: '无法打开浏览器，请重试。' }; }
  });
}
