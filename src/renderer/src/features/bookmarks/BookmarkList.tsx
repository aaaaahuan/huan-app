// 收藏列表的纯界面层：按原顺序展示全部筛选结果，不自行读取文件。
import { useDeferredValue, useState } from 'react';
import type { Bookmark, BookmarkLibrary } from '@shared/contracts/bookmarks';
import { PLATFORMS, PLATFORM_NAMES, type Platform } from '@shared/contracts/settings';

export function BookmarkList({ library, loading, collapsed, selectedId, onSelect, onCollapse }: {
  library: BookmarkLibrary | undefined;
  loading: boolean;
  collapsed: boolean;
  selectedId: string | null;
  onSelect(bookmark: Bookmark): void;
  onCollapse(): void;
}) {
  const [query, setQuery] = useState('');
  // 延后结果计算，让输入框优先响应；搜索不改变原始收藏顺序。
  const deferredQuery = useDeferredValue(query);
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const all = library?.sources.flatMap((source) => source.items) ?? [];
  const search = deferredQuery.trim().toLocaleLowerCase();
  const filtered = all.filter((item) => (platform === 'all' || item.platform === platform)
    && (!search || item.title.toLocaleLowerCase().includes(search) || item.url.toLocaleLowerCase().includes(search)));
  return <aside className={`bookmark-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="收藏列表">
    <div className="library-heading">
      {!collapsed ? <h1>收藏 <span>{all.length}</span></h1> : null}
      <button type="button" className="collapse-button" aria-label={collapsed ? '展开收藏列表' : '收起收藏列表'}
        aria-expanded={!collapsed} aria-controls="bookmark-list-content" onClick={onCollapse} title={collapsed ? '展开收藏列表' : '收起收藏列表'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>{collapsed ? <path d="m13 9 3 3-3 3"/> : <path d="m17 9-3 3 3 3"/>}</svg>
      </button>
    </div>
    {/* 折叠只隐藏内容，不卸载整个列表，保留搜索和筛选状态。 */}
    <div id="bookmark-list-content" className="library-content" hidden={collapsed}>
      <div className="library-controls">
        <label className="visually-hidden" htmlFor="bookmark-search">搜索标题或链接</label>
        <input id="bookmark-search" type="search" placeholder="搜索标题或链接" value={query}
          onChange={(event) => setQuery(event.target.value)} />
        <label className="visually-hidden" htmlFor="platform-filter">筛选平台</label>
        <select id="platform-filter" value={platform} onChange={(event) => setPlatform(event.target.value as Platform | 'all')}>
          <option value="all">全部平台</option>{PLATFORMS.map((id) => <option key={id} value={id}>{PLATFORM_NAMES[id]}</option>)}
        </select>
      </div>
      <div className="bookmark-scroll" aria-busy={loading}>
        {loading && !library ? <p className="library-empty" role="status">正在读取本地收藏…</p> : null}
        {!loading && !filtered.length ? <div className="library-empty-icon" role="status">
          {/* 空状态只展示图形，辅助技术仍能区分无收藏与无匹配结果。 */}
          <span className="visually-hidden">{all.length ? '没有匹配的收藏' : '暂无收藏笔记'}</span>
          <svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
            <circle cx="48" cy="48" r="39" fill="#eff5ed" />
            <rect x="26" y="25" width="39" height="49" rx="7" fill="#e3eddf" transform="rotate(-8 26 25)" />
            <rect x="30" y="21" width="38" height="50" rx="7" fill="#fafcf8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M49 22v22l6-4 6 4V22M39 54h19M39 61h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div> : null}
        {/* 标题与链接按纯文本渲染，不执行笔记中的 HTML。 */}
        <ul className="bookmark-items">{filtered.map((item) => <li key={item.id}>
          <button type="button" className={`bookmark-item${selectedId === item.id ? ' selected' : ''}`}
            aria-current={selectedId === item.id ? 'true' : undefined} onClick={() => onSelect(item)}>
            <span className="bookmark-platform">{PLATFORM_NAMES[item.platform]}<span>{item.source}</span></span>
            <span className="bookmark-title">{item.title}</span><span className="bookmark-url">{item.url}</span>
          </button>
        </li>)}</ul>
      </div>
    </div>
  </aside>;
}
