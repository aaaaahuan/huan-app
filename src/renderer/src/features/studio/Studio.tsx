import { useEffect, useState } from 'react';
import type { StudioProject } from '@shared/contracts/studio';
import { Button } from '@renderer/components/Button';
import { Modal } from '@renderer/components/Modal';
import { FileViewer } from './FileViewer';
import './studio.css';

function size(bytes: number) { return bytes < 1000000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1000000).toFixed(1)} MB`; }
function ProjectPreview({ project }: { project: StudioProject }) {
 const [path, setPath] = useState(project.files[0]?.path || '');
 const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
 const [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState<number | null>(null), [error, setError] = useState('');
 useEffect(() => {
  let cancelled = false;
  setPhotos([]); setExpanded(false); setZoom(null); setError('');
  if (path) void window.huanApp.studio.photos({ project: project.name, path }).then(result => {
   if (cancelled) return;
   if (result.ok) setPhotos(result.value); else setError(result.message);
  }).catch(() => { if (!cancelled) setError('实物图片读取失败。'); });
  return () => { cancelled = true; };
 }, [project.name, path]);
 return <div className="studio-workspace">
  <div className="studio-model-heading"><div><h2>{project.name}</h2><p>{project.files.length} 个模型文件</p></div>
   {photos.length ? <div className="studio-photo-control"><Button aria-expanded={expanded} aria-controls="studio-photo-gallery" onClick={() => setExpanded(v => !v)}><img src={photos[0].url} alt="实物图预览" /><span>实物图 · {photos.length} {expanded ? '▴' : '▾'}</span></Button></div> : null}
  </div>
  {photos.length ? <div id="studio-photo-gallery" className={`studio-photo-gallery${expanded ? ' is-open' : ''}`} inert={!expanded}>{photos.map((photo, index) => <button key={photo.name} onClick={() => setZoom(index)} aria-label={`放大实物图 ${photo.name}`}><img src={photo.url} alt={photo.name} /></button>)}</div> : null}
  {error ? <p role="alert">{error}</p> : null}
  {project.files.length > 1 ? <label className="studio-file-select">模型文件<select value={path} onChange={event => setPath(event.target.value)}>{project.files.map(file => <option key={file.path} value={file.path}>{file.path} · {size(file.size)}</option>)}</select></label> : null}
  {path ? <FileViewer key={path} project={project.name} path={path} /> : <p className="studio-empty" role="status">该目录暂无可预览的模型文件。</p>}
  {zoom !== null && photos[zoom] ? <Modal title={photos[zoom].name} onClose={() => setZoom(null)}><div className="studio-reference"><img src={photos[zoom].url} alt={photos[zoom].name} /></div></Modal> : null}
 </div>;
}
export function Studio({ active }: { active: boolean }) {
 const [projects, setProjects] = useState<StudioProject[]>([]), [selected, setSelected] = useState('');
 const [error, setError] = useState(''), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
 useEffect(() => {
  if (!active) return;
  let cancelled = false; setLoading(true); setError('');
  void window.huanApp.studio.list().then(result => {
   if (cancelled) return;
   if (!result.ok) { setError(result.message); return; }
   setProjects(result.value); setSelected(current => result.value.some(p => p.name === current) ? current : result.value[0]?.name || '');
  }).catch(() => { if (!cancelled) setError('模型目录读取失败。'); }).finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
 }, [active, attempt]);
 const project = projects.find(item => item.name === selected);
 return <section className="studio-page" hidden={!active} aria-label="3d工作台">
  <header className="studio-heading"><div><p>3D STUDIO</p><h1>3d工作台</h1></div><span>{projects.length} 个模型 · 让收藏长出形状</span></header>
  <div className="studio-layout"><aside className="studio-sidebar" aria-label="模型列表"><span className="studio-section-label">模型收藏</span>
   {projects.map(item => <button className="studio-project-card" key={item.name} aria-pressed={item.name === selected} onClick={() => setSelected(item.name)}><strong>{item.name}</strong><span>{size(item.size)}</span></button>)}
   {loading ? <p role="status">正在读取模型目录…</p> : null}
   {error ? <div role="alert"><p>{error}</p><Button onClick={() => setAttempt(v => v + 1)}>重试</Button></div> : null}
   {!loading && !error && !projects.length ? <p role="status">3d-model 目录中还没有模型。</p> : null}
  </aside>{active && project ? <ProjectPreview key={project.name} project={project} /> : <div className="studio-workspace studio-empty">选择一个模型，开始浏览</div>}</div>
 </section>;
}
