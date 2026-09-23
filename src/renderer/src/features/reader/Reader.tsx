// React 负责工具栏和占位区域，远程网页由主进程的原生视图绘制。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Bookmark } from '@shared/contracts/bookmarks';
import { readerStateSchema, type ReaderAction, type ReaderState } from '@shared/contracts/browser';
import './reader.css';

export function Reader({ selected, suspended, layoutKey, children }: {
  selected?: Bookmark; suspended: boolean; layoutKey: string; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ReaderState>();
  const [error, setError] = useState('');
  const id = selected?.id ?? null;
  const current = state?.bookmarkId === id ? state : undefined;
  function accept(value: ReaderState) {
    const parsed = readerStateSchema.safeParse(value);
    // IPC 返回值与事件可能交错，只接受更新的状态版本。
    if (parsed.success) setState((previous) => !previous || parsed.data.revision >= previous.revision ? parsed.data : previous);
  }
  useEffect(() => {
    const unsubscribe = window.huanApp.browser.onState(accept);
    void window.huanApp.browser.get().then(accept, () => setError('无法连接网页容器。'));
    return unsubscribe;
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void window.huanApp.browser.select(id).then(accept, () => {
      if (!cancelled) setError('无法打开收藏，请重新选择。');
    });
    return () => { cancelled = true; };
  }, [id]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    function report() {
      const rect = element!.getBoundingClientRect();
      void window.huanApp.browser.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        visible: !!id && !suspended }).catch(() => setError('网页区域定位失败，请重启应用。'));
    }
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      void window.huanApp.browser.layout({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => undefined);
    };
  }, [id, suspended, layoutKey, current?.notice, current?.message, error]);
  function navigate(action: ReaderAction) {
    if (!id) return;
    setError('');
    void window.huanApp.browser.action(id, action).then(accept, () => setError('页面操作失败，请重试。'));
  }
  return <section className="reader" aria-label="原页阅读">
    {selected ? <>
      <div className="reader-heading" title={selected.title}>{selected.title}</div>
      <div className="reader-toolbar">
        <button title="后退" aria-label="后退" disabled={!current?.canGoBack} onClick={() => navigate('back')}>←</button>
        <button title="前进" aria-label="前进" disabled={!current?.canGoForward} onClick={() => navigate('forward')}>→</button>
        <button onClick={() => navigate(current?.phase === 'loading' ? 'stop' : 'reload')}>{current?.phase === 'loading' ? '停止' : '刷新'}</button>
        <input aria-label="当前网页地址（只读）" readOnly value={current?.url || selected.url} />
      </div>
      <div className="reader-status" role="status">{error || current?.message || (current?.phase === 'loading' ? '正在加载原始网页…' : '原始网页 · 页面跳转不改变左侧收藏选择')}
        {current?.notice ? <span>{current.notice}</span> : null}</div>
    </> : null}
    <div ref={host} className="reader-viewport">
      {!selected ? children : current?.phase === 'error' ? <div className="reader-fallback"><h2>暂时无法展示页面</h2><p>{current.message}</p><button onClick={() => navigate('reload')}>重新加载</button></div> : null}
    </div>
  </section>;
}
