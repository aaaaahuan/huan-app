import { createIdeaDraftStore } from './draft';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ideaDraftSchema, ideaInputSchema, ideaResultSchema, type IdeaResult } from '@shared/contracts/ideas';
import { IPC_CHANNELS } from '@shared/ipc-channels';

export function registerIdeas(directory: string, assertTrusted: (event: IpcMainInvokeEvent) => void) {
  const draft = createIdeaDraftStore(join(app.getPath('userData'), 'ideas/draft.json'));
  const binary = join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'out/native/idea-store');
  let pending: Promise<unknown> = Promise.resolve();
  function run(input: object): Promise<IdeaResult> {
    const operation = pending.then(() => new Promise<IdeaResult>(resolve => {
      const child = execFile(binary, [directory, join(app.getPath('userData'), 'ideas/receipts.json')],
        { timeout: 45_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
          if (error) { resolve({ ok: false, message: '灵感文件暂时不可用，草稿已保留。请确认 iCloud 已下载该目录后重试。' }); return; }
          const parsed = ideaResultSchema.safeParse((() => { try { return JSON.parse(stdout) as unknown; } catch { return undefined; } })());
          resolve(parsed.success ? parsed.data : { ok: false, message: '未能确认保存结果，草稿已保留，请重试。' });
        });
      child.stdin?.end(JSON.stringify(input));
    }));
    pending = operation.catch(() => undefined);
    return operation;
  }
  ipcMain.handle(IPC_CHANNELS.ideas.getDraft, async event => {
    assertTrusted(event);
    try { return { ok: true, draft: await draft.get() }; }
    catch { return { ok: false, message: '无法读取本机草稿，请检查应用数据目录。已有草稿文件未覆盖。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.ideas.saveDraft, async (event, input: unknown) => {
    assertTrusted(event);
    const parsed = ideaDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: '草稿内容无效或过长。' };
    try { await draft.save(parsed.data); return { ok: true }; }
    catch { return { ok: false, message: '草稿自动保存失败，请复制原文后检查本机存储空间。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.ideas.get, event => { assertTrusted(event); return run({}); });
  ipcMain.handle(IPC_CHANNELS.ideas.append, (event, input: unknown) => {
    assertTrusted(event);
    const parsed = ideaInputSchema.safeParse(input);
    return parsed.success ? run(parsed.data) : { ok: false, message: '灵感内容或提交标识无效。' };
  });
  return { async flush() { await pending; await draft.flush(); } };
}
