// React 负责工具栏和占位区域，远程网页由主进程的原生视图绘制。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Bookmark } from '@shared/contracts/bookmarks';
import { readerStateSchema, type ReaderAction, type ReaderState } from '@shared/contracts/browser';
import { youtubeVideoId } from '@shared/contracts/subtitles';
import { Button, IconButton } from '@renderer/components/Button';
import { Input } from '@renderer/components/Input';
import { Icon } from '@renderer/components/Icon';
import './reader.css';

export function Reader({ selected, suspended, layoutKey, children, leadingPanel, trailingPanel, workspaceRef, workspaceStyle,
  dragging, leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight }: {
  selected?: Bookmark; suspended: boolean; layoutKey: string; children: ReactNode;
  leadingPanel: ReactNode; trailingPanel: ReactNode; workspaceRef: RefObject<HTMLDivElement | null>; workspaceStyle: CSSProperties;
  dragging: boolean; leftCollapsed: boolean; rightCollapsed: boolean; onToggleLeft(): void; onToggleRight(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ReaderState>();
  const [error, setError] = useState('');
  const [contextBusy, setContextBusy] = useState<'captureContext' | 'clearContext' | undefined>(undefined);
  const [contextActionsOpen, setContextActionsOpen] = useState(false);
  const id = selected?.id ?? null;
  const activeId = useRef(id);
  const contextOperation = useRef<{ id: string; action: 'captureContext' | 'clearContext' } | undefined>(undefined);
  const current = state?.bookmarkId === id ? state : undefined;
  const subtitlePage = !!youtubeVideoId(current?.url || selected?.url || '');
  const contextUnavailable = !current?.pageId || suspended
    || subtitlePage || current.contentStatus === 'unsupported' || current.contentStatus === 'empty';
  const captureDisabled = contextUnavailable || current?.phase !== 'ready' || !!contextBusy
    || current?.capturing || current?.contentStatus === 'loading';
  const clearDisabled = contextUnavailable || contextBusy === 'clearContext'
    || (!current?.capturing && contextBusy !== 'captureContext' && !current?.captureCount);
  const capturedAt = current?.capturedAt ? new Date(current.capturedAt) : undefined;
  const contextMessage = contextBusy === 'clearContext' ? '正在清空本页上下文…'
    : current?.capturing || contextBusy === 'captureContext' ? '正在提取当前页面上下文…'
    : current?.captureMessage || (subtitlePage ? '视频内容请在「实时字幕」中获取。'
      : current?.contentStatus === 'unsupported' ? '当前页面暂不支持正文提取。' : '');
  function accept(value: ReaderState) {
    const parsed = readerStateSchema.safeParse(value);
    // IPC 返回值与事件可能交错，只接受更新的状态版本。
    if (parsed.success && parsed.data.bookmarkId === activeId.current)
      setState((previous) => !previous || parsed.data.revision >= previous.revision ? parsed.data : previous);
  }
  useEffect(() => {
    const unsubscribe = window.huanApp.browser.onState(accept);
    void window.huanApp.browser.get().then(accept, () => setError('无法连接网页容器。'));
    return unsubscribe;
  }, []);
  useEffect(() => {
    let cancelled = false;
    activeId.current = id;
    contextOperation.current = undefined;
    setContextBusy(undefined);
    setContextActionsOpen(false);
    setError('');
    void window.huanApp.browser.select(id).then(value => { if (!cancelled) accept(value); }, () => {
      if (!cancelled) setError('无法打开收藏，请重新选择。');
    });
    return () => { cancelled = true; activeId.current = null; contextOperation.current = undefined; };
  }, [id]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    function report() {
      const rect = element!.getBoundingClientRect();
      void window.huanApp.browser.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        visible: !!id && !suspended && !dragging }).catch(() => setError('网页区域定位失败，请重启应用。'));
    }
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [id, suspended, dragging, layoutKey, current?.notice, current?.message, current?.captureCount, current?.capturedAt, contextActionsOpen, contextMessage, error]);
  // 仅卸载时隐藏原生视图；尺寸变化的 effect 清理不能导致网页反复闪白。
  useLayoutEffect(() => () => {
    void window.huanApp.browser.layout({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => undefined);
  }, []);
  function navigate(action: ReaderAction) {
    if (!id) return;
    setError('');
    void window.huanApp.browser.action(id, action).then(accept, () => {
      if (activeId.current === id) setError('页面操作失败，请重试。');
    });
  }
  async function contextAction(action: 'captureContext' | 'clearContext') {
    const pageId = current?.pageId;
    if (!id || !pageId || (action === 'captureContext' ? captureDisabled : clearDisabled)) return;
    if (contextOperation.current && (action === 'captureContext' || contextOperation.current.action === 'clearContext')) return;
    const operation = { id, action };
    contextOperation.current = operation;
    setContextBusy(action); setError('');
    try {
      const value = await window.huanApp.browser[action](id, pageId);
      if (contextOperation.current === operation && activeId.current === id) accept(value);
    } catch {
      if (contextOperation.current === operation && activeId.current === id)
        setError(action === 'captureContext' ? '页面上下文提取失败，请重试。' : '未能清空本页上下文，请重试。');
    } finally {
      if (contextOperation.current === operation) { contextOperation.current = undefined; setContextBusy(undefined); }
    }
  }
  return <section className="reader" aria-label="原页阅读">
      <div className="reader-toolbar">
        <Button id="reading-collection-toggle" className="reader-panel-toggle" aria-expanded={!leftCollapsed}
          aria-controls="bookmark-sidebar" onClick={onToggleLeft}>
          <Icon name={leftCollapsed ? 'expand' : 'collapse'} /><span>收藏</span>
        </Button>
        <div className="reader-browser-actions">
          <IconButton icon="back" label="后退" disabled={!current?.canGoBack || suspended} onClick={() => navigate('back')} />
          <IconButton icon="forward" label="前进" disabled={!current?.canGoForward || suspended} onClick={() => navigate('forward')} />
          <Button disabled={!selected || suspended} onClick={() => navigate(current?.phase === 'loading' ? 'stop' : 'reload')}>
            {current?.phase === 'loading' ? '停止' : '刷新'}</Button>
        </div>
        <Input className="reader-address" aria-label="当前网页地址（只读）" aria-busy={current?.phase === 'loading'} readOnly value={current?.url || selected?.url || ''}
          title={selected ? `${selected.title}\n${current?.url || selected.url}` : undefined} placeholder="选择一条收藏，开始阅读" />
        <Button className="reader-capture" disabled={captureDisabled} aria-label="页面上下文提取"
          onClick={() => void contextAction('captureContext')}>
          {current?.capturing || contextBusy === 'captureContext' ? '提取中…' : '提取上下文'}</Button>
        {selected && !subtitlePage ? <span className="reader-context-summary" title="保留的不同正文快照数量，重复采集不增加数量">
          已采集 {current?.captureCount ?? 0} 次{capturedAt ? <time className="reader-capture-time" dateTime={capturedAt.toISOString()}
            title={capturedAt.toLocaleString('zh-CN')}> · {capturedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time> : null}
        </span> : null}
        <Button className="reader-more" aria-label="本页上下文操作" aria-expanded={contextActionsOpen}
          aria-controls="reader-context-actions" disabled={!selected || suspended} onClick={() => setContextActionsOpen(value => !value)}>更多</Button>
        <Button id="reading-assistant-toggle" className="reader-panel-toggle reader-assistant-toggle" aria-expanded={!rightCollapsed}
          aria-controls="ai-chat" onClick={onToggleRight}><span>AI 伴读</span><Icon name={rightCollapsed ? 'expand' : 'collapse'} /></Button>
      </div>
      <div className="reader-context" hidden={!contextActionsOpen && !contextMessage && !error && !current?.notice && !current?.message}>
        <div id="reader-context-actions" className="reader-context-actions" hidden={!contextActionsOpen}>
          <span>页面材料与聊天历史分别管理</span>
          <Button variant="text" className="reader-clear" disabled={clearDisabled}
            title="只清空本页采集的上下文，不删除聊天历史"
            onClick={() => void contextAction('clearContext')}>清空本页上下文</Button>
        </div>
        <p className="reader-context-message" role="status" aria-live="polite" aria-atomic="true">{contextMessage}</p>
        {error ? <p className="reader-context-error" role="alert">{error}</p> : null}
        {current?.message ? <p className="reader-context-error" role="alert">{current.message}</p> : null}
        {current?.notice ? <p className="reader-context-message" role="status">{current.notice}</p> : null}
      </div>
    <div ref={workspaceRef} className={`workspace${dragging ? ' workspace-resizing' : ''}`} style={workspaceStyle}>
      {leadingPanel}
      <div className="reader-viewport-shell">
        <div ref={host} className="reader-viewport">
          {!selected ? children : current?.phase === 'error' ? <div className="reader-fallback"><h2>暂时无法展示页面</h2><p>{current.message}</p><Button onClick={() => navigate('reload')}>重新加载</Button></div> : null}
        </div>
      </div>
      {trailingPanel}
    </div>
  </section>;
}
