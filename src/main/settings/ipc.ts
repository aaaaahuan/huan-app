// 设置模块的 Electron 适配层：可信 IPC、原生文件选择器与保存后的通知。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { createSettingsStore } from './store';
import { settingsSchema, type SavedKeyResult, type Settings, type SubtitleUsage } from '@shared/contracts/settings';

export function registerSettings(window: BrowserWindow, store: ReturnType<typeof createSettingsStore>,
  assertTrusted: (event: IpcMainInvokeEvent) => void, onSaved: (settings: Settings) => Promise<unknown>, subtitleUsage: () => Promise<SubtitleUsage>) {
  let choosing = false;
  ipcMain.handle(IPC_CHANNELS.settings.load, (event) => {
    assertTrusted(event);
    return store.load();
  });
  ipcMain.handle(IPC_CHANNELS.settings.save, async (event, input: unknown, revision: unknown, keyChange: unknown, subtitleKeyChange: unknown) => {
    assertTrusted(event);
    const parsed = settingsSchema.safeParse(input);
    const current = await store.load();
    if (parsed.success && parsed.data.notesPath && current.ok && parsed.data.notesPath !== current.settings.notesPath) {
      const answer = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '允许访问'], defaultId: 0, cancelId: 0,
        message: '允许 AI 访问此笔记目录？', detail: `${parsed.data.notesPath}\n\nAI 可读取目录内 Markdown，读取内容会发送到 DeepSeek。每次写入或修改仍需单独确认。不开启命令执行，不允许访问目录外文件。` });
      if (answer.response !== 1) return { ok: false, message: '未授权笔记目录，设置未保存。' };
    }
    if (typeof subtitleKeyChange === 'string') {
      const answer = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '允许保存'], defaultId: 0, cancelId: 0,
        message: '保存 Transcript Guru Key 并允许获取字幕？',
        detail: 'Key 将加密保存在本机。获取会把当前 YouTube 视频 URL 发送给 Transcript Guru，服务可能计次或留存。使用原语言自动检测，提交前查询费用预估；收费、ASR 或翻译路径不会自动提交。预估不是服务端费用锁定，实际费用仍以官方记录为准。此授权不包含向 DeepSeek 发送字幕。' });
      if (answer.response !== 1) return { ok: false, message: '未授权字幕服务，设置未保存。' };
    }
    const result = await store.save(input, revision, keyChange, subtitleKeyChange);
    // 等待受影响来源处理完再返回，使界面重新查询时拿到本次保存对应的列表。
    if (result.ok) await onSaved(result.settings);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.settings.subtitleUsage, (event) => {
    assertTrusted(event);
    return subtitleUsage();
  });
  // 仅显式查看时返回当前 Key；普通设置读取仍只返回凭据引用。
  ipcMain.handle(IPC_CHANNELS.settings.revealAIKey, async (event, input: unknown): Promise<SavedKeyResult> => {
    assertTrusted(event);
    const parsed = z.uuid().safeParse(input);
    if (!parsed.success) return { ok: false, message: 'AI 凭据无效，请重新打开设置。' };
    try {
      const key = await store.getKey(parsed.data);
      const current = await store.load();
      if (!current.ok || current.settings.ai.credentialId !== parsed.data)
        return { ok: false, message: 'AI 凭据已变更，请重新打开设置。' };
      return { ok: true, credentialId: parsed.data, key };
    } catch { return { ok: false, message: '无法读取 DeepSeek Key，请重新打开设置或重新配置。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.settings.revealSubtitleKey, async (event, input: unknown): Promise<SavedKeyResult> => {
    assertTrusted(event);
    const parsed = z.uuid().safeParse(input);
    if (!parsed.success) return { ok: false, message: '字幕凭据无效，请重新打开设置。' };
    try {
      const key = await store.getSubtitleKey(parsed.data);
      const current = await store.load();
      if (!current.ok || current.settings.subtitles.credentialId !== parsed.data)
        return { ok: false, message: '字幕凭据已变更，请重新打开设置。' };
      return { ok: true, credentialId: parsed.data, key };
    } catch { return { ok: false, message: '无法读取字幕 Key，请重新打开设置或重新配置。' }; }
  });
  ipcMain.handle(IPC_CHANNELS.settings.openSubtitleAccount, (event) => {
    assertTrusted(event);
    return shell.openExternal('https://transcriptguru.io/dashboard');
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
