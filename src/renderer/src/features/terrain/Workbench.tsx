import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
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
    <WorkList {...state} onSelect={id => { generation.current++; setRetrying(false); setError(''); setCreating(false); state.select(id); }} onRefresh={state.refresh} />
    <div className="terrain-preview">
      <p className="settings-note">照片浏览和房屋判断编辑尚未迁移；现有房屋数据仍可预览。</p>
      <div className="terrain-toolbar"><Button onClick={() => { generation.current++; setCreating(true); setRetrying(false); setError(''); }}>＋ 新建作品</Button></div>
      {creating ? <UploadView onCreated={id => { state.select(id); state.refresh(); setCreating(false); }} /> : <>

      {state.selectedId ? <div className="terrain-selection" role={state.selectionError ? 'alert' : 'status'}>
        {state.selectionError || (state.job ? `${state.job.name} · ${workFacts(state.job)}${state.job.error ? ` · ${state.job.error}` : ''}` : '正在读取所选作品…')}
      </div> : null}
      {error ? <p role="alert">{error}</p> : null}
      {state.job && state.job.status !== 'completed' ? <div className="terrain-progress" role="status">
        <ol>{state.job.stages.map(stage => <li key={stage.key}>{stage.name} · {{ pending: '待执行', running: '进行中', done: '已完成', failed: '失败' }[stage.status]}<p>{stage.detail}</p></li>)}</ol>
        {['queued', 'running'].includes(state.job.status) ? <Button disabled={retrying} onClick={() => void cancel()}>{retrying ? '正在取消…' : '取消任务'}</Button> : null}
        <Button disabled={retrying || ['queued', 'running'].includes(state.job.status)} onClick={() => void retry()}>{retrying ? '正在重试…' : '重试任务'}</Button>
      </div> : state.job?.status === 'completed' ? <Viewer key={state.job.id} id={state.job.id} active={active} /> : <p role="status">请选择作品</p>}
      </>}
    </div>
  </>;
}
