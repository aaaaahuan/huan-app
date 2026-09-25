// 隔离上下文中的桥接脚本：仅开放业务方法，不向页面暴露 ipcRenderer 或文件系统。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { contextBridge, ipcRenderer } from 'electron';
import type { HuanAppAPI } from '@shared/contracts/app';

// 通道名固定在这里；页面不能自行指定任意 IPC 通道或直接调用文件系统。
const api: HuanAppAPI = {
  app: Object.freeze({ getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.app.status) }),
  settings: Object.freeze({
    load: () => ipcRenderer.invoke(IPC_CHANNELS.settings.load),
    save: (settings, revision, keyChange) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings, revision, keyChange),
    chooseFile: () => ipcRenderer.invoke(IPC_CHANNELS.settings.chooseFile)
  } satisfies HuanAppAPI['settings']),
  bookmarks: Object.freeze({ get: () => ipcRenderer.invoke(IPC_CHANNELS.bookmarks.get) }),
  ai: Object.freeze({
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.ai.get, id),
    draft: (owner, text) => ipcRenderer.invoke(IPC_CHANNELS.ai.draft, owner, text),
    send: (input) => ipcRenderer.invoke(IPC_CHANNELS.ai.send, input),
    stop: (owner) => ipcRenderer.invoke(IPC_CHANNELS.ai.stop, owner),
    restart: (owner) => ipcRenderer.invoke(IPC_CHANNELS.ai.restart, owner),
    testKey: (key) => ipcRenderer.invoke(IPC_CHANNELS.ai.testKey, key),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.ai.state, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ai.state, handler);
    }
  } satisfies HuanAppAPI['ai']),
  browser: Object.freeze({
    sessionModes: () => ipcRenderer.invoke(IPC_CHANNELS.browser.sessionModes),
    clearSession: (platform) => ipcRenderer.invoke(IPC_CHANNELS.browser.clearSession, platform),
    get: () => ipcRenderer.invoke(IPC_CHANNELS.browser.get),
    select: (id) => ipcRenderer.invoke(IPC_CHANNELS.browser.select, id),
    action: (id, action) => ipcRenderer.invoke(IPC_CHANNELS.browser.action, id, action),
    layout: (layout) => ipcRenderer.invoke(IPC_CHANNELS.browser.layout, layout),
    suspend: (value) => ipcRenderer.invoke(IPC_CHANNELS.browser.suspend, value),
    onState: (listener) => {
      // 不把 Electron 事件对象交给 UI；卸载时只移除本次订阅。
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.browser.state, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.browser.state, handler);
    }
  } satisfies HuanAppAPI['browser'])
};
contextBridge.exposeInMainWorld('huanApp', Object.freeze(api));
