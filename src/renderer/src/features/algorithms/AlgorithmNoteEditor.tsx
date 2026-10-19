import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AlgorithmNote, AlgorithmProblem } from '@shared/contracts/algorithms';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { MarkdownPreview } from '@renderer/components/MarkdownPreview';
import { Tabs } from '@renderer/components/Tabs';
import { TextArea } from '@renderer/components/TextArea';

type NoteMode = 'algorithm-note-edit' | 'algorithm-note-preview';
const modes = [{ value: 'algorithm-note-edit', label: 'Markdown 编辑' }, { value: 'algorithm-note-preview', label: '预览' }] as const;

export function AlgorithmNoteEditor({ problem, active, blocked, onClose, onBusyChange, onDirtyChange, onSaved }: {
  problem: AlgorithmProblem; active: boolean; blocked: boolean; onClose(): void;
  onBusyChange(value: boolean): void; onDirtyChange(value: boolean): void; onSaved(): void;
}) {
  const [note, setNote] = useState<AlgorithmNote>();
  const [content, setContent] = useState('');
  const [conflict, setConflict] = useState<AlgorithmNote>();
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<NoteMode>('algorithm-note-edit');
  const mounted = useRef(true);
  const pending = useRef(false);
  const checking = useRef(false);
  const version = useRef(0);
  const noteRef = useRef<AlgorithmNote>(undefined);
  const contentRef = useRef('');
  const recheckNeeded = useRef(false);
  const deferredContent = useDeferredValue(content);
  const dirty = !!note && content !== note.content;

  function accept(value: AlgorithmNote) {
    noteRef.current = value; contentRef.current = value.content;
    setNote(value); setContent(value.content); setConflict(undefined); setMessage('');
  }
  function change(value: string) {
    contentRef.current = value; setContent(value); setFeedback('');
  }
  function begin(writing = false) {
    // 写操作使在途读取失效，后台核对不禁用按钮或吞掉第一次点击。
    version.current++; pending.current = true; setBusy(true); setSaving(writing);
  }
  function finish() {
    pending.current = false;
    if (!mounted.current) return;
    setBusy(false);
    setSaving(false);
    if (recheckNeeded.current) {
      recheckNeeded.current = false;
      // 写入期间的文件通知不能丢失；完成后再核对，不以通知内容替换草稿。
      void check();
    }
  }
  async function check() {
    if (!active || blocked) return;
    if (pending.current || checking.current) { recheckNeeded.current = true; return; }
    checking.current = true;
    const requestVersion = ++version.current;
    const initial = !noteRef.current;
    if (initial) setBusy(true);
    try {
      const result = await window.huanApp.algorithms.getNote(problem.id);
      if (!mounted.current || requestVersion !== version.current) return;
      if (!result.ok) { setMessage(result.message); return; }
      const base = noteRef.current;
      if (!base || contentRef.current === base.content || contentRef.current === result.note.content) accept(result.note);
      else if (result.note.revision !== base.revision) {
        setConflict(result.note); setMessage('外部心得已更新，未保存的草稿已保留。请对比后再保存。');
      } else {
        // 仅改名或移动不构成正文冲突，也不丢弃正在编辑的草稿。
        noteRef.current = result.note; setNote(result.note); setConflict(undefined); setMessage('');
      }
    } catch (error) {
      if (mounted.current && requestVersion === version.current) setMessage(`无法读取心得，草稿已保留：${String(error)}`);
    } finally {
      checking.current = false;
      if (mounted.current && !pending.current) {
        if (initial) setBusy(false);
        if (recheckNeeded.current) { recheckNeeded.current = false; void check(); }
      }
    }
  }
  const recheck = useEffectEvent(() => { void check(); });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; version.current++; };
  }, []);
  useEffect(() => { if (active && !blocked) recheck(); }, [active, blocked]);
  useEffect(() => {
    const stop = window.huanApp.algorithms.onNotesChanged(() => recheck());
    const focus = () => recheck();
    window.addEventListener('focus', focus);
    return () => { stop(); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, busy]);

  async function save(merged = false) {
    const base = merged ? conflict : noteRef.current;
    if (!base || pending.current || blocked || (conflict && !merged)) return;
    begin(true); setMessage(''); setFeedback('');
    const submitted = contentRef.current;
    try {
      const result = await window.huanApp.algorithms.saveNote({ id: problem.id, content: submitted, expectedRevision: base.revision });
      if (!mounted.current) return;
      if (result.ok) { accept(result.note); setFeedback('已保存到本地 Markdown；iCloud 同步状态由系统管理。'); onSaved(); }
      else {
        setMessage(result.message);
        if (result.kind === 'conflict') setConflict(result.note);
      }
    } catch (error) {
      if (mounted.current) setMessage(`未能确认保存结果，草稿已保留：${String(error)}`);
      recheckNeeded.current = true;
    } finally { finish(); }
  }
  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!active || blocked || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void save();
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => shortcut(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function close() {
    if (pending.current || blocked || (dirty && !window.confirm('心得尚未保存，放弃草稿并返回题目清单？'))) return;
    onClose();
  }
  function loadExternal() {
    if (!conflict || !window.confirm('载入外部版本会放弃当前未保存草稿。建议先另存草稿副本，确定继续？')) return;
    accept(conflict); setFeedback('已载入外部版本。');
  }
  async function copy() {
    if (pending.current || blocked) return;
    begin(true); setFeedback('');
    try {
      const result = await window.huanApp.algorithms.copyNote({ id: problem.id, content: contentRef.current });
      if (!mounted.current) return;
      if (result.ok) setFeedback(`草稿副本已保存：${result.path}。正式心得未修改。`);
      else setMessage(result.message);
    } catch (error) { if (mounted.current) setMessage(`未能确认副本保存结果，草稿已保留：${String(error)}`); }
    finally { finish(); }
  }
  async function openObsidian() {
    if (pending.current || blocked) return;
    begin();
    try {
      const result = await window.huanApp.algorithms.openNote(problem.id);
      if (!result.ok && mounted.current) setMessage(result.message);
    } catch (error) { if (mounted.current) setMessage(String(error)); }
    finally { finish(); }
  }
  async function openLink(url: string) {
    if (blocked) return;
    try {
      const result = await window.huanApp.algorithms.openNoteLink(url);
      if (!result.ok && mounted.current) setMessage(result.message);
    } catch (error) { if (mounted.current) setMessage(String(error)); }
  }

  const disabled = busy || blocked;
  return <section className="algorithm-note" aria-label={`${problem.title} 解题心得`} aria-busy={busy}>
    <div className="algorithm-note-toolbar">
      <Button disabled={disabled} onClick={close}><Icon name="back" />题目清单</Button>
      <div className="algorithm-note-actions">
        <Button disabled={disabled} onClick={() => void check()}><Icon name="refresh" />刷新心得</Button>
        <Button disabled={disabled || !note?.exists} onClick={() => void openObsidian()}><Icon name="external" />Obsidian</Button>
        <Button variant="primary" disabled={disabled || !note || !!conflict || (note.exists && !dirty)} onClick={() => void save()}>保存心得</Button>
      </div>
    </div>
    <header className="algorithm-note-heading"><p className="algorithm-note-caption">{problem.category} / 解题心得</p><h1>{problem.title}</h1>
      <p className="algorithm-note-path ui-truncated" title={note?.path}>{note?.path ?? '正在定位本地笔记…'}</p>
    </header>
    <div className="algorithm-note-status" role="status">
      {busy ? '正在处理本地心得…' : conflict ? '外部变更待处理' : dirty ? '有未保存的修改' : note?.exists ? '已保存到本地' : '模板草稿，首次保存后创建文件'}
      <span>Cmd+S 保存 · problem_key 用于关联题目，请保留</span>
    </div>
    {message ? <p className="algorithm-alert" role="alert">{message}</p> : null}
    {feedback ? <p className="algorithm-note-feedback" role="status">{feedback}</p> : null}
    {conflict ? <section className="algorithm-note-conflict" aria-label="心得冲突处理">
      <p>{conflict.exists ? '对照外部版本，在编辑区手动合并后保存，或先保留草稿副本。' : '正式笔记已删除或移出心得目录。不会自动重建；确认后可手动合并保存。'}</p>
      <div className="algorithm-note-actions">
        <Button disabled={disabled} onClick={() => void copy()}>另存草稿副本</Button>
        <Button disabled={disabled} onClick={loadExternal}>载入外部版本</Button>
        <Button disabled={disabled} onClick={() => void save(true)}>已手动合并，保存</Button>
      </div>
      <details><summary>查看外部版本</summary><pre>{conflict.exists ? conflict.content : '外部文件不存在'}</pre></details>
    </section> : null}
    {note ? <>
      <Tabs<NoteMode> label="心得视图" value={mode} options={modes} disabled={disabled} onChange={setMode} className="algorithm-note-tabs" />
      <div id="algorithm-note-edit-panel" role="tabpanel" aria-labelledby="algorithm-note-edit-tab" hidden={mode !== 'algorithm-note-edit'}>
        <TextArea id="algorithm-note-markdown" aria-label="解题心得 Markdown" className="algorithm-note-source" spellCheck={false}
          disabled={blocked || saving} value={content} onChange={event => change(event.currentTarget.value)} />
      </div>
      <div id="algorithm-note-preview-panel" role="tabpanel" aria-labelledby="algorithm-note-preview-tab" hidden={mode !== 'algorithm-note-preview'}>
        <MarkdownPreview content={deferredContent} onOpenLink={url => void openLink(url)} />
      </div>
      <p className="algorithm-note-hint">标准 Markdown 预览；双链、图片和其他 Obsidian 扩展语法保留原文，请在 Obsidian 中查看。</p>
    </> : null}
  </section>;
}
