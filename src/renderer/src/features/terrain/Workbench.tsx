import type { ReactNode } from 'react';
import { WorkList, workFacts } from './WorkList';
import { useTerrainLibrary } from './useTerrainLibrary';
import './workbench.css';

export function Workbench({ active, previewUrl, children }: { active: boolean; previewUrl: string; children: ReactNode }) {
  const state = useTerrainLibrary(active);
  // 仅从 ensure 返回的服务地址构造导航，不信任旧 status 中的 preview_url。
  const url = previewUrl ? new URL(previewUrl) : null;
  if (state.job && url) url.searchParams.set('job', state.job.id);
  return <>
    <WorkList {...state} onSelect={state.select} onRefresh={state.refresh} />
    <div className="terrain-preview">
      {state.selectedId ? <div className="terrain-selection" role={state.selectionError ? 'alert' : 'status'}>
        {state.selectionError || (state.job ? `${state.job.name} · ${workFacts(state.job)}${state.job.error ? ` · ${state.job.error}` : ''}` : '正在读取所选作品…')}
      </div> : null}
      {url ? <iframe className="terrain-frame" title="地形作品空间" src={url.href}
        sandbox="allow-scripts allow-same-origin allow-downloads" /> : children}
    </div>
  </>;
}
