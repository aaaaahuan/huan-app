import type { Bookmark } from '@shared/contracts/bookmarks';
import { PLATFORM_NAMES } from '@shared/contracts/settings';
import { Button } from '@renderer/components/Button';
import { PlatformIcon } from '@renderer/components/PlatformIcon';
import { TruncatedText } from '@renderer/components/TruncatedText';

export function BookmarkCard({ item, selected, onSelect }: { item: Bookmark; selected: boolean; onSelect(item: Bookmark): void }) {
  const title = item.title || item.url;
  return <Button className={`bookmark-item${selected ? ' selected' : ''}`} aria-current={selected ? 'true' : undefined}
    aria-label={`${PLATFORM_NAMES[item.platform]}：${title}，${item.url}`} onClick={() => onSelect(item)}>
    <span className={`platform-icon platform-icon--${item.platform}`} title={PLATFORM_NAMES[item.platform]}><PlatformIcon platform={item.platform} /></span>
    <span className="bookmark-info"><TruncatedText className="bookmark-title" text={title} /><TruncatedText className="bookmark-url" text={item.url} /></span>
  </Button>;
}
