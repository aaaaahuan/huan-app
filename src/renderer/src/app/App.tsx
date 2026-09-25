// 应用外壳：协调收藏选择、原页阅读与设置弹窗，不参与远程网页内部逻辑。
import { useEffect, useState } from 'react';
import type { BookmarkLibrary } from '@shared/contracts/bookmarks';
import { PLATFORM_NAMES } from '@shared/contracts/settings';
import { SettingsPanel } from '@renderer/features/settings/SettingsPanel';
import { BookmarkList } from '@renderer/features/bookmarks/BookmarkList';
import { Reader } from '@renderer/features/reader/Reader';
import { ReadingPlaceholder } from '@renderer/features/reader/ReadingPlaceholder';
import { Button, IconButton } from '@renderer/components/Button';
import { AIChat } from '@renderer/features/ai-chat/AIChat';
import '@renderer/components/controls.css';
import '@renderer/features/bookmarks/bookmarks.css';

export function App() {
  const [library, setLibrary] = useState<BookmarkLibrary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  // 下列界面状态仅保留在本轮运行中，不写回 Obsidian 或收藏副本。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'sources' | 'ai'>('sources');
  const [feedback, setFeedback] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [aiCollapsed, setAICollapsed] = useState(false);
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
  async function openSettings(tab: 'sources' | 'ai' = 'sources') {
    // 原生视图不受 DOM z-index 约束，确认隐藏后才能打开设置对话框。
    try { await window.huanApp.browser.suspend(true); setFeedback(''); setSettingsTab(tab); setSettingsOpen(true); }
    catch { setError('无法隐藏网页容器，请重试打开设置。'); }
  }
  function closeSettings() {
    setSettingsOpen(false);
    void window.huanApp.browser.suspend(false).catch(() => setError('无法恢复网页容器，请重启应用。'));
  }
  return <div className="workspace-shell">
    <div className="titlebar">
      <IconButton icon={collapsed ? 'expand' : 'collapse'} label={collapsed ? '展开收藏列表' : '收起收藏列表'}
        aria-expanded={!collapsed} aria-controls="bookmark-sidebar" onClick={() => setCollapsed(value => !value)} />
      <div className="titlebar-actions">
        <IconButton icon="settings" label="设置" onClick={() => void openSettings()} />
        <IconButton className="right-panel-toggle" icon={aiCollapsed ? 'expand' : 'collapse'} label={aiCollapsed ? '展开 AI 伴读' : '收起 AI 伴读'}
          aria-expanded={!aiCollapsed} aria-controls="ai-chat" onClick={() => setAICollapsed(value => !value)} />
      </div>
    </div>
    {error || library?.warning || failures.length ? <div className="library-alert" role="alert">
      {error ? <p>{error}</p> : null}{library?.warning ? <p>{library.warning}</p> : null}
      {failures.map((source) => <p key={source.platform}>{PLATFORM_NAMES[source.platform]}：{source.message}</p>)}
      <Button onClick={() => void openSettings()}>检查来源设置</Button>
    </div> : null}
    {feedback ? <div className="settings-feedback" role="status">{feedback}</div> : null}
    <div className="workspace">
      <BookmarkList library={library} loading={loading} collapsed={collapsed} selectedId={selectedId}
        onSelect={(item) => setSelectedId(item.id)} />
      <Reader selected={selected} suspended={settingsOpen} layoutKey={`${collapsed}:${aiCollapsed}:${feedback}:${error}:${library?.warning}:${failures.length}`}>
        <ReadingPlaceholder loading={loading} enabled={!!enabled} hasItems={!!hasItems}
          failed={!!(error || failures.length || library?.warning)} onConfigure={() => void openSettings()} />
      </Reader>
      <AIChat collapsed={aiCollapsed} settingsRevision={revision} onConfigure={() => void openSettings('ai')} />
    </div>
    {settingsOpen ? <SettingsPanel initialTab={settingsTab} onClose={closeSettings} onSaved={() => {
      closeSettings(); setRevision((value) => value + 1);
    }} /> : null}
  </div>;
}
