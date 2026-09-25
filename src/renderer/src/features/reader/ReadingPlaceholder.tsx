import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';

export function ReadingPlaceholder({ loading, enabled, hasItems, failed, onConfigure }: {
  loading: boolean; enabled: boolean; hasItems: boolean; failed: boolean; onConfigure(): void;
}) {
  return <div className="reading-placeholder">
    <div className="empty-mark"><Icon name="book" width="48" height="48" /></div>
    <h2>{loading ? '正在连接你的笔记' : !enabled ? '从收藏笔记开始' : hasItems ? '留一点空间，开始阅读' : '这里等待你的下一条收藏'}</h2>
    <p>{loading ? '读取本地 Markdown，并检查最近成功读取的副本。' : !enabled ? '在右上角设置中，为平台选择 Markdown 文件并启用来源。' : hasItems ? '从左侧选择一条收藏，继续阅读。' : failed ? '当前没有可用条目，请检查来源设置与文件路径。' : '来源文件已读取，当前表格为空。下次启动将按笔记内容重新读取。'}</p>
    {!enabled && !loading ? <Button onClick={onConfigure}>配置收藏来源</Button> : null}
  </div>;
}
