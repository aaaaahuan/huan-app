import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { TerrainStatus } from '@shared/contracts/terrain';

import { resolveHuanPathRoot, validateHuanPathRoot, resolveTerrainDataDir, validateTerrainDataDir } from './root';

const origin = 'http://127.0.0.1:8765';
export function registerTerrain(assertTrusted: (event: IpcMainInvokeEvent) => void, loadDataDir: () => Promise<string>) {
  let child: ChildProcess | undefined;
  let pending: Promise<TerrainStatus> | undefined;
  let closing = false;
  let activeDataDir: string | undefined;
  let diagnostic = '';
  async function healthy() {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      const value: unknown = await response.json();
      return response.ok && typeof value === 'object' && value !== null &&
        'service' in value && value.service === 'huan-terrain' && 'version' in value && value.version === 2;
    } catch { return false; }
  }
  async function portAvailable(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', error => {
        if ('code' in error && error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      });
      probe.listen(8765, '127.0.0.1', () => {
        probe.close(error => { if (error) reject(error); else resolve(true); });
      });
    });
  }
  function running(owned: ChildProcess) {
    return owned.pid !== undefined && owned.exitCode === null && owned.signalCode === null;
  }
  function signalOwned(signal: NodeJS.Signals) {
    if (!child?.pid) return;
    // 独立进程组包含 Python 构建子进程，退出时一并清理；不终止用户手动启动的服务。
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  }
  async function stop() {
    const owned = child;
    if (!owned) return;
    // 先订阅退出，避免遗漏快速退出；只向仍持有的自有进程组发信号。
    if (running(owned)) {
      const exited = new Promise<void>(resolve => owned.once('exit', () => resolve()));
      signalOwned('SIGTERM');
      await Promise.race([exited, delay(500)]);
      signalOwned('SIGKILL');
      await exited;
    }
    if (child === owned) child = undefined;
  }
  async function start(): Promise<TerrainStatus> {
    if (closing) return { ok: false, message: '应用正在退出。' };
    try {
      const root = resolveHuanPathRoot(process.env.HUAN_PATH_ROOT, app.isPackaged, app.getAppPath());
      await validateHuanPathRoot(root);
      const dataDir = resolveTerrainDataDir(await loadDataDir(), app.getPath('home'));
      await validateTerrainDataDir(dataDir);
      const existing = child;
      if (existing && running(existing) && await healthy() && running(existing)) {
        return { ok: true, url: `${origin}/?huanApp=1` };
      }
      if (child) await stop();
      // 健康检查不能证明服务归属；外部进程即使返回相同响应也不复用。
      if (!await portAvailable()) {
        return { ok: false, message: '8765 端口已被非本应用拉起的进程占用，请先停掉占用 8765 的旧进程后重试。' };
      }
      const python = join(root, '.venv', 'bin', 'python');
      await access(python);
      diagnostic = '';
      const owned = spawn(python, ['server.py', '--port', '8765'], {
        cwd: root, env: { ...process.env, HUAN_PATH_JOBS_DIR: join(dataDir, 'jobs'), HUAN_PATH_TRACKS_DIR: join(dataDir, 'tracks') }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
      });
      child = owned;
      activeDataDir = dataDir;
      const captureDiagnostic = (chunk: Buffer | string) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-2500);
      };
      owned.stdout?.on('data', captureDiagnostic);
      owned.stderr?.on('data', captureDiagnostic);
      owned.on('error', error => { captureDiagnostic(error.message); });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (closing) break;
        if (!running(owned)) break;
        if (await healthy() && running(owned)) return { ok: true, url: `${origin}/?huanApp=1` };
        await delay(250);
      }
      await stop();
      return { ok: false, message: `本应用拉起的地形服务启动失败，请检查 Python 环境和 8765 端口（如被旧进程占用，请先停掉）。${diagnostic ? `\n${diagnostic}` : ''}` };
    } catch (error) {
      return { ok: false, message: `无法启动地形服务。请检查地形数据目录、HUAN_PATH_ROOT 及 Python 依赖。\n${error instanceof Error ? error.message : String(error)}` };
    }
  }
  ipcMain.handle(IPC_CHANNELS.terrain.autoRoot, event => {
    assertTrusted(event);
    try { return resolveTerrainDataDir('', app.getPath('home')); }
    catch { return ''; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.ensure, event => {
    assertTrusted(event);
    if (!pending) {
      const starting = start().finally(() => { if (pending === starting) pending = undefined; });
      pending = starting;
    }
    return pending;
  });
  return {
    async configure(configured: string) {
      // 等待正在启动的旧服务收尾；保存返回前确保旧进程已退出。
      pending ??= Promise.resolve({ ok: false, message: '正在切换地形目录…' });
      const previous = pending;
      const change = previous.then(async () => {
        const next = resolveTerrainDataDir(configured, app.getPath('home'));
        if (activeDataDir !== next) {
          const restart = child !== undefined;
          await stop();
          activeDataDir = undefined;
          if (restart && !closing) return start();
        }
        return { ok: false as const, message: '地形目录已更新，请重试。' };
      });
      pending = change;
      try { await change; } finally { if (pending === change) pending = undefined; }
    },
    async close() { closing = true; await pending; await stop(); } };
}
