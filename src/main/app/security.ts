import { isAbsolute, relative, resolve } from 'node:path';

export const UI_URL = 'app://ui/index.html';

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

export function developmentOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password) throw new Error('Invalid development server URL');
  return url.href;
}
