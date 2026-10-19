import { randomUUID } from 'node:crypto';
import type { PageContent, PageContext, PageSnapshot } from '@shared/contracts/page-context';
import type { Platform } from '@shared/contracts/settings';

type Capture = PageContent & { capturedAt: number };
type StoredPage = { snapshot: PageSnapshot; captures: Capture[]; manuallyManaged: boolean };

export function createPageStore() {
  const pages = new Map<string, StoredPage>();
  const idsByUrl = new Map<string, string>();
  let currentPageId: string | undefined;
  function clearCurrent() {
    const current = currentPageId ? pages.get(currentPageId) : undefined;
    if (current?.snapshot.status === 'loading') updateSnapshot(current);
    currentPageId = undefined;
  }
  function updateSnapshot(page: StoredPage) {
    const latest = page.captures.at(-1);
    const text = page.captures.length ? [
      `本页包含 ${page.captures.length} 次采集快照，各段对应不同采集时刻，不表示它们同时可见。最后一段为最新采集。`,
      ...page.captures.map((capture, index) => `【采集 ${index + 1} | ${new Date(capture.capturedAt).toISOString()}】\n${capture.text}`)
    ].join('\n\n') : '';
    page.snapshot = { ...page.snapshot, title: latest?.title ?? page.snapshot.title, text,
      truncated: page.captures.some(capture => capture.truncated), capturedAt: latest?.capturedAt,
      status: latest ? 'ready' : 'unavailable' };
  }
  return {
    begin(address: string, platform?: Platform) {
      clearCurrent();
      const url = new URL(address);
      url.username = ''; url.password = '';
      // 聚合使用真实 URL，不能用下方脱敏后的目录地址合并不同查询或 hash 路由。
      const identity = url.href;
      url.hash = '';
      const existingId = idsByUrl.get(identity);
      const existing = existingId ? pages.get(existingId) : undefined;
      if (existing) {
        currentPageId = existing.snapshot.id;
        if (!existing.manuallyManaged) existing.snapshot = { ...existing.snapshot, status: 'loading' };
        return currentPageId;
      }
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
      pages.set(id, { snapshot: { id, url: url.href, title: '', text: '', truncated: false,
        status: 'loading' }, captures: [], manuallyManaged: false });
      idsByUrl.set(identity, id);
      currentPageId = id;
      return id;
    },
    complete(id: string, content: PageContent) {
      const page = pages.get(id);
      if (!page || page.manuallyManaged || page.snapshot.status !== 'loading') return;
      page.captures = [{ ...content, capturedAt: Date.now() }];
      updateSnapshot(page);
    },
    capture(id: string, content: PageContent) {
      const page = pages.get(id);
      if (!page) return false;
      page.manuallyManaged = true;
      const duplicate = page.captures.findIndex(capture => capture.text === content.text);
      if (duplicate >= 0) page.captures.splice(duplicate, 1);
      page.captures.push({ ...content, capturedAt: Date.now() });
      updateSnapshot(page);
      return duplicate < 0;
    },
    clearPage(id: string) {
      const page = pages.get(id);
      if (!page) return;
      page.manuallyManaged = true;
      page.captures = [];
      updateSnapshot(page);
    },
    fail(id: string) {
      const page = pages.get(id);
      if (page?.snapshot.status === 'loading') updateSnapshot(page);
    },
    current: () => currentPageId ? pages.get(currentPageId)?.snapshot : undefined,
    metadata(id = currentPageId) {
      const page = id ? pages.get(id) : undefined;
      return { captureCount: page?.captures.length ?? 0, capturedAt: page?.snapshot.capturedAt,
        manuallyManaged: page?.manuallyManaged ?? false };
    },
    // 快照不共享可变对象；本轮发送后切页或清理缓存均不影响工具读取。
    snapshot: (): PageContext => ({ currentPageId, pages: [...pages.values()]
      .map(page => page.snapshot).filter(page => page.status === 'ready' || page.id === currentPageId).map(page => ({ ...page })) }),
    clearCurrent,
    clear() { pages.clear(); idsByUrl.clear(); currentPageId = undefined; }
  };
}
