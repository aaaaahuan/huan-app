import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { subtitleTime, upperBound, type SubtitleDocument, type SubtitleState } from '@shared/contracts/subtitles';
import { Button } from '@renderer/components/Button';
import './subtitles.css';

function SubtitleReader({ document: result, state, visible }: {
  document: SubtitleDocument; state: SubtitleState; visible: boolean;
}) {
  const { transcript, job } = result;
  const [displayedCount, setDisplayedCount] = useState(0);
  const [following, setFollowing] = useState(true);
  const [notice, setNotice] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const { playback } = state;
  const target = playback?.phase === 'unavailable' ? transcript.segments.length : upperBound(transcript.segments, state.maxReachedSeconds ?? -1);
  const count = Math.max(displayedCount, target);
  if (count > displayedCount) setDisplayedCount(count);
  const active = playback?.phase === 'content' ? upperBound(transcript.segments, playback.seconds ?? -1) - 1 : -1;
  function hasSelection() {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && !!container.current &&
      (container.current.contains(selection.anchorNode) || container.current.contains(selection.focusNode));
  }
  useEffect(() => {
    const selected = () => { if (hasSelection()) setFollowing(false); };
    document.addEventListener('selectionchange', selected);
    return () => document.removeEventListener('selectionchange', selected);
  }, []);
  useLayoutEffect(() => {
    if (!visible || !following || active < 0 || hasSelection()) return;
    const box = container.current, row = rows.current[active];
    if (!box || !row) return;
    const top = box.getBoundingClientRect().top + box.clientTop;
    const rect = row.getBoundingClientRect();
    if (rect.top >= top && rect.bottom <= top + box.clientHeight) return;
    box.scrollTo({ top: Math.max(0, box.scrollTop + rect.top - top - box.clientHeight * 0.3), behavior: 'auto' });
  }, [active, count, following, visible]);
  function copy(event: ClipboardEvent) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    // 按选区与正文文本节点的交集复制，保留部分字符和跨段换行，排除时间戳及控件。
    const range = selection.getRangeAt(0);
    const pieces: string[] = [];
    for (const text of container.current?.querySelectorAll<HTMLElement>('.subtitle-text') ?? []) {
      const walker = window.document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      let node: Node | null, piece = '';
      while ((node = walker.nextNode())) {
        if (!range.intersectsNode(node)) continue;
        const value = node.textContent ?? '';
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : value.length;
        piece += value.slice(start, end);
      }
      if (piece) pieces.push(piece);
    }
    event.preventDefault(); event.clipboardData.setData('text/plain', pieces.join('\n'));
  }
  async function seek(seconds: number) {
    setNotice('');
    try {
      const response = await window.huanApp.subtitles.seek({ videoId: transcript.video_id, seconds });
      if (!response.ok) setNotice(response.message);
    } catch { setNotice('视频定位失败，可继续手动阅读。'); }
  }
  const synchronized = playback?.phase === 'content';
  return <>
    <div className="subtitle-info" role="status">
      <span>{transcript.language} · {transcript.source === 'caption' ? '已有字幕' : transcript.source === 'extension_upload' ? '已有字幕（浏览器提取）' : transcript.source}</span>
      <span>{synchronized ? `播放位置 ${subtitleTime(playback.seconds ?? 0)}` : playback?.phase === 'advertisement' ? '广告播放中，字幕暂不推进' : playback ? '暂时无法同步播放位置 · 全文手动阅读' : '正在识别播放位置…'}</span>
      <span>{following && synchronized ? '跟随播放' : '手动阅读'}</span>
      {!following && synchronized ? <Button variant="text" onClick={() => setFollowing(true)}>回到当前播放位置</Button> : null}
      {transcript.quality_warning ? <span>服务提示字幕质量可能存在问题，请核对原视频。</span> : null}
    </div>
    {notice ? <p className="subtitle-notice" role="status">{notice}</p> : null}
    <div ref={container} className="subtitle-scroll" tabIndex={0} aria-label={job.video_title ? `${job.video_title} 字幕正文` : '字幕正文'}
      onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)}
      onPointerDown={event => { if (event.target === event.currentTarget) setFollowing(false); }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setFollowing(false); }}
      onCopy={copy}>
      {!count ? <p className="subtitle-wait">等待播放到首段字幕…</p> : null}
      {transcript.segments.slice(0, count).map((segment, index) => <div key={index} ref={row => { rows.current[index] = row; }}
        className={`subtitle-row${active === index ? ' subtitle-row--active' : ''}`} aria-current={active === index ? 'true' : undefined}>
        {synchronized ? <Button variant="text" className="subtitle-timestamp" onClick={() => void seek(segment.seconds)}
          aria-label={`定位到 ${subtitleTime(segment.seconds)}`}>{subtitleTime(segment.seconds)}</Button>
          : <span className="subtitle-timestamp">{subtitleTime(segment.seconds)}</span>}
        <div className="subtitle-text">{segment.text}</div>
      </div>)}
    </div>
  </>;
}

