import { useEffect, useRef, useState } from 'react';
import { vocabularyWordSchema } from '@shared/contracts/english-study';
import { Button } from '@renderer/components/Button';
import { SpeechButton, type EnglishSpeech } from './EnglishSpeech';

export type StudySelection = { text: string; x: number; y: number };

export function SelectionBubble({ selected, enabled, modelKey, context, translations, speech, onClose }: {
  selected: StudySelection; enabled: boolean; modelKey: string; context: string;
  translations: Map<string, string>; speech: EnglishSpeech; onClose(): void;
}) {
  const [busy, setBusy] = useState<'translate' | 'vocabulary'>();
  const [translation, setTranslation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const mounted = useRef(true);
  // 气泡自行管理请求和反馈，评分不会锁住选词，选词也不会切换评分的加载状态。
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
    try { await window.huanApp.translation.stop(current.id); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
  }
  async function submit(task: 'translate' | 'vocabulary') {
    if (run.current || !enabled) return;
    const key = `${modelKey}:${selected.text}`;
    const cached = task === 'translate' ? translations.get(key) : undefined;
    if (cached) { setTranslation(cached); setError(''); setNotice(''); return; }
    const current = { id: crypto.randomUUID(), cancelled: false };
    run.current = current; setBusy(task); setError(''); setNotice('');
    try {
      if (task === 'translate') {
        const result = await window.huanApp.translation.lookup({ requestId: current.id, direction: 'en-zh', text: selected.text });
        if (!mounted.current || current.cancelled) return;
        if (result.status !== 'complete') { setError(result.error ?? '翻译未完成，请重试。'); return; }
        if (translations.size >= 100) translations.clear();
        translations.set(key, result.text); setTranslation(result.text);
      } else {
        const result = await window.huanApp.translation.study({ requestId: current.id, task: 'vocabulary', source: selected.text, context });
        if (!mounted.current || current.cancelled) return;
        if (result.status !== 'complete') { setError(result.error ?? '收词未完成，请重试。'); return; }
        setNotice(result.saved === 'exists' ? '生词本已有这个词条，未重复写入。' : '已加入 Obsidian 生词本。');
      }
    } catch (failure) { if (mounted.current && !current.cancelled) setError(String(failure)); }
    finally { if (run.current === current) { run.current = undefined; if (mounted.current) { setBusy(undefined); if (current.cancelled) setNotice('已停止。'); } } }
  }
  return <aside data-selection-bubble className="study-bubble" aria-label="选中内容工具" style={{ left: selected.x, top: selected.y }} onMouseDown={event => event.preventDefault()}>
    <div className="study-toolbar"><strong>{selected.text}</strong><Button aria-label="关闭选中工具" onClick={onClose}>×</Button></div>
    <div className="study-tabs"><Button disabled={!!busy || !enabled} onClick={() => void submit('translate')}>翻译</Button>
      <SpeechButton speech={speech} owner="selection" text={selected.text} label="选中内容" />
      <Button disabled={!!busy || !enabled || !vocabularyWordSchema.safeParse(selected.text).success} title="支持英语单词或最多 8 个词的短语" onClick={() => void submit('vocabulary')}>一键加入生词本</Button></div>
    {busy ? <div className="study-bubble-status"><span role="status">{busy === 'translate' ? '翻译中' : '正在整理并加入生词本…'}</span><Button onClick={() => void stop()}>停止</Button></div> : null}
    {error ? <p className="translation-error" role="alert">{error}</p> : null}
    {notice ? <p className="translation-notice" role="status">{notice}</p> : null}
    {translation ? <div className="study-bubble-result" aria-label="中文译文" role="status">{translation}</div> : null}
  </aside>;
}
