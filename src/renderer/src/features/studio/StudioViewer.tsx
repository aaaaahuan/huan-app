import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import type { DeviceVisibility } from './model';
import { createStudioScene, type StudioScene, type StudioView } from './scene';

const views: { value: StudioView; label: string }[] = [
  { value: 'perspective', label: '透视' }, { value: 'front', label: '正面' }, { value: 'side', label: '侧面' }, { value: 'back', label: '背面' },
];
export function StudioViewer({ visibility, grid, wireframe }: { visibility: DeviceVisibility; grid: boolean; wireframe: boolean }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<StudioScene | null>(null);
  const current = useRef({ visibility, grid, wireframe });
  current.current = { visibility, grid, wireframe };
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<StudioView>('perspective');
  const [feedback, setFeedback] = useState('');
  const downloads = useRef(new Set<string>());
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError(''); setReady(false); setView('perspective');
    try {
      const viewer = createStudioScene(element, message => { setError(message); setReady(false); });
      scene.current = viewer;
      viewer.setVisibility(current.current.visibility); viewer.setGrid(current.current.grid); viewer.setWireframe(current.current.wireframe);
      setReady(true);
      return () => { scene.current = null; viewer.dispose(); };
    } catch (error) { setError(error instanceof Error ? error.message : '无法打开三维模型，请重试。'); }
  }, [attempt]);
  useEffect(() => { scene.current?.setVisibility(visibility); }, [visibility]);
  useEffect(() => { scene.current?.setGrid(grid); }, [grid]);
  useEffect(() => { scene.current?.setWireframe(wireframe); }, [wireframe]);
  useEffect(() => {
    const urls = downloads.current;
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);
  function changeView(value: StudioView) { scene.current?.setView(value); setView(value); }
  function download() {
    if (!scene.current || !ready) return;
    setFeedback('');
    try {
      const blob = new Blob([scene.current.exportSTL()], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob); downloads.current.add(url);
      const link = document.createElement('a'); link.href = url; link.download = '掌心管家-造型草模-mm.stl'; link.click();
      setFeedback('已发起 STL 下载 · 单位毫米，仅含手部草模。');
      setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 60_000);
    } catch (error) { setFeedback(`导出失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  return <div className="studio-viewer">
    <div className="studio-viewer-toolbar">
      <div className="studio-view-buttons" role="group" aria-label="模型视角">{views.map(option => <Button key={option.value}
        aria-pressed={view === option.value} disabled={!ready} onClick={() => changeView(option.value)}>{option.label}</Button>)}</div>
      <div className="studio-export-actions"><Button disabled={!ready} onClick={() => changeView('perspective')}>重置视角</Button>
        <Button disabled={!ready} onClick={download}>导出 STL</Button></div>
    </div>
    <div ref={host} className="studio-canvas-host" />
    {error ? <div className="studio-viewer-message" role="alert"><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>重新加载模型</Button></div>
      : !ready ? <div className="studio-viewer-message" role="status">正在打开模型…</div> : null}
    <footer className="studio-viewer-footer"><span>拖动旋转 · 滚轮缩放 · 右键平移</span><span role="status">{feedback || '单位 mm · 实际网格预览'}</span></footer>
  </div>;
}
