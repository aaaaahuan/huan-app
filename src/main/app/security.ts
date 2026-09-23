// 无副作用的安全校验函数：限制本地资源路径与可信页面地址。
import { isAbsolute, relative, resolve } from 'node:path';

export const UI_URL = 'app://ui/index.html';

// 将 app://ui URL 映射到构建目录，解码后再次检查，避免编码路径绕过目录边界。
export function assetPath(root: string, rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'app:' || url.hostname !== 'ui' || url.port || url.username || url.password)
      return undefined;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\\') || decoded.includes('\0')) return undefined;
    const path = resolve(root, '.' + decoded);
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
    return path;
  } catch { return undefined; }
}

// 开发时匹配指定服务的 origin 与路径；生产时只信任唯一的本地入口。
export function trustedDocument(url: string, developmentUrl?: string): boolean {
  try {
    if (developmentUrl) {
      const expected = new URL(developmentUrl);
      const actual = new URL(url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname &&
        !actual.username && !actual.password;
    }
    return url === UI_URL;
  } catch { return false; }
}

// 开发地址只允许回环网络，禁止通过环境变量把特权界面指向远程网站。
export function developmentOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password) throw new Error('Invalid development server URL');
  return url.href;
}
