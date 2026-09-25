import { randomUUID } from 'node:crypto';
import type { PageContent, PageContext, PageSnapshot } from '@shared/contracts/page-context';

// 仅接收文章详情页；首页、登录页、私信和 YouTube 不进入正文提取。
export function supportsPage(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'x.com' || host === 'twitter.com') return /\/(?:status|article)\/\d+/.test(url.pathname);
  if (host === 'reddit.com' || host === 'old.reddit.com') return /\/comments\/[a-z0-9]+/i.test(url.pathname);
  return host === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/.test(url.pathname);
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
    begin(address: string) {
      clearCurrent();
      const url = new URL(address);
      url.hash = ''; url.username = ''; url.password = '';
      const supported = supportsPage(url);
      // 微信旧式文章地址需要这些定位参数；不保留跟踪参数或授权令牌。
      const query = new URLSearchParams();
      if (url.hostname === 'mp.weixin.qq.com' && url.pathname === '/s') {
        for (const key of ['__biz', 'mid', 'idx', 'sn']) {
          const value = url.searchParams.get(key);
          if (value) query.set(key, value);
        }
      }
      url.search = query.toString();
      const id = randomUUID();
      pages.set(id, { id, url: url.href, title: '', text: '', truncated: false,
        status: supported ? 'loading' : 'unsupported' });
      currentPageId = id;
      if (pages.size > 20) {
        const oldest = pages.keys().next().value;
        if (oldest) pages.delete(oldest);
      }
      return id;
    },
    complete(id: string, content: PageContent) {
      const page = pages.get(id);
      if (!page || page.status !== 'loading') return;
      pages.set(id, { ...page, title: content.title.slice(0, 500), text: content.text.slice(0, 40000),
        truncated: content.truncated || content.text.length > 40000, status: 'ready', capturedAt: Date.now() });
    },
    fail(id: string) {
      const page = pages.get(id);
      if (page?.status === 'loading') pages.set(id, { ...page, status: 'unavailable' });
    },
    current: () => currentPageId ? pages.get(currentPageId) : undefined,
    // 快照不共享可变对象；本轮发送后切页或淘汰缓存均不影响工具读取。
    snapshot: (): PageContext => ({ currentPageId, pages: [...pages.values()]
      .filter(page => page.status === 'ready' || page.id === currentPageId).map(page => ({ ...page })) }),
    clearCurrent,
    clear() { pages.clear(); currentPageId = undefined; }
  };
}
