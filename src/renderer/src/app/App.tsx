// 应用外壳：协调收藏选择、原页阅读与设置弹窗，不参与远程网页内部逻辑。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Bookmark, BookmarkLibrary } from '@shared/contracts/bookmarks';
import { PLATFORM_NAMES } from '@shared/contracts/settings';
import { SettingsPanel } from '@renderer/features/settings/SettingsPanel';
import { BookmarkList } from '@renderer/features/bookmarks/BookmarkList';
import { Reader } from '@renderer/features/reader/Reader';
import { ReadingPlaceholder } from '@renderer/features/reader/ReadingPlaceholder';
import { Button, IconButton } from '@renderer/components/Button';
import { ReadingAssistant } from '@renderer/features/reading-assistant/ReadingAssistant';
import { PanelDivider } from '@renderer/components/PanelDivider';
import { usePanelWidths, type PanelSide } from './usePanelWidths';
import { Navigation, type SystemPage } from './Navigation';
import { Translation } from '@renderer/features/translation/Translation';
import { AlgorithmTraining } from '@renderer/features/algorithms/AlgorithmTraining';
import '@renderer/components/controls.css';
import '@renderer/features/bookmarks/bookmarks.css';
import './navigation.css';
import { ModelSwitcher } from './ModelSwitcher';
import type { ModelSelection } from '@shared/contracts/models';

