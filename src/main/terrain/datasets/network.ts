import { parentPort } from 'node:worker_threads';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export type NetworkConfig = { network?: { proxy?: string | null } };
export async function resolveProxy(url: string, config: NetworkConfig = {}, env = process.env): Promise<{ value: string | null; source: string }> {
  const host = new URL(url).hostname;
  if (['localhost', '::1', '[::1]'].includes(host) || host.startsWith('127.')) return { value: null, source: 'loopback' };
  const value = config.network?.proxy;
  if (value) return { value: value === 'off' ? null : value, source: value === 'off' ? 'config:off' : 'config' };
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) if (env[key]) return { value: env[key] ?? null, source: `env:${key}` };
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await promisify(execFile)('/usr/sbin/scutil', ['--proxy'], { timeout: 2000 });
      for (const kind of ['HTTPS', 'HTTP', 'SOCKS']) {
        const get = (key: string) => stdout.match(new RegExp(`\\b${kind}${key}\\s*:\\s*([^\\n]+)`))?.[1].trim();
        if (get('Enable') === '1' && get('Proxy') && /^\d+$/.test(get('Port') ?? '')) return { value: `${kind === 'SOCKS' ? 'socks5h' : 'http'}://${get('Proxy')}:${get('Port')}`, source: 'macOS system' };
      }
    } catch { /* 系统代理查询不可用时沿用 Python 的直连回退。 */ }
  }
  return { value: null, source: 'direct' };
}
export async function proxyRecord(url: string, config?: NetworkConfig) {
  const { value, source } = await resolveProxy(url, config);
  return { source, host: value ? new URL(value).hostname : null };
}
export class DownloadError extends Error { constructor(message: string, readonly status?: number, readonly timedOut = false) { super(message); } }
export type FetchFile = (url: string, target: string, timeout: number, params?: Record<string, string>) => Promise<void>;
export function fetchFile(config: NetworkConfig = {}): FetchFile {
  return async (url, target, timeout, params) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('下载地址无效');
    for (const [key, value] of Object.entries(params ?? {})) parsed.searchParams.set(key, value);
    const proxy = await resolveProxy(url, config);
    const escaped = (proxy.value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.part`;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/curl', ['-fsSL', '--connect-timeout', '10', '--max-time', String(timeout), '--max-filesize', '1000000000', '-A', 'HuanPathTerrain/2.0 local-model', '-K', '-', '--noproxy', 'localhost,127.0.0.1,::1', '-o', temp, parsed.href], { stdio: ['pipe', 'ignore', 'pipe'] });
        if (child.pid) parentPort?.postMessage({ child: 'start', pid: child.pid });
        let diagnostic = '', killed = false;
        const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, (timeout + 0.2) * 1000);
        child.stderr.on('data', (data: Buffer) => { if (diagnostic.length < 4096) diagnostic += data.toString(); });
        child.stdin.on('error', () => { /* spawn/close 统一报告，不泄露 stdin 代理凭据。 */ });
        child.stdin.end(`proxy = "${escaped}"\n`);
        child.once('error', () => { clearTimeout(timer); reject(new DownloadError('无法启动系统 curl')); });
        child.once('close', code => {
          clearTimeout(timer);
          if (child.pid) parentPort?.postMessage({ child: 'end', pid: child.pid });
          const status = diagnostic.match(/(?:error: |returned error: )(\d{3})/)?.[1];
          if (code === 0) resolve();
          else reject(new DownloadError(killed || code === 28 ? '下载超时' : `下载失败：${status ? `HTTP ${status}` : `curl exit ${code}`}`, status ? Number(status) : undefined, killed || code === 28));
        });
      });
      if (!(await stat(temp)).size) throw new DownloadError('远程响应为空');
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
  };
}
