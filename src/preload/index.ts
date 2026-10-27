// 隔离上下文中的桥接脚本：仅开放业务方法，不向页面暴露 ipcRenderer 或文件系统。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { contextBridge, ipcRenderer } from 'electron';
import type { TerrainJobRequest, TerrainUpload } from '@shared/contracts/terrain';
import type { HuanAppAPI } from '@shared/contracts/app';

// 通道名固定在这里；页面不能自行指定任意 IPC 通道或直接调用文件系统。
const api: HuanAppAPI = {
  terrain: Object.freeze({ autoRoot: () => ipcRenderer.invoke(IPC_CHANNELS.terrain.autoRoot), ensure: () => ipcRenderer.invoke(IPC_CHANNELS.terrain.ensure),
    listJobs: () => ipcRenderer.invoke(IPC_CHANNELS.terrain.listJobs),
    upload: (input: TerrainUpload) => ipcRenderer.invoke(IPC_CHANNELS.terrain.upload, input),
    retry: (input: TerrainJobRequest) => ipcRenderer.invoke(IPC_CHANNELS.terrain.retry, input),
    getJob: (input: TerrainJobRequest) => ipcRenderer.invoke(IPC_CHANNELS.terrain.getJob, input) }),
  app: Object.freeze({ getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.app.status) }),

  // 算法训练服务
  algorithms: Object.freeze({
    get: () => ipcRenderer.invoke(IPC_CHANNELS.algorithms.get),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.algorithms.refresh),
    setCompleted: input => ipcRenderer.invoke(IPC_CHANNELS.algorithms.setCompleted, input),
    open: id => ipcRenderer.invoke(IPC_CHANNELS.algorithms.open, id),
    getNote: id => ipcRenderer.invoke(IPC_CHANNELS.algorithms.getNote, id),
    noteIndex: () => ipcRenderer.invoke(IPC_CHANNELS.algorithms.noteIndex),
    saveNote: input => ipcRenderer.invoke(IPC_CHANNELS.algorithms.saveNote, input),
    copyNote: input => ipcRenderer.invoke(IPC_CHANNELS.algorithms.copyNote, input),
    openNote: id => ipcRenderer.invoke(IPC_CHANNELS.algorithms.openNote, id),
    openNoteLink: url => ipcRenderer.invoke(IPC_CHANNELS.algorithms.openNoteLink, url),
    onNotesChanged: listener => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.algorithms.notesChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.algorithms.notesChanged, handler);
    }
  } satisfies HuanAppAPI['algorithms']),

  // 翻译服务
  translation: Object.freeze({
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.translation.getStatus),
    translate: request => ipcRenderer.invoke(IPC_CHANNELS.translation.translate, request),
    stop: requestId => ipcRenderer.invoke(IPC_CHANNELS.translation.stop, requestId),
    copy: text => ipcRenderer.invoke(IPC_CHANNELS.translation.copy, text),
    onStatus: listener => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
      ipcRenderer.on(IPC_CHANNELS.translation.status, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.translation.status, handler);
    }
  } satisfies HuanAppAPI['translation']),

  // 设置服务
  settings: Object.freeze({
    load: () => ipcRenderer.invoke(IPC_CHANNELS.settings.load),
    save: (settings, revision, keyChange, subtitleKeyChange) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings, revision, keyChange, subtitleKeyChange),
    subtitleUsage: () => ipcRenderer.invoke(IPC_CHANNELS.settings.subtitleUsage),
    revealAIKey: credentialId => ipcRenderer.invoke(IPC_CHANNELS.settings.revealAIKey, credentialId),
    revealSubtitleKey: credentialId => ipcRenderer.invoke(IPC_CHANNELS.settings.revealSubtitleKey, credentialId),
    openSubtitleAccount: () => ipcRenderer.invoke(IPC_CHANNELS.settings.openSubtitleAccount),
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.settings.chooseDirectory),
    chooseFile: () => ipcRenderer.invoke(IPC_CHANNELS.settings.chooseFile)
  } satisfies HuanAppAPI['settings']),

  // 字幕服务
  subtitles: Object.freeze({
    get: () => ipcRenderer.invoke(IPC_CHANNELS.subtitles.get),
    ensure: input => ipcRenderer.invoke(IPC_CHANNELS.subtitles.ensure, input),
    seek: input => ipcRenderer.invoke(IPC_CHANNELS.subtitles.seek, input),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.subtitles.state, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.subtitles.state, handler);
    }
  } satisfies HuanAppAPI['subtitles']),

  // 书签服务
  bookmarks: Object.freeze({ get: () => ipcRenderer.invoke(IPC_CHANNELS.bookmarks.get),
    setRead: input => ipcRenderer.invoke(IPC_CHANNELS.bookmarks.setRead, input) } satisfies HuanAppAPI['bookmarks']),

  // AI对话 服务
  ai: Object.freeze({
    getSelection: () => ipcRenderer.invoke(IPC_CHANNELS.ai.getSelection),
    selectModel: selection => ipcRenderer.invoke(IPC_CHANNELS.ai.selectModel, selection),
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
    captureContext: (id, pageId) => ipcRenderer.invoke(IPC_CHANNELS.browser.captureContext, id, pageId),
    clearContext: (id, pageId) => ipcRenderer.invoke(IPC_CHANNELS.browser.clearContext, id, pageId),
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