export function App() {
  const [library, setLibrary] = useState<BookmarkLibrary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [modelSelection, setModelSelection] = useState<ModelSelection>();
  const [modelSaving, setModelSaving] = useState(false);
  const modelPending = useRef(false);
  const modelVersion = useRef(0);
  const [activePage, setActivePage] = useState<SystemPage>('reading');
  const [navigationBusy, setNavigationBusy] = useState(false);
  const navigationPending = useRef(false);
  // 下列界面状态仅保留在本轮运行中，不写回 Obsidian 或收藏副本。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'sources' | 'ai' | 'subtitles'>('sources');
  const [feedback, setFeedback] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [aiCollapsed, setAICollapsed] = useState(false);
  const [panelPriority, setPanelPriority] = useState<PanelSide>('right');
  const [focusLayout, setFocusLayout] = useState<{ left: boolean; right: boolean }>();
  const panels = usePanelWidths(collapsed, aiCollapsed, panelPriority);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const readPending = useRef(false);

  useEffect(() => {
    if (modelPending.current) return;
    const version = ++modelVersion.current;
    let cancelled = false;
    void window.huanApp.ai.getSelection().then(result => {
      if (cancelled || version !== modelVersion.current) return;
      if (result.ok) setModelSelection(result.value);
      else setFeedback(result.message);
    }).catch(error => { if (!cancelled && version === modelVersion.current) setFeedback(String(error)); });
    return () => { cancelled = true; };
  }, [revision]);

  async function selectModel(selection: ModelSelection) {
    if (modelPending.current) return;
    ++modelVersion.current;
    modelPending.current = true; setModelSaving(true); setFeedback('');
    try {
      const result = await window.huanApp.ai.selectModel(selection);
      if (result.ok) setModelSelection(result.value);
      else setFeedback(result.message);
    } catch (error) { setFeedback(String(error)); }
    finally { modelPending.current = false; setModelSaving(false); }
  }

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
    }, error => { if (!cancelled) setError(String(error)); }
    ).finally(() => { if (!cancelled) setLoading(false); });
    // 忽略旧请求的迟到结果，避免覆盖设置更新后的列表或已卸载组件。
    return () => { cancelled = true; };
  }, [revision]);

  const selected = library?.sources.flatMap((source) => source.items).find((item) => item.id === selectedId);
  const enabled = library?.sources.some((source) => source.state !== 'disabled');
  const hasItems = library?.sources.some((source) => source.items.length > 0);
  const failures = library?.sources.filter((source) => source.state === 'cached' || source.state === 'error') ?? [];
  async function openSettings(tab: 'sources' | 'ai' | 'subtitles' = 'sources') {
    // 原生视图不受 DOM z-index 约束，确认隐藏后才能打开设置对话框。
    try { await window.huanApp.browser.suspend(true); setFeedback(''); setSettingsTab(tab); setSettingsOpen(true); }
    catch (error) { setError(String(error)); }
  }
  function closeSettings() {
    setSettingsOpen(false);
    void window.huanApp.browser.suspend(activePage !== 'reading').catch(error => setFeedback(String(error)));
  }
  async function navigate(page: SystemPage) {
    if (page === activePage || navigationPending.current) return;
    navigationPending.current = true; setNavigationBusy(true); setFeedback('');
    try {
      // 原生网页不受 DOM hidden/z-index 约束，隐藏确认后再展示其他系统。
      await window.huanApp.browser.suspend(page !== 'reading' || settingsOpen);
      setActivePage(page);
    } catch (error) { setFeedback(String(error)); }
    finally { navigationPending.current = false; setNavigationBusy(false); }
  }
  async function toggleRead(item: Bookmark) {
    if (readPending.current) return;
    readPending.current = true; setReadBusy(true); setFeedback('');
    try {
      const result = await window.huanApp.bookmarks.setRead({ id: item.id, read: !item.read });
      if (result.ok) setLibrary(result.library);
      else setFeedback(result.message);
    } catch (error) { setFeedback(`未能确认已读状态写入结果：${String(error)}`); }
    finally { readPending.current = false; setReadBusy(false); }
  }
  function togglePanel(side: PanelSide) {
    setFocusLayout(undefined);
    setPanelPriority(side);
    if (side === 'left') {
      setCollapsed(!panels.hideLeft);
      if (panels.compact) setAICollapsed(true);
    } else {
      setAICollapsed(!panels.hideRight);
      if (panels.compact) setCollapsed(true);
    }
    requestAnimationFrame(() => document.getElementById(side === 'left' ? 'reading-collection-toggle' : 'reading-assistant-toggle')?.focus());
  }
  function toggleFocus() {
    if (focusLayout) {
      setCollapsed(focusLayout.left); setAICollapsed(focusLayout.right); setFocusLayout(undefined);
    } else {
      setFocusLayout({ left: panels.hideLeft, right: panels.hideRight });
      setCollapsed(true); setAICollapsed(true);
    }
  }
  return <div className="workspace-shell">
    <div className="titlebar">
      <span className="navigation-brand">huan</span>
      <Navigation active={activePage} busy={navigationBusy || settingsOpen} onChange={page => void navigate(page)} />
      <div className="titlebar-actions">
        <ModelSwitcher selection={modelSelection} disabled={modelSaving || settingsOpen} onChange={selection => void selectModel(selection)} />
        {activePage === 'reading' ? <Button className="focus-toggle" aria-label={focusLayout ? '恢复阅读布局' : '进入专注阅读'}
          aria-pressed={!!focusLayout} disabled={settingsOpen || navigationBusy} onClick={toggleFocus}>
          {focusLayout ? '恢复布局' : '专注'}</Button> : null}
        <IconButton className="settings-toggle" icon="settings" label="设置" disabled={readBusy || navigationBusy || settingsOpen}
          onClick={() => void openSettings()} />
      </div>
    </div>
    <div className="application-body">
    <div className="application-content">
    {feedback ? <div className="settings-feedback" role="status">{feedback}</div> : null}
    <div className="reading-system" hidden={activePage !== 'reading'}>
    {error || library?.warning || failures.length ? <div className="library-alert" role="alert">
      {error ? <p>{error}</p> : null}{library?.warning ? <p>{library.warning}</p> : null}
      {failures.map((source) => <p key={source.platform}>{PLATFORM_NAMES[source.platform]}：{source.message}</p>)}
      <Button onClick={() => void openSettings()}>检查来源设置</Button>
    </div> : null}
      <Reader selected={selected} suspended={settingsOpen || activePage !== 'reading'}
        layoutKey={`${activePage}:${panels.hideLeft}:${panels.hideRight}:${panels.left}:${panels.right}:${feedback}:${error}:${library?.warning}:${failures.length}`}
        workspaceRef={panels.workspace} dragging={panels.dragging}
        workspaceStyle={{ '--left-panel-width': `${panels.left}px`, '--right-panel-width': `${panels.right}px` } as CSSProperties}
        leftCollapsed={panels.hideLeft} rightCollapsed={panels.hideRight}
        onToggleLeft={() => togglePanel('left')} onToggleRight={() => togglePanel('right')}
        leadingPanel={<>
          <BookmarkList library={library} loading={loading} collapsed={panels.hideLeft} selectedId={selectedId}
            onToggleCollapsed={() => togglePanel('left')} readBusy={readBusy} onToggleRead={item => void toggleRead(item)}
            onSelect={(item) => setSelectedId(item.id)} />
          {!panels.hideLeft ? <PanelDivider label="调整收藏列表宽度" controls="bookmark-sidebar" value={panels.left}
            {...panels.limits.left} direction={1} onStart={x => panels.start('left', x)} onMove={panels.move}
            onEnd={panels.end} onChange={value => panels.change('left', value)} /> : null}
        </>}
        trailingPanel={<>
          {!panels.hideRight ? <PanelDivider label="调整 AI 对话宽度" controls="ai-chat" value={panels.right}
            {...panels.limits.right} direction={-1} onStart={x => panels.start('right', x)} onMove={panels.move}
            onEnd={panels.end} onChange={value => panels.change('right', value)} /> : null}
          <ReadingAssistant collapsed={panels.hideRight}
            settingsRevision={revision} modelSelection={modelSelection} modelChanging={modelSaving} onConfigure={tab => void openSettings(tab)} />
        </>}>
        <ReadingPlaceholder loading={loading} enabled={!!enabled} hasItems={!!hasItems}
          failed={!!(error || failures.length || library?.warning)} onConfigure={() => void openSettings()} />
      </Reader>
    </div>
    <Translation active={activePage === 'translation'} selection={modelSelection} modelChanging={modelSaving} />
    <AlgorithmTraining active={activePage === 'algorithms'} blocked={settingsOpen || navigationBusy} />
    </div>
    </div>
    {settingsOpen ? <SettingsPanel initialTab={settingsTab} onClose={closeSettings} onSaved={() => {
      closeSettings(); setRevision((value) => value + 1);
    }} /> : null}
  </div>;
}
