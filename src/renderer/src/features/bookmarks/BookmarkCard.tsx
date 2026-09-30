import type { Bookmark } from '@shared/contracts/bookmarks';
import { PLATFORM_NAMES } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { PlatformIcon } from '@renderer/components/PlatformIcon';
import { TruncatedText } from '@renderer/components/TruncatedText';

export function BookmarkCard({ item, selected, readDisabled, onSelect, onToggleRead }: {
  item: Bookmark; selected: boolean; readDisabled: boolean; onSelect(item: Bookmark): void; onToggleRead(item: Bookmark): void;
}) {
  const title = item.title || item.url;
  return <div className={`bookmark-card${item.read ? ' is-read' : ''}`}>
    <Button className={`bookmark-item${selected ? ' selected' : ''}`} aria-current={selected ? 'true' : undefined}
    aria-label={`${PLATFORM_NAMES[item.platform]}：${title}，${item.url}`} onClick={() => onSelect(item)}>
    <span className={`platform-icon platform-icon--${item.platform}`} title={PLATFORM_NAMES[item.platform]}><PlatformIcon platform={item.platform} /></span>
    <span className="bookmark-info"><TruncatedText className="bookmark-title" text={title} /><TruncatedText className="bookmark-url" text={item.url} /></span>
    </Button>
    <input className="bookmark-read-toggle" type="checkbox" disabled={readDisabled} checked={item.read}
      aria-label={`已读：${title}`} title={item.read ? '取消勾选，标记为未读' : '勾选，标记为已读'}
      onChange={() => onToggleRead(item)} />
  </div>;
}
