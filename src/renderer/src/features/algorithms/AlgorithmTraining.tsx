import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AlgorithmLibrary, AlgorithmProblem } from '@shared/contracts/algorithms';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Icon } from '@renderer/components/Icon';
import { CategoryList } from './CategoryList';
import { ProblemList } from './ProblemList';
import './algorithms.css';

export function AlgorithmTraining({ active, blocked }: { active: boolean; blocked: boolean }) {
  const [library, setLibrary] = useState<AlgorithmLibrary>();
  const [category, setCategory] = useState('');
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const started = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const savedFocus = useRef<{ id: string; nextId?: string }>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function accept(value: AlgorithmLibrary) {
    setLibrary(value);
    setCategory(previous => value.items.some(item => item.category === previous) ? previous :
      (value.items.find(item => !item.completed) ?? value.items[0])?.category ?? '');
  }
  async function load(refresh: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFeedback('');
    try {
      const value = await (refresh ? window.huanApp.algorithms.refresh() : window.huanApp.algorithms.get());
      if (mounted.current) accept(value);
    } catch {
      if (mounted.current) {
        setLibrary(previous => previous ? { ...previous, state: 'error', message: '未能确认读取结果，请刷新笔记。' } : undefined);
        setFeedback('无法读取算法清单，请刷新笔记；若仍失败，请完全退出应用后重试。');
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const enter = useEffectEvent(() => {
    if (started.current) return;
    started.current = true;
    void load(false);
  });
  useEffect(() => { if (active) enter(); }, [active]);

  async function toggle(item: AlgorithmProblem) {
    if (pending.current || blocked || library?.state !== 'ready') return;
    if (document.activeElement?.id === `algorithm-completed-${item.id}`) {
      const index = visibleItems.findIndex(problem => problem.id === item.id);
      savedFocus.current = { id: item.id, nextId: (visibleItems[index + 1] ?? visibleItems[index - 1])?.id };
    }
    pending.current = true; setBusy(true); setFeedback('');
    try {
      const result = await window.huanApp.algorithms.setCompleted({
        id: item.id, completed: !item.completed, expectedCompleted: item.completed
      });
      // 不乐观勾选：只有主进程确认源笔记保存成功，才显示新完成状态。
      if (mounted.current) {
        accept(result.library);
        if (!result.ok && result.message !== result.library.message) setFeedback(result.message);
      }
    } catch {
      if (mounted.current) {
        setLibrary(previous => previous ? { ...previous, state: 'error', message: '未能确认保存结果，请刷新笔记核对，不要重复提交。' } : undefined);
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function open(item: AlgorithmProblem) {
    if (pending.current || blocked || library?.state !== 'ready') return;
    pending.current = true; setBusy(true); setFeedback('');
    try {
      const result = await window.huanApp.algorithms.open(item.id);
      if (!result.ok && mounted.current) setFeedback(result.message);
    } catch { if (mounted.current) setFeedback('无法打开题目链接，请重试。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  const items = library?.items ?? [];
  const selectedItems = items.filter(item => item.category === category);
  const visibleItems = unfinishedOnly ? selectedItems.filter(item => !item.completed) : selectedItems;
  const disabled = busy || blocked || library?.state !== 'ready';
  useEffect(() => {
    if (busy) return;
    const saved = savedFocus.current;
    savedFocus.current = undefined;
    // 临时 disabled 或过滤移除行会丢失焦点；不抢走用户已经移到其他控件的焦点。
    if (!saved || !active || blocked || document.activeElement !== document.body) return;
    const target = [saved.id, saved.nextId].filter(Boolean).map(id => document.getElementById(`algorithm-completed-${id}`))
      .find(element => element instanceof HTMLInputElement && !element.disabled);
    (target ?? document.getElementById('algorithm-unfinished-filter'))?.focus();
  }, [busy, active, blocked, library, unfinishedOnly, category]);
  return <section className="algorithm-system" hidden={!active} aria-label="算法训练" aria-busy={busy}>
    <CategoryList items={items} selected={category} disabled={blocked} onSelect={setCategory} />
    <main className="algorithm-content">
      <header className="algorithm-header">
        <div><h1>{category || '算法训练'}</h1><p title={library?.path}>来源：leetcode-raw.md</p></div>
        <Button disabled={busy || blocked} onClick={() => void load(true)}><Icon name="refresh" />{busy ? '处理中…' : '刷新笔记'}</Button>
      </header>
      <div className="algorithm-list-heading"><h2>题目清单</h2>
        <Checkbox id="algorithm-unfinished-filter" label="只看未完成" checked={unfinishedOnly} disabled={blocked} onChange={event => setUnfinishedOnly(event.currentTarget.checked)} />
      </div>
      {library?.state === 'error' ? <div className="algorithm-alert" role="alert">
        {library.message}{items.length ? ' 当前显示上次读取的清单，暂不可操作。' : ''}
      </div> : null}
      {feedback ? <p className="algorithm-alert" role="alert">{feedback}</p> : null}
      {busy && !library ? <p className="ui-loading" role="status">正在读取本地笔记…</p> : null}
      {visibleItems.length ? <ProblemList items={visibleItems} disabled={disabled}
        onToggle={item => void toggle(item)} onOpen={item => void open(item)} /> : null}
      {!busy && library?.state === 'ready' && !visibleItems.length ? <p className="algorithm-empty" role="status">
        {!items.length ? '笔记中还没有题目。' : unfinishedOnly && selectedItems.length ? '这个分类的题目已全部完成。' : '当前分类还没有题目。'}
      </p> : null}
      <span className="visually-hidden" role="status">{busy && library ? '正在处理笔记…' : ''}</span>
    </main>
  </section>;
}
