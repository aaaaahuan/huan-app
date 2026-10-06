import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { TRANSLATION_MODEL, type TranslationDirection, type TranslationResult, type TranslationStatus } from '@shared/contracts/translation';
import { Button, IconButton } from '@renderer/components/Button';
import { Select } from '@renderer/components/Select';
import { Icon } from '@renderer/components/Icon';
import { LoadingIndicator } from '@renderer/components/LoadingIndicator';
import './translation.css';

const directions = [{ value: 'en-zh', label: '英语' }, { value: 'zh-en', label: '中文' }] as const;
const modelLabels = { unloaded: '未加载', loading: '加载中', ready: '就绪', failed: '服务失败' };

export function Translation({ active }: { active: boolean }) {
  const [direction, setDirection] = useState<TranslationDirection>('en-zh');
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<TranslationResult>();
  const [model, setModel] = useState<TranslationStatus>({ revision: -1, phase: 'unloaded' });
  const [phase, setPhase] = useState<'idle' | 'generating' | 'stopping'>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const request = useRef<{ id: string; cancelled: boolean; draftRevision: number } | undefined>(undefined);
  const draftRevision = useRef(0);
  const modelRevision = useRef(-1);
  const busy = phase !== 'idle';

  useEffect(() => {
    let disposed = false;
    const accept = (value: TranslationStatus) => {
      if (disposed || value.revision <= modelRevision.current) return;
      modelRevision.current = value.revision; setModel(value);
    };
    const off = window.huanApp.translation.onStatus(accept);
    void window.huanApp.translation.getStatus().then(accept, failure => {
      if (!disposed) setError(String(failure));
    });
    return () => {
      disposed = true; off();
      const run = request.current;
      if (run) { run.cancelled = true; void window.huanApp.translation.stop(run.id).catch(() => undefined); }
    };
  }, []);

  function stop(leaving = false) {
    const run = request.current;
    if (!run) return;
    run.cancelled = true;
    setPhase('stopping');
    setNotice(leaving ? '' : '已请求停止，正在等待本地请求结束…');
    void window.huanApp.translation.stop(run.id).catch(failure => {
      if (request.current === run) { setError(String(failure)); setPhase('generating'); }
    });
  }
  const onLeave = useEffectEvent(() => stop(true));
  useEffect(() => {
    if (!active) onLeave();
    else textarea.current?.focus();
  }, [active]);

  async function submit() {
    if (!active || request.current || !draft.trim()) return;
    const run = { id: crypto.randomUUID(), cancelled: false, draftRevision: draftRevision.current };
    request.current = run; setPhase('generating'); setError(''); setNotice(''); setResult(undefined);
    try {
      const answer = await window.huanApp.translation.translate({ requestId: run.id, text: draft, direction });
      // 切页或停止后不接纳迟到译文；不将上一请求内容填入新草稿。
      if (request.current !== run || run.cancelled) return;
      // 生成期间仍可编辑原文，即使改回原内容，也不能展示旧版本的译文。
      if (draftRevision.current !== run.draftRevision) {
        if (answer.error) setError(answer.error);
        setNotice('原文已修改，请重新翻译。');
        return;
      }
      setResult(answer);
      if (answer.error) setError(answer.error);
      if (answer.status === 'stopped') setNotice('已停止。');
    } catch (failure) {
      if (request.current === run && !run.cancelled) setError(String(failure));
    } finally {
      if (request.current === run) { request.current = undefined; setPhase('idle'); if (run.cancelled) setNotice('已停止。'); }
    }
  }

  function changeDirection(value: TranslationDirection) {
    if (busy) return;
    draftRevision.current++;
    setDirection(value); setResult(undefined); setError(''); setNotice('');
  }
  function swap() {
    if (busy) return;
    if (result?.status === 'complete') setDraft(result.text);
    changeDirection(direction === 'en-zh' ? 'zh-en' : 'en-zh');
  }
  function clear() { draftRevision.current++; setDraft(''); setResult(undefined); setError(''); setNotice(''); textarea.current?.focus(); }
  async function copy() {
    if (!result?.text) return;
    try { await window.huanApp.translation.copy(result.text); setNotice('已复制译文。'); }
    catch (failure) { setError(String(failure)); }
  }

  return <section className="translation-page" hidden={!active} aria-labelledby="translation-title">
    <div className="translation-content">
      <header className="translation-heading">
        <h1 id="translation-title">翻译</h1>
        <span className={`translation-model translation-model--${model.phase}`} role="status">
          <span className="translation-model-dot" />离线 · {TRANSLATION_MODEL} · {modelLabels[model.phase]}
        </span>
      </header>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="translation-languages">
          <Select<TranslationDirection> aria-label="原文语言" value={direction} options={directions} disabled={busy} onValueChange={changeDirection} />
          <IconButton icon="swap" label="交换语言" disabled={busy} onClick={swap} />
          <Select<TranslationDirection> aria-label="译文语言" value={direction}
            options={[{ value: 'en-zh', label: '中文' }, { value: 'zh-en', label: '英语' }]} disabled={busy} onValueChange={changeDirection} />
        </div>
        <div className="translation-panels">
          <div className="translation-panel">
            <div className="translation-panel-heading"><label htmlFor="translation-source">原文</label>
              <IconButton icon="close" label="清空原文" disabled={busy || !draft} onClick={clear} /></div>
            <textarea ref={textarea} id="translation-source" placeholder="输入或粘贴需要翻译的文字…" value={draft}
              onChange={event => { draftRevision.current++; setDraft(event.target.value); setResult(undefined); setError(''); setNotice(''); }}
              onKeyDown={event => {
                if (event.metaKey && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
              }} />
          </div>
          <div className="translation-panel translation-panel--output" aria-busy={busy}>
            <div className="translation-panel-heading"><label htmlFor="translation-output">译文</label>
              <Button className="translation-copy" disabled={busy || !result?.text} onClick={() => void copy()}>
                <Icon name="copy" />复制</Button></div>
            <textarea id="translation-output" placeholder="译文将显示在这里" value={result?.text ?? ''} readOnly />
          </div>
        </div>
        <div className="translation-actions">
          <div>{busy ? <Button variant="primary" disabled={phase === 'stopping'} onClick={() => stop()}>{phase === 'stopping' ? '正在停止…' : '停止'}</Button>
            : <Button variant="primary" type="submit" disabled={!draft.trim()}>翻译</Button>}
            <span className="translation-shortcut">⌘ Enter</span></div>
        </div>
        {busy ? <LoadingIndicator label={phase === 'stopping' ? '正在停止请求…' : model.phase === 'loading' ? '正在加载本地模型…' : '正在翻译…'} /> : null}
        {error ? <pre className="translation-error" role="alert">{error}</pre> : null}
        {model.error && !error.endsWith(model.error) ? <pre className="translation-error" role="alert">{model.error}</pre> : null}
        {notice ? <p className="translation-notice" role="status">{notice}</p> : null}
      </form>
    </div>
  </section>;
}
