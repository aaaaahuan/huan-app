// 应用外壳：协调收藏选择、原页阅读与设置弹窗，不参与远程网页内部逻辑。
import { useEffect, useState } from 'react';
import type { BookmarkLibrary } from '../../../shared/contracts/bookmarks';
import { PLATFORM_NAMES } from '../../../shared/contracts/settings';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { BookmarkList } from '../features/bookmarks/BookmarkList';
import { Reader } from '../features/reader/Reader';
import '../features/bookmarks/bookmarks.css';

export function App() {
  const [library, setLibrary] = useState<BookmarkLibrary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  // 下列界面状态仅保留在本轮运行中，不写回 Obsidian 或收藏副本。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    // 设置保存后重新查询主进程结果；主进程负责决定哪些来源需要真正重读。
    let cancelled = false;
    setLoading(true);
    setError('');
    void window.huanApp.bookmarks.get().then((value) => {
      if (cancelled) return;
      setLibrary(value);
      // 只清除已不存在的选择，不因数据更新自动切到第一条。
      setSelectedId((id) => value.sources.some((source) => source.items.some((item) => item.id === id)) ? id : null);
    }, () => { if (!cancelled) setError('无法取得收藏列表，请完全退出应用后重试。'); }
    ).finally(() => { if (!cancelled) setLoading(false); });
    // 忽略旧请求的迟到结果，避免覆盖设置更新后的列表或已卸载组件。
    return () => { cancelled = true; };
  }, [revision]);
  const selected = library?.sources.flatMap((source) => source.items).find((item) => item.id === selectedId);
  const enabled = library?.sources.some((source) => source.state !== 'disabled');
  const hasItems = library?.sources.some((source) => source.items.length > 0);
  const failures = library?.sources.filter((source) => source.state === 'cached' || source.state === 'error') ?? [];
  async function openSettings() {
    // 原生视图不受 DOM z-index 约束，确认隐藏后才能打开设置对话框。
    try { await window.huanApp.browser.suspend(true); setFeedback(''); setSettingsOpen(true); }
    catch { setError('无法隐藏网页容器，请重试打开设置。'); }
  }
  function closeSettings() {
    setSettingsOpen(false);
    void window.huanApp.browser.suspend(false).catch(() => setError('无法恢复网页容器，请重启应用。'));
  }
  return <div className="workspace-shell">
    <header className="titlebar"><span>huan-app</span><div className="titlebar-actions"><span className="stage">A4 · 原页阅读</span>
      <button className="settings-trigger" onClick={openSettings}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/></svg>设置</button></div></header>
    {error || library?.warning || failures.length ? <div className="library-alert" role="alert">
      {error ? <p>{error}</p> : null}{library?.warning ? <p>{library.warning}</p> : null}
      {failures.map((source) => <p key={source.platform}>{PLATFORM_NAMES[source.platform]}：{source.message}</p>)}
      <button type="button" onClick={openSettings}>检查来源设置</button>
    </div> : null}
    {feedback ? <div className="settings-feedback" role="status">{feedback}</div> : null}
    <div className="workspace">
      <BookmarkList library={library} loading={loading} collapsed={collapsed} selectedId={selectedId}
        onSelect={(item) => setSelectedId(item.id)} onCollapse={() => setCollapsed((value) => !value)} />
      <Reader selected={selected} suspended={settingsOpen} layoutKey={`${collapsed}:${feedback}:${error}:${library?.warning}:${failures.length}`}>
        <div className="reading-placeholder">
          <>
            <div className="empty-mark" aria-hidden="true">▤</div>
            <h2>{loading ? '正在连接你的笔记' : !enabled ? '从收藏笔记开始' : hasItems ? '留一点空间，开始阅读' : '这里等待你的下一条收藏'}</h2>
            <p>{loading ? '读取本地 Markdown，并检查最近成功读取的副本。' : !enabled ? '在右上角设置中，为平台选择 Markdown 文件并启用来源。' : hasItems ? '从左侧选择一条收藏。应用不会自动替你打开第一条。' : failures.length || library?.warning ? '当前没有可用条目，请检查来源状态与文件路径。' : '来源文件已读取，当前表格为空。下次启动将按笔记内容重新读取。'}</p>
            {!enabled && !loading ? <button type="button" onClick={openSettings}>配置收藏来源</button> : null}
          </>
        </div>
      </Reader>
    </div>
    {settingsOpen ? <SettingsPanel onClose={closeSettings} onSaved={() => {
      closeSettings(); setRevision((value) => value + 1);
    }} /> : null}
  </div>;
}
