import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { UploadView } from './UploadView';
import { WorkList, workFacts } from './WorkList';
import { useTerrainLibrary } from './useTerrainLibrary';
import './workbench.css';

export function Workbench({ active, previewUrl, children, onPreview }: { active: boolean; previewUrl: string; children: ReactNode; onPreview?(): void }) {
  const state = useTerrainLibrary(active);
  const [creating, setCreating] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (!creating && state.job?.status === 'completed') onPreview?.(); }, [creating, state.job?.status, onPreview]);
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
  // 仅从 ensure 返回的服务地址构造导航，不信任旧 status 中的 preview_url。
  const url = previewUrl ? new URL(previewUrl) : null;
  if (state.job && url) url.searchParams.set('job', state.job.id);
  return <>
    <WorkList {...state} onSelect={id => { generation.current++; setRetrying(false); setError(''); setCreating(false); state.select(id); }} onRefresh={state.refresh} />
    <div className="terrain-preview">
      <div className="terrain-toolbar"><Button onClick={() => { generation.current++; setCreating(true); setRetrying(false); setError(''); }}>＋ 新建作品</Button></div>
      {creating ? <UploadView onCreated={id => { state.select(id); state.refresh(); setCreating(false); }} /> : <>

      {state.selectedId ? <div className="terrain-selection" role={state.selectionError ? 'alert' : 'status'}>
        {state.selectionError || (state.job ? `${state.job.name} · ${workFacts(state.job)}${state.job.error ? ` · ${state.job.error}` : ''}` : '正在读取所选作品…')}
      </div> : null}
      {error ? <p role="alert">{error}</p> : null}
      {state.job && state.job.status !== 'completed' ? <div className="terrain-progress" role="status">
        <ol>{state.job.stages.map(stage => <li key={stage.key}>{stage.name} · {{ pending: '待执行', running: '进行中', done: '已完成', failed: '失败' }[stage.status]}<p>{stage.detail}</p></li>)}</ol>
        <Button disabled={retrying || state.job.status === 'running'} onClick={() => void retry()}>{retrying ? '正在重试…' : '重试任务'}</Button>
      </div> : url && state.job?.status === 'completed' ? <iframe className="terrain-frame" title="地形作品空间" src={url.href}
        sandbox="allow-scripts allow-same-origin allow-downloads" /> : children}
      </>}
    </div>
  </>;
}
