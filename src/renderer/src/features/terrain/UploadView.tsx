import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';

export function UploadView({ onCreated }: { onCreated(id: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function upload(file?: File) {
    if (!file || busy.current) return;
    if (!/\.(kml|kmz)$/i.test(file.name) || !file.size || file.size > 150_000_000) { setError('请选择非空 KML/KMZ 文件，最大 150 MB。'); return; }
    busy.current = true; setUploading(true); setError('');
    try {
      const content = new Uint8Array(await file.arrayBuffer());
      if (!mounted.current) return;
      const result = await window.huanApp.terrain.upload({ filename: file.name, content });
      if (!mounted.current) return;
      if (result.ok) onCreated(result.job.id); else setError(result.message);
    } catch { if (mounted.current) setError('上传失败，请重试。'); }
    finally { busy.current = false; if (mounted.current) setUploading(false); }
  }
  return <div className="terrain-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }} aria-busy={uploading}>
    <h2>新建作品</h2><p>拖入 KML / KMZ 轨迹，或选择文件（最大 150 MB）。</p>
    <p>当前生成 DEM 地形与底座；路线、地表浮雕、房屋和刻度将在后续支持。</p>
    <input ref={input} type="file" accept=".kml,.kmz" aria-label="选择轨迹文件" hidden disabled={uploading}
      onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
    <Button variant="primary" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? '正在上传…' : '选择轨迹文件'}</Button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
