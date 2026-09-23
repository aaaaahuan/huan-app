// 所有原页命令只接受可信应用主 frame；远端网页没有这些 IPC 能力。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { readerActionSchema, readerLayoutSchema } from '@shared/contracts/browser';
import type { createPageHost } from './page-host';

/** 注册原页容器的 IPC 事件处理函数。 */
export function registerBrowser(host: ReturnType<typeof createPageHost>, assertTrusted: (event: IpcMainInvokeEvent) => void) {
  const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
  ipcMain.handle(IPC_CHANNELS.browser.suspend, (event, value: unknown) => {
    assertTrusted(event);
    host.suspend(z.boolean().parse(value));
  });
  ipcMain.handle(IPC_CHANNELS.browser.get, (event) => { assertTrusted(event); return host.get(); });
  ipcMain.handle(IPC_CHANNELS.browser.select, (event, id: unknown) => {
    assertTrusted(event);
    return host.select(idSchema.nullable().parse(id));
  });
  ipcMain.handle(IPC_CHANNELS.browser.action, (event, id: unknown, command: unknown) => {
    assertTrusted(event);
    return host.action(idSchema.parse(id), readerActionSchema.parse(command));
  });
  ipcMain.handle(IPC_CHANNELS.browser.layout, (event, layout: unknown) => {
    assertTrusted(event);
    host.layout(readerLayoutSchema.parse(layout));
  });
}
