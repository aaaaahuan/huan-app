import { Phonetic } from './Phonetic';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import './selection-translation.css';

type Selection = { text: string; context: string; x: number; y: number; auto: boolean };
const english = (text: string) => /[a-zA-Z]/.test(text) && !/[\u3400-\u9fff]/.test(text) && !/https?:|@|[{}<>]/.test(text);
export function SelectionTranslation({ scope, enabled }: { scope: string; enabled: boolean }) {
  const [selected, setSelected] = useState<Selection>();
  const [result, setResult] = useState('');
  const [phonetic, setPhonetic] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() { const id = run.current; run.current = undefined; if (id) void window.huanApp.translation.stop(id).catch(() => undefined); setBusy(false); }
  function close() { cancel(); setSelected(undefined); }
  async function translate(selection: Selection) {
    cancel(); const id = crypto.randomUUID(); run.current = id; setBusy(true); setError(''); setResult(''); setPhonetic('');
    try {
      const response = await window.huanApp.translation.lookup({ requestId: id, direction: 'en-zh', text: selection.text,
        source: { module: scope, context: selection.context, trigger: selection.auto ? 'double-click' : 'manual' } });
      if (run.current !== id) return;
      if (response.status === 'complete') { setResult(response.text); setPhonetic(response.phonetic ?? ''); if (response.warning) setError(response.warning); }
      else setError(response.error ?? '翻译已停止，可重试。');
    } catch (failure) { if (run.current === id) setError(String(failure)); }
    finally { if (run.current === id) { run.current = undefined; setBusy(false); } }
  }
  useEffect(() => {
    close();
    function capture(event: MouseEvent) {
      if (!(event.target instanceof Element) || event.target.closest('[data-selection-bubble],input,textarea:not([readonly]),[contenteditable="true"],button,select,dialog')) return;
      clearTimeout(timer.current);
      const auto = event.type === 'dblclick';
      timer.current = setTimeout(() => {
        const selection = window.getSelection();
        const target = event.target;
        const textarea = target instanceof HTMLTextAreaElement ? target : undefined;
        const text = (textarea ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : selection?.toString())?.trim();
        if (!text || (!textarea && !selection?.rangeCount)) { close(); return; }
        if (text.length > 2000 || (auto && !english(text))) { close(); return; }
        const rect = textarea ? textarea.getBoundingClientRect() : selection!.getRangeAt(0).getBoundingClientRect();
        const value = { text, context: textarea?.value.slice(0, 2000) ?? selection?.anchorNode?.parentElement?.textContent?.slice(0, 2000) ?? text,
          x: Math.max(8, Math.min(rect.left, innerWidth - 336)), y: Math.max(64, Math.min(rect.bottom + 8, innerHeight - 260)), auto };
        cancel(); setResult(''); setPhonetic(''); setError(''); setSelected(value); if (auto && enabled) void translate(value);
      }, auto ? 0 : 220);
    }
    function outside(event: PointerEvent) { if (event.target instanceof Element && !event.target.closest('[data-selection-bubble]')) close(); }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') close(); }
    document.addEventListener('mouseup', capture); document.addEventListener('dblclick', capture);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { clearTimeout(timer.current); cancel(); document.removeEventListener('mouseup', capture); document.removeEventListener('dblclick', capture); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
    // 选区和请求由监听器统一管理；切页或切换模型时销毁旧请求。
  }, [scope, enabled]);
  if (!selected) return null;
  return <aside data-selection-bubble className={`selection-translation ${busy || result || error ? 'expanded' : ''}`} style={{ left: selected.x, top: selected.y }} aria-label="选中翻译" onMouseDown={event => event.preventDefault()}>
    <div className="selection-actions"><Button disabled={!enabled || busy} onClick={() => void translate(selected)}>翻译</Button>{busy ? <Button onClick={cancel}>停止</Button> : null}{result ? <Button onClick={() => { void window.huanApp.translation.copy(result).catch(failure => setError(String(failure))); }}>复制</Button> : null}{busy || result || error ? <Button onClick={close} aria-label="关闭翻译">×</Button> : null}</div>
    {!enabled ? <p>请先选择可用模型。</p> : null}{busy ? <p role="status">翻译中…</p> : null}{error ? <p role="alert">{error}</p> : null}<Phonetic value={phonetic} />{result ? <div className="selection-result" role="status">{result}</div> : null}
  </aside>;
}
