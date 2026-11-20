import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { Input } from '@renderer/components/Input';

export function UploadView({ onCreated }: { onCreated(id: string): void }) {
  const input = useRef<HTMLInputElement>(null), mounted = useRef(true), busy = useRef(false);
  const [uploading,setUploading] = useState(false), [choosing,setChoosing] = useState(false), [error,setError] = useState('');
  const [file,setFile] = useState<File>(), [name,setName] = useState(''), [date,setDate] = useState(''), [modelPath,setModelPath] = useState('');
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; }; },[]);
  function select(file?: File) {
    if (!file || busy.current) return;
    if (!/\.(kml|kmz)$/i.test(file.name) || !file.size || file.size > 150_000_000) { setError('请选择非空 KML/KMZ 文件，最大 150 MB。'); return; }
    setFile(file); setError('');
    setName(file.name.replace(/\.(kml|kmz)$/i,'').replace(/^\d{4}-\d{2}-\d{2}\s*/,''));
    setDate(file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '');
  }
  async function chooseModel() {
    if (choosing || busy.current) return;
    setChoosing(true); setError('');
    try { const result=await window.huanApp.terrain.chooseModel(); if (!mounted.current) return; if (!result.ok) setError(result.message); else if (result.path) setModelPath(result.path); }
    catch { if (mounted.current) setError('选择模型失败，请重试。'); }
    finally { if (mounted.current) setChoosing(false); }
  }
  async function create() {
    if (!file || busy.current || !name.trim() || !date) return;
    busy.current=true; setUploading(true); setError('');
    try {
      const content=new Uint8Array(await file.arrayBuffer());
      if (!mounted.current) return;
      const result=await window.huanApp.terrain.upload({ filename:file.name,content,name:name.trim(),date,modelPath:modelPath.trim() });
      if (!mounted.current) return;
      if (result.ok) onCreated(result.job.id); else setError(result.message);
    } catch { if (mounted.current) setError('保存作品失败，请重试。'); }
    finally { busy.current=false; if (mounted.current) setUploading(false); }
  }
  const disabled = uploading || choosing;
  return <div className="terrain-create">
    <form className="terrain-upload" aria-labelledby="terrain-create-title" aria-busy={uploading}
      onSubmit={event => { event.preventDefault(); void create(); }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); if (!disabled) select(event.dataTransfer.files[0]); }}>
      <h2 id="terrain-create-title">新建作品</h2>
      <input ref={input} type="file" accept=".kml,.kmz" hidden disabled={disabled}
        onChange={event => { select(event.target.files?.[0]); event.target.value = ''; }} />
      <Button className="terrain-track-picker" disabled={disabled} onClick={() => input.current?.click()}>
        <Icon name="file-text" />
        <span>
          <strong title={file?.name}>{file?.name ?? '选择轨迹文件'}</strong>
          <small>{file ? '点击更换文件' : '支持拖入 KML / KMZ，最大 150 MB'}</small>
        </span>
      </Button>
      <div className="terrain-create-fields">
        <label>作品名称<Input value={name} maxLength={200} required disabled={disabled}
          onChange={event => setName(event.target.value)} /></label>
        <label>轨迹日期<Input type="date" value={date} required disabled={disabled}
          onChange={event => setDate(event.target.value)} /></label>
      </div>
      <details className="terrain-model-option">
        <summary><Icon name="chevron" /><span>关联已有模型</span><small>可选</small></summary>
        <div className="terrain-model-field">
          <Input aria-label="模型文件路径" value={modelPath} maxLength={4096} disabled={disabled}
            onChange={event => setModelPath(event.target.value)} placeholder="3MF / STL 文件路径" />
          <Button disabled={disabled} onClick={() => void chooseModel()}>{choosing ? '选择中…' : '浏览…'}</Button>
        </div>
      </details>
      {error ? <p className="terrain-form-error" role="alert">{error}</p> : null}
      <footer className="terrain-create-footer">
        <Button type="submit" variant="primary" disabled={disabled || !file || !name.trim() || !date}>
          {uploading ? '正在保存…' : modelPath.trim() ? '保存作品' : '保存并建模'}
        </Button>
      </footer>
    </form>
  </div>;
}
