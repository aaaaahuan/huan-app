// 设置模块的 Electron 适配层：可信 IPC、原生文件选择器与保存后的通知。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { createSettingsStore } from './store';
import type { Settings } from '@shared/contracts/settings';

export function registerSettings(window: BrowserWindow, store: ReturnType<typeof createSettingsStore>,
  assertTrusted: (event: IpcMainInvokeEvent) => void, onSaved: (settings: Settings) => Promise<unknown>) {
  let choosing = false;
  ipcMain.handle(IPC_CHANNELS.settings.load, (event) => {
    assertTrusted(event);
    return store.load();
  });
  ipcMain.handle(IPC_CHANNELS.settings.save, async (event, input: unknown, revision: unknown) => {
    assertTrusted(event);
    const result = await store.save(input, revision);
    // 等待受影响来源处理完再返回，使界面重新查询时拿到本次保存对应的列表。
    if (result.ok) await onSaved(result.settings);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.settings.chooseFile, async (event) => {
    assertTrusted(event);
    // 防止重复点击打开多层原生选择器；取消只返回 null，不清除原配置。
    if (choosing) return { ok: false, message: '文件选择窗口已打开。' };
    choosing = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: '选择 Obsidian 收藏文件', buttonLabel: '选择文件',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        properties: ['openFile']
      });
      return { ok: true, path: result.canceled ? null : result.filePaths[0] ?? null };
    } catch {
      return { ok: false, message: '无法打开文件选择器，请重试或直接填写绝对路径。' };
    } finally { choosing = false; }
  });
}
