import type { Platform } from '@shared/contracts/settings';
import x from '@renderer/assets/platforms/x.svg';
import reddit from '@renderer/assets/platforms/reddit.png';
import youtube from '@renderer/assets/platforms/youtube.png';

const sources: Record<Platform, string> = { x, reddit, youtube };

// 品牌图形保留原始比例和颜色，不受通用线性图标的描边样式影响。
export function PlatformIcon({ platform }: { platform: Platform }) {
  return <img src={sources[platform]} width={24} height={24} alt="" aria-hidden="true" draggable={false} />;
}
