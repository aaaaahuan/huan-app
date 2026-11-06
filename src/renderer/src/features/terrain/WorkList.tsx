import { WorkDialog } from './WorkDialog';
import { useEffect, useRef, useState } from 'react';
import type { TerrainJobList, TerrainJobSummary } from '@shared/contracts/terrain';
import { Button, IconButton } from '@renderer/components/Button';
import { IconInput } from '@renderer/components/Input';
import { filteredRows } from './search';

const statusNames = { queued: '等待生成', running: '正在生成', completed: '已完成', failed: '生成失败' };
export function workFacts(job: TerrainJobSummary): string {
  return job.status === 'completed'
    ? `${job.photo_count} 张照片 · ${job.house_count} 个房屋${job.uncertain_houses ? ` · ${job.uncertain_houses} 待确认` : ''}`
    : `${statusNames[job.status]} · ${job.stages.filter(stage => stage.status === 'done').length}/${job.stages.length}`;
}

export function WorkList({ library, loading, error, selectedId, onSelect, onRefresh, onDeleted }: {
  library?: TerrainJobList; loading: boolean; error: string; selectedId: string | null;
  onSelect(id: string): void; onRefresh(): void; onDeleted(id: string): void;
}) {
  const [dialog, setDialog] = useState<{ job: TerrainJobSummary; mode: 'summary' | 'delete' | 'print' }>();
  const [menu, setMenu] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (!dialog) menuTrigger.current?.focus(); }, [dialog]);
  const rows = filteredRows(library?.jobs ?? [], query);
  function clear() { setDraft(''); setQuery(''); composing.current = false; }
  return <aside className={`terrain-sidebar${collapsed ? ' terrain-sidebar--collapsed' : ''}`} aria-label="作品列表">
    <header className="terrain-list-header">
      {!collapsed ? <h2>作品 <small aria-live="polite">{rows.length}/{library?.jobs.length ?? 0}</small></h2> : null}
      <IconButton icon={collapsed ? 'expand' : 'collapse'} label={collapsed ? '展开作品列表' : '收起作品列表'}
        aria-expanded={!collapsed} aria-controls="terrain-list-content" onClick={() => { clear(); setCollapsed(!collapsed); }} />
    </header>
    <div id="terrain-list-content" className="terrain-list-content" hidden={collapsed}>
      <div className="terrain-search">
        <IconInput ref={input} icon="search" aria-label="搜索作品名称或文件名" placeholder="搜索作品" value={draft}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={event => { composing.current = false; setQuery(event.currentTarget.value); }}
          onChange={event => { setDraft(event.target.value); if (!composing.current) setQuery(event.target.value); }}
          onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); clear(); } }} />
        {draft ? <IconButton icon="close" label="清除搜索" onClick={() => { clear(); input.current?.focus(); }} /> : null}
        <IconButton icon="refresh" label="刷新作品列表" onClick={onRefresh} disabled={loading} />
      </div>
      <div className="terrain-list-scroll" aria-busy={loading}>
        {loading ? <p role="status">正在读取作品库…</p> : null}
        {error ? <div role="alert"><p>{error}</p><Button onClick={onRefresh}>重试读取</Button></div> : null}
        {!loading && !error && !rows.length ? <p role="status">{library?.jobs.length ? `没有名称匹配「${query.trim()}」的作品` : '第一段旅程，从上传轨迹开始。'}</p> : null}
        <ul className="terrain-work-items">{rows.map(job => <li key={job.id}>
          <Button className="terrain-work-card" aria-current={selectedId === job.id ? 'true' : undefined} onClick={() => onSelect(job.id)}>
            <strong>{job.name || job.filename}</strong><span>{job.date || job.id}</span><small>{workFacts(job)}</small>
          </Button>
          <div className="terrain-work-menu"><Button aria-label={`${job.name} 的作品菜单`} aria-expanded={menu === job.id} onClick={event => { menuTrigger.current = event.currentTarget; setMenu(menu === job.id ? undefined : job.id); }}>⋯</Button>
            {menu === job.id ? <div className="terrain-work-menu-items" onKeyDown={event => { if (event.key === 'Escape') setMenu(undefined); }}>
              <Button onClick={() => { setDialog({ job, mode: 'summary' }); setMenu(undefined); }}>查看生成摘要</Button>
              <Button disabled={['queued', 'running'].includes(job.status)} onClick={() => { setDialog({ job, mode: 'delete' }); setMenu(undefined); }}>删除</Button>
              <Button onClick={() => { setDialog({ job, mode: 'print' }); setMenu(undefined); }}>打印参数</Button>
            </div> : null}
          </div>
        </li>)}</ul>
        {library?.diagnostics.length ? <details className="terrain-diagnostics"><summary>读取诊断（{library.diagnostics.length}）</summary>
          <ul>{library.diagnostics.map(item => <li key={item.id}><strong>{item.id}</strong><p>{item.message}</p></li>)}</ul>
        </details> : null}
      </div>
    </div>
    {dialog ? <WorkDialog key={`${dialog.job.id}-${dialog.mode}`} {...dialog} onClose={() => setDialog(undefined)} onDeleted={() => { onDeleted(dialog.job.id); setDialog(undefined); }} /> : null}
  </aside>;
}
