// 收藏列表的纯界面层：按采集日期倒序展示筛选结果，不自行读取文件。
import { useState } from 'react';
import type { Bookmark, BookmarkLibrary } from '@shared/contracts/bookmarks';
import { PLATFORMS, PLATFORM_NAMES, type Platform } from '@shared/contracts/settings';
import { Icon } from '@renderer/components/Icon';
import { IconButton } from '@renderer/components/Button';
import { IconInput } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { BookmarkCard } from './BookmarkCard';

const platformOptions: { value: Platform | 'all'; label: string }[] = [
  { value: 'all', label: '全部平台' }, ...PLATFORMS.map((value) => ({ value, label: PLATFORM_NAMES[value] }))
];

function collectionDate(value: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : '';
}

export function BookmarkList({ library, loading, collapsed, selectedId, readBusy, onSelect, onToggleRead, onToggleCollapsed }: {
  library: BookmarkLibrary | undefined;
  loading: boolean;
  collapsed: boolean;
  selectedId: string | null;
  readBusy: boolean;
  onSelect(bookmark: Bookmark): void;
  onToggleRead(bookmark: Bookmark): void;
  onToggleCollapsed(): void;
}) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');

  const all = library?.sources.flatMap((source) => source.items) ?? [];
  const search = query.trim().toLocaleLowerCase();
  const filtered = all.filter((item) => (platform === 'all' || item.platform === platform)
    && (!search || item.title.toLocaleLowerCase().includes(search) || item.url.toLocaleLowerCase().includes(search)))
    .map((item) => ({ item, date: collectionDate(item.collectedAt) }))
    // ISO 日期可直接比较；空日期排末尾，同日依靠稳定排序保留原顺序。
    .sort((a, b) => b.date.localeCompare(a.date));

  // 整体隐藏退出布局和焦点顺序，但保持挂载以保留筛选与列表滚动位置。
  return <aside id="bookmark-sidebar" className="bookmark-sidebar" hidden={collapsed} aria-label="收藏列表">
    <header className="library-header">
      <div className="library-heading"><h2>收藏</h2>{library ? <span className="library-count">{filtered.length} 条</span> : null}</div>
      <IconButton className="bookmark-panel-toggle" icon="collapse" label="收起收藏列表" aria-expanded={!collapsed}
        aria-controls="bookmark-sidebar-content" onClick={onToggleCollapsed} />
    </header>
    <div id="bookmark-sidebar-content" className="library-content">
      <div className="library-controls">
        <label className="visually-hidden" htmlFor="bookmark-search">搜索标题或链接</label>
        <IconInput icon="search" id="bookmark-search" type="search" placeholder="搜索收藏" value={query}
          onChange={(event) => setQuery(event.target.value)} />
        <label className="visually-hidden" htmlFor="platform-filter">筛选平台</label>
        <Select<Platform | 'all'> id="platform-filter" value={platform} options={platformOptions} onValueChange={setPlatform} />
      </div>
      <div className="bookmark-scroll" aria-busy={loading}>
        {loading && !library ? <p className="library-empty" role="status">正在读取本地收藏…</p> : null}
        {!loading && !filtered.length ? <div className="library-empty-icon" role="status">
          <Icon name="bookmarks" />
          <p>{all.length ? '没有匹配的收藏' : '暂无收藏笔记'}</p>
        </div> : null}
        {/* 标题与链接按纯文本渲染，不执行笔记中的 HTML。 */}
        <ul className="bookmark-items">{filtered.map(({ item, date }, index) => <li key={item.id}>
          {index === 0 || date !== filtered[index - 1].date ? <div className="bookmark-date-divider">
            {date ? <time dateTime={date}>{date}</time> : <span>日期未知</span>}
          </div> : null}
          <BookmarkCard item={item} selected={selectedId === item.id} onSelect={onSelect}
            readDisabled={readBusy || !library?.sources.some(source => source.platform === item.platform && source.state === 'ready')}
            onToggleRead={onToggleRead} />
        </li>)}</ul>
      </div>
    </div>
  </aside>;
}
