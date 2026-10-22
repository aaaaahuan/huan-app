import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/Button';
import './terrain.css';

export function Terrain({ active, settingsRevision, onOpenSettings }: { active: boolean; settingsRevision: number; onOpenSettings(): void }) {
  const [ready, setReady] = useState<{ url: string; settingsRevision: number } | null>(null);
  // 页面只属于对应的数据目录修订，避免快速启动时批量更新复用旧 iframe。
  const url = ready?.settingsRevision === settingsRevision ? ready.url : '';
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError('');
    void window.huanApp.terrain.ensure().then(result => {
      if (cancelled) return;
      if (result.ok) setReady({ url: result.url, settingsRevision });
      else { setReady(null); setError(result.message); }
    }).catch(() => { if (!cancelled) { setReady(null); setError('无法连接地形服务，请重试。'); } });
    return () => { cancelled = true; };
  }, [active, revision, settingsRevision]);
  return <section className="terrain-system" hidden={!active} aria-label="地形">
    {url ? <iframe className="terrain-frame" title="地形作品空间" src={url}
      sandbox="allow-scripts allow-same-origin allow-downloads" /> :
      <div className="terrain-status" role={error ? 'alert' : 'status'}>
        <p>{error || '正在启动地形服务…'}</p>
        {error ? <><Button onClick={() => { setError(''); setRevision(value => value + 1); }}>重试</Button><Button onClick={onOpenSettings}>打开设置</Button></> : null}
      </div>}
  </section>;
}
