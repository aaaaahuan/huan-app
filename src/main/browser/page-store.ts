import { randomUUID } from 'node:crypto';
import type { PageContent, PageContext, PageSnapshot } from '@shared/contracts/page-context';
import type { Platform } from '@shared/contracts/settings';

// 已有平台仍限定详情页；Other 网站由 Readability 再判断是否为可读文章。
export function supportsPage(url: URL, platform?: Platform): boolean {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com'))
    return /\/(?:status|article)\/\d+/.test(url.pathname);
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return /\/comments\/[a-z0-9]+/i.test(url.pathname);
  if (host === 'mp.weixin.qq.com') return /^\/s(?:\/|$)/.test(url.pathname);
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return false;
  return platform === 'other' && ['http:', 'https:'].includes(url.protocol);
}

export function createPageStore() {
  const pages = new Map<string, PageSnapshot>();
  let currentPageId: string | undefined;
  function clearCurrent() {
    const current = currentPageId && pages.get(currentPageId);
    if (current && current.status === 'loading') pages.set(current.id, { ...current, status: 'unavailable' });
    currentPageId = undefined;
  }
  return {
    begin(address: string, platform?: Platform) {
      clearCurrent();
      const url = new URL(address);
      url.hash = ''; url.username = ''; url.password = '';
      const supported = supportsPage(url, platform);
      // 微信旧式文章地址需要这些定位参数；不保留跟踪参数或授权令牌。
      const query = new URLSearchParams();
      if (url.hostname === 'mp.weixin.qq.com' && url.pathname === '/s') {
        for (const key of ['__biz', 'mid', 'idx', 'sn']) {
          const value = url.searchParams.get(key);
          if (value) query.set(key, value);
        }
      } else if (platform === 'other') {
        // 兼容常见 query 定位文章；不把任意跟踪参数或授权字段带入 AI 目录。
        for (const key of ['id', 'p', 'page_id', 'post_id', 'article_id', 'story_id', 'lang']) {
          const value = url.searchParams.get(key);
          if (value && /^[A-Za-z0-9_-]{1,128}$/.test(value)) query.set(key, value);
        }
      }
      url.search = query.toString();
      const id = randomUUID();
      pages.set(id, { id, url: url.href, title: '', text: '', truncated: false,
        status: supported ? 'loading' : 'unsupported' });
      currentPageId = id;
      return id;
    },
    complete(id: string, content: PageContent) {
      const page = pages.get(id);
      if (!page || page.status !== 'loading') return;
      pages.set(id, { ...page, title: content.title, text: content.text,
        truncated: content.truncated, status: 'ready', capturedAt: Date.now() });
    },
    fail(id: string) {
      const page = pages.get(id);
      if (page?.status === 'loading') pages.set(id, { ...page, status: 'unavailable' });
    },
    current: () => currentPageId ? pages.get(currentPageId) : undefined,
    // 快照不共享可变对象；本轮发送后切页或清理缓存均不影响工具读取。
    snapshot: (): PageContext => ({ currentPageId, pages: [...pages.values()]
      .filter(page => page.status === 'ready' || page.id === currentPageId).map(page => ({ ...page })) }),
    clearCurrent,
    clear() { pages.clear(); currentPageId = undefined; }
  };
}
