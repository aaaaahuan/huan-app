// 收藏列表的纯界面层：按原顺序展示全部筛选结果，不自行读取文件。
import { useState } from 'react';
import type { Bookmark, BookmarkLibrary } from '@shared/contracts/bookmarks';
import { PLATFORMS, PLATFORM_NAMES, type Platform } from '@shared/contracts/settings';
import { Icon } from '@renderer/components/Icon';
import { IconInput } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { BookmarkCard } from './BookmarkCard';

const platformOptions: { value: Platform | 'all'; label: string }[] = [
  { value: 'all', label: '全部平台' }, ...PLATFORMS.map((value) => ({ value, label: PLATFORM_NAMES[value] }))
];

/**
 * 收藏列表的纯界面层：按原顺序展示全部筛选结果
 */
export function BookmarkList({ library, loading, collapsed, selectedId, onSelect }: {
  library: BookmarkLibrary | undefined;
  loading: boolean;
  collapsed: boolean;
  selectedId: string | null;
  onSelect(bookmark: Bookmark): void;
}) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');

  const all = library?.sources.flatMap((source) => source.items) ?? [];
  const search = query.trim().toLocaleLowerCase();
  const filtered = all.filter((item) => (platform === 'all' || item.platform === platform)
    && (!search || item.title.toLocaleLowerCase().includes(search) || item.url.toLocaleLowerCase().includes(search)));

  return <aside id="bookmark-sidebar" className="bookmark-sidebar" hidden={collapsed} aria-label="收藏列表">
    {/* 折叠只隐藏内容，不卸载整个列表，保留搜索和筛选状态。 */}
    <div className="library-content">
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
          {/* 空状态只展示图形，辅助技术仍能区分无收藏与无匹配结果。 */}
          <span className="visually-hidden">{all.length ? '没有匹配的收藏' : '暂无收藏笔记'}</span>
          <Icon name="bookmarks" />
        </div> : null}
        {/* 标题与链接按纯文本渲染，不执行笔记中的 HTML。 */}
        <ul className="bookmark-items">{filtered.map((item) => <li key={item.id}>
          <BookmarkCard item={item} selected={selectedId === item.id} onSelect={onSelect} />
        </li>)}</ul>
      </div>
    </div>
  </aside>;
}
