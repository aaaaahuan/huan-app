import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';

export function ReadingPlaceholder({ loading, enabled, hasItems, failed, onConfigure }: {
  loading: boolean; enabled: boolean; hasItems: boolean; failed: boolean; onConfigure(): void;
}) {
  return <div className="reading-placeholder">
    <div className="empty-mark"><Icon name="book" width="36" height="36" /></div>
    <h2>{loading ? '正在读取收藏' : !enabled ? '配置收藏来源' : hasItems ? '选择一条收藏' : failed ? '收藏暂不可用' : '暂无收藏'}</h2>
    <p>{loading ? '正在读取本地 Markdown 与最近成功读取的副本。' : !enabled ? '在设置中选择 Markdown 文件，并启用对应来源。' : hasItems ? '打开顶部的收藏列表，选择要阅读的内容。' : failed ? '当前没有可用条目，请检查来源设置与文件路径。' : '来源文件已读取，当前没有收藏条目。'}</p>
    {!enabled && !loading ? <Button variant="primary" onClick={onConfigure}>配置收藏来源</Button> : null}
  </div>;
}
