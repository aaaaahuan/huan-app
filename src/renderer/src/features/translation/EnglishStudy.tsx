import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import type { StudyGrade, StudyLesson, StudyRequest, StudyResult } from '@shared/contracts/english-study';
import { Button } from '@renderer/components/Button';
import { StudyModal } from './StudyModal';
import { ExecutionMetrics } from '@renderer/components/ExecutionMetrics';
import type { ExecutionMetrics as Metrics } from '@shared/contracts/ai-execution';
import { SelectionBubble, type StudySelection } from './SelectionBubble';
import { useEnglishSpeech, SpeechButton } from './EnglishSpeech';
import { lessons } from './lessons';

export function EnglishStudy({ onClose, enabled, modelKey }: { onClose(): void; enabled: boolean; modelKey: string }) {
  const [index, setIndex] = useState(0);
  const [custom, setCustom] = useState(false);
  const [source, setSource] = useState(lessons[0].source);
  const [answer, setAnswer] = useState('');
  const [lesson, setLesson] = useState<StudyLesson | undefined>(lessons[0]);
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<StudyGrade>();
  const [selection, setSelection] = useState<StudySelection>();
  const [busy, setBusy] = useState('');
  const speech = useEnglishSpeech();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metrics, setMetrics] = useState<Metrics>();
  const root = useRef<HTMLDivElement>(null);
  const run = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const mounted = useRef(true);
  const cache = useRef(new Map<string, StudyResult>());
  const translations = useRef(new Map<string, string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = run.current;
      if (current) { current.cancelled = true; void window.huanApp.translation.stop(current.id).catch(() => undefined); }
    };
  }, []);

  async function stop() {
    const current = run.current;
    if (!current) return;
    current.cancelled = true;
    setNotice('正在停止…');
    try { await window.huanApp.translation.stop(current.id); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
  }
  async function study(task: Exclude<StudyRequest['task'], 'vocabulary'>) {
    if (run.current || !enabled) return;
    const request: StudyRequest = { requestId: crypto.randomUUID(), task, source,
      ...(task === 'grade' ? { answer } : {}) };
    const key = JSON.stringify([modelKey, task, request.source, request.answer]);
    const current = { id: request.requestId, cancelled: false };
    run.current = current;
    setBusy(task); setError(''); setNotice(''); setMetrics(undefined);
    try {
      const cached = cache.current.get(key);
      const result = cached ?? await window.huanApp.translation.study(request);
      if (!mounted.current || current.cancelled) return;
      setMetrics(cached ? undefined : result.metrics);
      if (cached) setNotice('已复用本次练习的结果，无需等待模型。');
      if (result.status !== 'complete') { setError(result.error ?? '请求已停止。'); return; }
      if (cache.current.size >= 100) cache.current.delete(cache.current.keys().next().value ?? '');
      cache.current.set(key, result);
      if (result.lesson) { setLesson(result.lesson); setRevealed(true); }
      if (result.grade) setGrade(result.grade);
    } catch (failure) { if (mounted.current && !current.cancelled) setError(String(failure)); }
    finally { if (mounted.current && run.current === current) { run.current = undefined; setBusy(''); if (current.cancelled) setNotice('已停止。'); } }
  }
  function showAnswer() {
    if (lesson) {
      if (revealed && speech.owner === 'reference') void speech.stop();
      setRevealed(value => !value);
    }
    else void study('lesson');
  }
  function changeLesson(next: number, useCustom: boolean) {
    if (run.current) return;
    void speech.stop();
    setCustom(useCustom); setIndex(next); setAnswer(''); setGrade(undefined); setRevealed(false);
    setError(''); setNotice(''); setSelection(undefined); setMetrics(undefined);
    setSource(useCustom ? '' : lessons[next].source); setLesson(useCustom ? undefined : lessons[next]);
  }
  function clearSelection() {
    setSelection(undefined);
    if (speech.owner === 'selection') void speech.stop();
  }
  function capture(target: EventTarget | null) {
    if (!(target instanceof HTMLElement) || target.closest('[data-selection-bubble]')) return;
    let text = ''; let rect: DOMRect | undefined;
    if (target instanceof HTMLTextAreaElement) {
      text = target.value.slice(target.selectionStart, target.selectionEnd).trim();
      rect = target.getBoundingClientRect();
    } else {
      const current = window.getSelection();
      if (current?.rangeCount && root.current?.contains(current.anchorNode) && root.current?.contains(current.focusNode)) {
        text = current.toString().trim(); rect = current.getRangeAt(0).getBoundingClientRect();
      }
    }
    if (!text || text.length > 2000 || !rect) { clearSelection(); return; }
    if (speech.owner === 'selection' && selection?.text !== text) void speech.stop();
    setSelection({ text, x: Math.max(20, Math.min(rect.left, window.innerWidth - 340)), y: Math.max(70, Math.min(rect.bottom + 8, window.innerHeight - 260)) });
    setError(''); setNotice('');
  }
  return <StudyModal title="英语学习 · 长句翻译" onClose={onClose}>
    <div ref={root} onMouseUp={(event: MouseEvent<HTMLDivElement>) => capture(event.target)}
      onKeyUp={(event: KeyboardEvent<HTMLDivElement>) => { if (event.key.startsWith('Arrow') || (event.metaKey && event.key === 'a')) capture(event.target); }}>
      <div className="study-toolbar"><div className="study-tabs"><Button variant={!custom ? 'primary' : 'default'} disabled={!!busy} onClick={() => changeLesson(index, false)}>精选练习</Button><Button variant={custom ? 'primary' : 'default'} disabled={!!busy} onClick={() => changeLesson(index, true)}>自选中文</Button></div>
        {!custom ? <Button disabled={!!busy} onClick={() => changeLesson((index + 1) % lessons.length, false)}>下一题 {index + 1}/{lessons.length}</Button> : null}</div>
      <label className="study-label" htmlFor="study-source">中文原文</label>
      {custom ? <textarea id="study-source" onSelect={event => capture(event.target)} className="study-input study-source" maxLength={12000} disabled={!!busy} value={source} placeholder="输入一段中文…" onChange={event => { if (speech.owner) void speech.stop(); setSource(event.target.value); setLesson(undefined); setRevealed(false); setGrade(undefined); setSelection(undefined); setError(''); setNotice(''); }} />
        : <p id="study-source" className="study-source">{source}</p>}
      <div className="study-reading-heading"><label className="study-label" htmlFor="study-answer">你的英文翻译</label><SpeechButton speech={speech} owner="answer" text={answer} label="你的译文" /></div>
      <textarea id="study-answer" onSelect={event => capture(event.target)} className="study-input" autoFocus maxLength={12000} value={answer} disabled={!!busy} placeholder="在这里写下你的英文翻译…" onChange={event => { if (['answer', 'corrected', 'selection'].includes(speech.owner)) void speech.stop(); setAnswer(event.target.value); setGrade(undefined); setSelection(undefined); setError(''); setNotice(''); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (source.trim() && answer.trim()) void study('grade'); } }} />
      <div className="study-toolbar"><span className="study-hint">Enter 提交 · Shift Enter 换行 · 选中英语可翻译、收词</span><div className="study-tabs">
        <Button disabled={!!busy || !source.trim() || (!lesson && !enabled)} onClick={showAnswer}>{revealed ? '收起参考答案' : '查看推荐答案与解析'}</Button>
        {busy ? <Button onClick={() => void stop()}>停止</Button> : <Button variant="primary" disabled={!enabled || !source.trim() || !answer.trim()} onClick={() => void study('grade')}>提交并评分</Button>}
      </div></div>
      {busy ? <p role="status" className="study-hint">{busy === 'grade' ? '正在检查语义、语法和表达…' : '正在生成参考答案与解析…'}</p> : null}
      {!enabled ? <p role="status" className="study-hint">模型正在切换或配置读取中，参考题目仍可查看。</p> : null}
      {error ? <p className="translation-error" role="alert">{error}</p> : null}
      {notice ? <p className="translation-notice" role="status">{notice}</p> : null}
      {grade ? <section className="study-feedback" aria-label="评分结果"><div className="study-score">{grade.score}<small> / 100 · 模型参考评分</small></div>
        <p className="study-hint">语义 {grade.meaning}/60 · 语法 {grade.grammar}/25 · 表达 {grade.expression}/15</p><p>{grade.feedback}</p><div className="study-reading-heading"><h3>推荐表达</h3><SpeechButton speech={speech} owner="corrected" text={grade.corrected} label="推荐表达" /></div><p lang="en">{grade.corrected}</p></section> : null}
      {revealed && lesson ? <section className="study-feedback" aria-label="参考答案与解析"><div className="study-reading-heading"><h3>推荐答案</h3><SpeechButton speech={speech} owner="reference" text={lesson.reference} label="推荐答案" /></div><p lang="en">{lesson.reference}</p><h3>长句解析</h3><p>{lesson.explanation}</p></section> : null}
      {metrics ? <ExecutionMetrics metrics={metrics} /> : null}
    </div>
    {selection ? <SelectionBubble key={`${modelKey}:${selection.text}`} selected={selection} enabled={enabled} modelKey={modelKey}
      context={`${source}\n${answer}\n${lesson?.reference ?? ''}`.slice(0, 12000)} translations={translations.current} speech={speech}
      onClose={clearSelection} /> : null}
  </StudyModal>;
}
