import { contextBridge, ipcRenderer } from 'electron';
import type { HuanAppAPI } from '../shared/contracts/app';

const api: HuanAppAPI = {
  app: Object.freeze({ getStatus: () => ipcRenderer.invoke('huan-app:app:status') })
};
contextBridge.exposeInMainWorld('huanApp', Object.freeze(api));