export function Subtitles({ visible, hidden, settingsRevision, onConfigure }: {
  visible: boolean; hidden: boolean; settingsRevision: number; onConfigure(): void;
}) {
  const [state, setState] = useState<SubtitleState>({ revision: -1, videoId: null, phase: 'idle' });
  const [result, setResult] = useState<SubtitleDocument>();
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const latest = useRef(state);
  const sequence = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const accept = (next: SubtitleState) => {
      if (cancelled || next.revision <= latest.current.revision) return;
      if (next.videoId !== latest.current.videoId) {
        sequence.current++; setResult(undefined); setError(''); setCode('');
      }
      latest.current = next; setState(next);
    };
    const off = window.huanApp.subtitles.onState(accept);
    void window.huanApp.subtitles.get().then(accept).catch(() => { if (!cancelled) setError('无法连接字幕服务。'); });
    return () => { cancelled = true; sequence.current++; off(); };
  }, []);
  async function ensure(videoId: string, retry = false) {
    const call = ++sequence.current;
    setError(''); setCode('');
    try {
      const response = await window.huanApp.subtitles.ensure({ videoId, retry });
      if (call !== sequence.current || latest.current.videoId !== videoId) return;
      if (response.ok) { if (response.value.transcript.video_id === videoId) setResult(response.value); }
      else { setError(response.message); setCode(response.code); }
    } catch { if (call === sequence.current) setError('无法取得字幕，请手动重试。'); }
  }
  useEffect(() => {
    if (visible && state.videoId) void ensure(state.videoId);
  }, [visible, state.videoId, settingsRevision]);
  const document = result?.transcript.video_id === state.videoId ? result : undefined;
  const message = error || state.error?.message;
  const failureCode = code || state.error?.code;
  return <section id="reading-subtitles-panel" role="tabpanel" aria-labelledby="reading-subtitles-tab" className="subtitles-panel" hidden={hidden}>
    {document ? <SubtitleReader key={state.videoId} document={document} state={state} visible={visible} /> : <div className="subtitle-empty">
      {!state.videoId ? <p>请打开支持的 YouTube 视频</p> : state.phase === 'loading' ? <p role="status">正在获取字幕…</p> : <>
        <p role={message ? 'alert' : 'status'}>{message || '首次进入字幕视图后按需获取。'}</p>
        {failureCode ? <small>{failureCode}{state.error?.retryAfter ? ` · 请等待至少 ${state.error.retryAfter} 秒` : ''}</small> : null}
        <div className="subtitle-actions">
          <Button onClick={onConfigure}>字幕服务设置</Button>
          {state.videoId && failureCode !== 'KEY_MISSING' ? <Button onClick={() => void ensure(state.videoId!, true)}>重试</Button> : null}
        </div>
      </>}
    </div>}
  </section>;
}
