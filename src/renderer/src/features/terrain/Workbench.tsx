import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { Viewer } from './viewer/Viewer';
import { UploadView } from './UploadView';
import { WorkList, workFacts } from './WorkList';
import { useTerrainLibrary } from './useTerrainLibrary';
import './workbench.css';

export function Workbench({ active }: { active: boolean }) {
  const state = useTerrainLibrary(active);
  const [creating, setCreating] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function retry() {
    if (!state.job || retrying) return;
    const version = generation.current;
    setRetrying(true); setError('');
    try {
      const result = await window.huanApp.terrain.retry({ id: state.job.id });
      if (version !== generation.current) return;
      if (!result.ok) setError(result.message); else state.refresh();
    } catch { if (version === generation.current) setError('重试失败，请重试。'); }
    finally { if (version === generation.current) setRetrying(false); }
  }
  async function cancel() {
    if (!state.job || retrying) return;
    const version = generation.current;
    setRetrying(true); setError('');
    try {
      const result = await window.huanApp.terrain.cancel({ id: state.job.id });
      if (version !== generation.current) return;
      if (!result.ok) setError(result.message); else state.refresh();
    } catch { if (version === generation.current) setError('取消失败，请重试。'); }
    finally { if (version === generation.current) setRetrying(false); }
  }
  return <>
    <WorkList {...state} onSelect={id => { generation.current++; setRetrying(false); setError(''); setCreating(false); state.select(id); }} onRefresh={state.refresh} onDeleted={id => { if (state.selectedId === id) state.select(null); state.refresh(); }} />
    <div className="terrain-preview">
      {creating ? <UploadView onCreated={id => { state.select(id); state.refresh(); setCreating(false); }} /> : <>
      <header className="terrain-toolbar">
        <div className="terrain-selection" role={state.selectionError ? 'alert' : 'status'}>
          {state.selectionError || (state.job ? <>
            <h2>{state.job.name}</h2>
            <p>{[state.job.date, workFacts(state.job), state.job.error].filter(Boolean).join(' · ')}</p>
          </> : state.selectedId ? '正在读取作品…' : '请选择作品')}
        </div>
        <Button onClick={() => { generation.current++; setCreating(true); setRetrying(false); setError(''); }}>
          <Icon name="plus" /> 新建作品
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {state.job && state.job.status !== 'completed' ? <div className="terrain-progress" role="status">
        <ol>{state.job.stages.map(stage => <li key={stage.key}>{stage.name} · {{ pending: '待执行', running: '进行中', done: '已完成', failed: '失败' }[stage.status]}<p>{stage.detail}</p></li>)}</ol>
        {['queued', 'running'].includes(state.job.status) ? <Button disabled={retrying} onClick={() => void cancel()}>{retrying ? '正在取消…' : '取消任务'}</Button> : null}
        <Button disabled={retrying || ['queued', 'running'].includes(state.job.status)} onClick={() => void retry()}>{retrying ? '正在重试…' : '重试任务'}</Button>
      </div> : state.job?.status === 'completed' ? <Viewer key={`${state.job.id}:${state.job.model_path ?? ''}:${state.job.model_revision ?? ''}`} id={state.job.id} active={active} onRetry={() => void retry()} retrying={retrying} /> : null}
      </>}
    </div>
  </>;
}
