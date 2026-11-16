import { useEffect, useRef, useState } from 'react';
import type { IdeaSnapshot } from '@shared/contracts/ideas';
import { Button } from '@renderer/components/Button';
import { TextArea } from '@renderer/components/TextArea';
import { Brain } from './Brain';
import './ideas.css';

export function Ideas({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState<IdeaSnapshot>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const [pulseID, setPulseID] = useState<string>();
  const pending = useRef(false), version = useRef(0), currentText = useRef(text);
  const retry = useRef<{ text: string; requestID: string } | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  currentText.current = text;
  const edits = useRef(0);
  function change(value: string) {
    ++edits.current; setText(value);
    void window.huanApp.ideas.saveDraft({ text: value, requestID: retry.current?.text === value ? retry.current.requestID : undefined }).then(result => {
      if (!result.ok) { setFailed(true); setMessage(result.message || '草稿自动保存失败，请复制原文。'); }
    }).catch(() => { setFailed(true); setMessage('草稿自动保存失败，请复制原文。'); });
  }
  useEffect(() => {
    let disposed = false;
    const revision = edits.current;
    void window.huanApp.ideas.getDraft().then(result => {
      if (disposed || edits.current !== revision) return;
      if (result.ok) {
        setText(result.draft.text);
        retry.current = result.draft.requestID ? { text: result.draft.text, requestID: result.draft.requestID } : undefined;
      } else { setFailed(true); setMessage(result.message); }
    }).catch(() => { if (!disposed) { setFailed(true); setMessage('无法恢复本机草稿。'); } });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false, refreshing = false;
    async function refresh() {
      if (pending.current || refreshing) return;
      refreshing = true;
      const requestVersion = ++version.current;
      try {
        const result = await window.huanApp.ideas.get();
        if (disposed || requestVersion !== version.current) return;
        if (result.ok) { setSnapshot(result.snapshot); setFailed(false); setMessage(''); }
        else { setFailed(true); setMessage(result.message); }
      } catch { if (!disposed && requestVersion === version.current) { setFailed(true); setMessage('无法读取灵感，草稿已保留，请重试。'); } }
      finally { refreshing = false; }
    }
    void refresh(); window.addEventListener('focus', refresh);
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 10_000);
    return () => { disposed = true; ++version.current; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [active]);
  async function submit() {
    if (pending.current || !text.trim()) return;
    const submitted = text;
    pending.current = true; ++version.current; setBusy(true); setFailed(false); setMessage('正在记录…');
    if (retry.current?.text !== submitted) retry.current = { text: submitted, requestID: crypto.randomUUID() };
    try {
      const persisted = await window.huanApp.ideas.saveDraft(retry.current);
      if (!persisted.ok) { setFailed(true); setMessage(persisted.message || '保存草稿失败，请复制原文。'); return; }
      const result = await window.huanApp.ideas.append(retry.current);
      if (result.ok) {
        setSnapshot(result.snapshot); setPulseID(result.snapshot.savedID ?? undefined);
        // 保存期间仍允许继续输入，新写的草稿不能被迟到的结果清掉。
        if (currentText.current === submitted) change('');
        retry.current = undefined; setMessage('已记录'); setFailed(false); area.current?.focus();
      } else { setFailed(true); setMessage(result.message); }
    } catch { setFailed(true); setMessage('未能确认保存结果。原文已保留，再次记录会重试同一条提交。'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="idea-page" hidden={!active} aria-label="灵感大脑">
    <header className="idea-heading"><div><p> A SPACE FOR YOUR SPARKS </p><h1>灵感大脑</h1></div><span className="idea-count">{snapshot ? <><strong>{snapshot.entries.length}</strong> 个灵感</> : failed ? '灵感暂不可用' : '正在连接灵感文件…'}</span></header>
    <Brain entries={snapshot?.entries ?? []} pulseID={pulseID} active={active} />
    <form className="idea-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <TextArea ref={area} aria-label="输入灵感" placeholder="刚刚想到什么？把它留下来。" value={text} rows={2}
        onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="idea-composer-actions"><span>Enter 记录 · Shift + Enter 换行</span><Button variant="primary" type="submit" disabled={busy || !text.trim()}>{busy ? '正在记录…' : failed && retry.current ? '重试记录' : '记录灵感 ↑'}</Button></div>
    </form>
    <p className={`idea-feedback${failed ? ' is-error' : ''}`} role={failed ? 'alert' : 'status'}>{message || (snapshot?.entries.length === 0 ? '留下第一个念头，点亮你的大脑。' : '\u00a0')}</p>
  </section>;
}
