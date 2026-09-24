// 所有原页命令只接受可信应用主 frame；远端网页没有这些 IPC 能力。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { readerActionSchema, readerLayoutSchema } from '@shared/contracts/browser';
import type { createPageHost } from './page-host';
import { PLATFORMS, PLATFORM_NAMES } from '@shared/contracts/settings';

/** 注册原页容器的 IPC 事件处理函数。 */
export function registerBrowser(window: BrowserWindow, host: ReturnType<typeof createPageHost>, assertTrusted: (event: IpcMainInvokeEvent) => void) {
  const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
  // 导航和清除串行执行；清除尚未完成时，不允许重新创建同一平台的网页。
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }
  ipcMain.handle(IPC_CHANNELS.browser.sessionModes, (event) => { assertTrusted(event); return host.sessionModes(); });
  ipcMain.handle(IPC_CHANNELS.browser.clearSession, (event, value: unknown) => {
    assertTrusted(event);
    const platform = z.enum(PLATFORMS).parse(value);
    return enqueue(async () => {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', buttons: ['取消', '清除会话'], defaultId: 0, cancelId: 0,
        message: `清除 ${PLATFORM_NAMES[platform]} 的本地会话？`,
        detail: '将清除该平台的 Cookie、网站存储和缓存，包括此前保存的登录态。当前平台页面会关闭，需要重新登录；不会删除收藏，也不影响其他平台。'
      });
      return response === 1 ? host.clearSession(platform) : { ok: true, cancelled: true };
    });
  });
  ipcMain.handle(IPC_CHANNELS.browser.suspend, (event, value: unknown) => {
    assertTrusted(event);
    host.suspend(z.boolean().parse(value));
  });
  ipcMain.handle(IPC_CHANNELS.browser.get, (event) => { assertTrusted(event); return host.get(); });
  ipcMain.handle(IPC_CHANNELS.browser.select, (event, id: unknown) => {
    assertTrusted(event);
    const parsed = idSchema.nullable().parse(id);
    return enqueue(() => host.select(parsed));
  });
  ipcMain.handle(IPC_CHANNELS.browser.action, (event, id: unknown, command: unknown) => {
    assertTrusted(event);
    const parsedId = idSchema.parse(id);
    const parsedCommand = readerActionSchema.parse(command);
    return enqueue(() => host.action(parsedId, parsedCommand));
  });
  ipcMain.handle(IPC_CHANNELS.browser.layout, (event, layout: unknown) => {
    assertTrusted(event);
    host.layout(readerLayoutSchema.parse(layout));
  });
}
