import { app, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { TranslationStatus } from '@shared/contracts/translation';
import type { Settings } from '@shared/contracts/settings';

type Server = { child: ChildProcess; origin: string; token: string; exited: boolean; error: string };
export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}${error.cause ? `\n${errorText(error.cause)}` : ''}` : String(error);
}

// 伴读与翻译共用本地模型进程；单次 Run 的等待和取消保留驻留模型。
export function createLocalModelRuntime(contents: WebContents, getPaths: () => Promise<Settings['localModel']>) {
  let status: TranslationStatus = { revision: 0, phase: 'unloaded' };
  let server: Server | undefined;
  let starting: Promise<Server> | undefined;
  let closed = false;
  function publish(phase: TranslationStatus['phase'], error?: string) {
    status = { revision: status.revision + 1, phase, error };
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.translation.status, status);
  }
  async function resourcePath(label: string, configured: string, parts: string[], permission: number) {
    if (configured && (!isAbsolute(configured) || configured.includes('\0')))
      throw new Error(`${label}必须使用绝对路径，请检查设置或环境变量。`);
    // 开发目录可多一层 huan 分组；只查两个约定位置，显式配置失败时直接报错。
    const candidates = configured ? [configured] : app.isPackaged ? [] : [
      join(app.getAppPath(), '..', 'model', ...parts),
      join(app.getAppPath(), '..', '..', 'model', ...parts)
    ];
    for (const path of candidates) {
      try {
        if (!(await stat(path)).isFile()) throw new Error('路径不是普通文件。');
        await access(path, permission);
        return path;
      } catch (error) {
        if (!configured && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new Error(`${label}不可用：${path}`, { cause: error });
      }
    }
    throw new Error(`未找到${label}。请在“设置 → AI 伴读 → 离线模型”填写本机绝对路径并保存。`);
  }
  async function launch(): Promise<Server> {
    publish('loading');
    const configured = await getPaths();
    const modelPath = await resourcePath('离线模型权重', process.env.HUAN_MODEL_PATH || configured.modelPath,
      ['models', 'Qwen3.5-4B-Q4_K_M.gguf'], constants.R_OK);
    const executable = await resourcePath('llama-server 程序', process.env.HUAN_LLAMA_SERVER_PATH || configured.serverPath,
      ['runtime', 'llama', 'llama-b11429', 'llama-server'], constants.X_OK);
    if (closed) throw new Error('本地模型服务已关闭。');
    const port = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address();
        if (!address || typeof address === 'string') { socket.close(); reject(new Error('无法分配本地端口。')); return; }
        socket.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    if (closed) throw new Error('本地模型服务已关闭。');
    const token = randomUUID();
    const child = spawn(executable, ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port),
      '--api-key', token, '--parallel', '1', '--n-predict', '-1', '--no-context-shift',
      '--threads', '6', '--threads-batch', '6', '--flash-attn', 'on',
      '--jinja', '--chat-template-kwargs', '{"enable_thinking":false}', '--reasoning', 'off', '--reasoning-budget', '0',
      '--no-cache-prompt', '--cache-ram', '0', '--ctx-checkpoints', '0', '--no-cache-idle-slots',
      '--offline', '--no-webui', '--no-slots', '--log-verbosity', '1'], {
      cwd: dirname(executable), stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: app.getPath('home'), LANG: 'en_US.UTF-8' }
    });
    const handle: Server = { child, origin: `http://127.0.0.1:${port}`, token, exited: false, error: '' };
    server = handle;
    let diagnostics = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { diagnostics += chunk; });
    child.once('error', error => { handle.error = errorText(error); });
    child.once('close', (code, signal) => {
      handle.exited = true;
      handle.error = `${handle.error || `llama-server exited: code=${code}, signal=${signal}`}\n${diagnostics}`.trim();
      if (server !== handle) return;
      server = undefined;
      if (!closed) publish('failed', handle.error);
    });
    const deadline = Date.now() + 60000;
    while (!closed && !handle.exited) {
      try {
        const response = await fetch(`${handle.origin}/health`, {
          signal: AbortSignal.timeout(1000), headers: { Authorization: `Bearer ${token}` }, redirect: 'error'
        });
        await response.body?.cancel();
        if (response.ok) { diagnostics = ''; publish('ready'); return handle; }
      } catch { /* 启动期间端口可能尚未监听，继续等待进程状态。 */ }
      if (Date.now() >= deadline) {
        child.kill('SIGKILL');
        throw new Error(`llama-server startup timeout (60s)\n${diagnostics}`.trim());
      }
      await delay(100);
    }
    throw new Error(handle.error || '本地模型服务已关闭。');
  }
  function start() {
    if (closed) return Promise.reject(new Error('本地模型服务已关闭。'));
    if (starting) return starting;
    if (server && status.phase === 'ready') return Promise.resolve(server);
    starting = launch().catch((error: unknown) => { if (!closed && status.phase !== 'failed') publish('failed', errorText(error)); throw error; })
      .finally(() => { starting = undefined; });
    return starting;
  }

  return {
    status: () => status,
    ensure(signal: AbortSignal) {
      signal.throwIfAborted();
      return new Promise<Server>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        void start().then(value => { signal.removeEventListener('abort', abort); resolve(value); },
          error => { signal.removeEventListener('abort', abort); reject(error); });
        if (signal.aborted) abort();
      });
    },
    warmup() { void start().catch(() => undefined); },
    close() { closed = true; server?.child.kill('SIGKILL'); }
  };
}
