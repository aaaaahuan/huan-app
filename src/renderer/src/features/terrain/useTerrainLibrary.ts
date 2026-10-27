import { useEffect, useState } from 'react';
import type { TerrainJobList, TerrainJobSummary } from '@shared/contracts/terrain';

// Workbench 按 settingsRevision 重新挂载；清理同时阻止旧目录、旧选择的响应回写。
export function useTerrainLibrary(active: boolean) {
  const [library, setLibrary] = useState<TerrainJobList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ id: string; job?: TerrainJobSummary; error?: string }>();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      setLoading(true);
      try {
        const result = await window.huanApp.terrain.listJobs();
        if (cancelled) return;
        if (result.ok) { setLibrary(result); setError(''); }
        else setError(result.message);
      } catch { if (!cancelled) setError('无法读取作品库，请重试。'); }
      finally {
        if (!cancelled) { setLoading(false); timer = setTimeout(() => void refresh(), 5000); }
      }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, revision]);

  useEffect(() => {
    if (!active || !selectedId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = selectedId;
    async function refresh() {
      try {
        const result = await window.huanApp.terrain.getJob({ id });
        if (cancelled) return;
        if (result.ok) setSelection({ id, job: result.job });
        else setSelection({ id, error: result.message });
      } catch { if (!cancelled) setSelection({ id, error: '无法读取所选作品，请重试。' }); }
      finally { if (!cancelled) timer = setTimeout(() => void refresh(), 1000); }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, selectedId, revision]);

  const current = selection?.id === selectedId ? selection : undefined;
  return { library, loading, error, selectedId, select: (id: string) => { if (id !== selectedId) setSelection(undefined); setSelectedId(id); }, job: current?.job,
    selectionError: current?.error, refresh: () => setRevision(value => value + 1) };
}
