import { useEffect, useState } from 'react';
import type { TerrainDetail, TerrainJobSummary, TerrainPrintModel, TerrainPrintParams } from '@shared/contracts/terrain';
import { estimateTerrainPrint } from '@shared/terrain-print';
import { Input } from '@renderer/components/Input';
import { Select } from '@renderer/components/Select';
import { Button } from '@renderer/components/Button';
import { Modal } from '@renderer/components/Modal';
import { featureNames } from './viewer/features';
import { assetReader } from './viewer/assets';

const states = { present: '已生成', empty: '无数据', failed: '失败', skipped: '已跳过' };
export function WorkDialog({ job, mode, onClose, onDeleted }: { job: TerrainJobSummary; mode: 'summary' | 'delete' | 'print'; onClose(): void; onDeleted(): void }) {
  const [generation, setGeneration] = useState(job.status);
  const generating = generation === 'queued' || generation === 'running';
  const [summary, setSummary] = useState<TerrainDetail>();
  const [saved, setSaved] = useState(false);
  const [params, setParams] = useState<TerrainPrintParams>();
  const [model, setModel] = useState<TerrainPrintModel | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(mode !== 'delete');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (mode === 'summary') {
          const result = await window.huanApp.terrain.getSummary({ id: job.id });
          if (!alive) return;
          if (result.ok) setSummary(result.summary); else setError(result.message);
        } else if (mode === 'print') {
          const result = await window.huanApp.terrain.getPrintParams({ id: job.id });
          if (!alive) return;
          if (result.ok) { setParams(result.params); setModel(result.model); setSaved(result.saved); } else setError(result.message);
        }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '读取失败'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [job.id, mode]);
  useEffect(() => {
    if (!generating || mode !== 'print') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await window.huanApp.terrain.getJob({ id: job.id });
        if (!alive) return;
        if (!result.ok) throw new Error(result.message);
        setGeneration(result.job.status);
        if (result.job.status === 'failed') setError(result.job.error ?? '重新生成失败');
        else if (result.job.status === 'completed') {
          setNotice('重新生成完成，可下载新模型');
          const print = await window.huanApp.terrain.getPrintParams({ id: job.id });
          if (!alive) return;
          if (print.ok) setModel(print.model); else setError(print.message);
        } else timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : '读取生成状态失败'); timer = setTimeout(() => void poll(), 2000); }
      }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [generating, job.id, mode]);
  const estimate = model && params ? estimateTerrainPrint(model, params) : null;
  function update(next: TerrainPrintParams) {
    setNotice('');
    if (model && next.base !== null) {
      const minimum = estimateTerrainPrint(model, next).minimumBase;
      if (next.base < minimum) { next = { ...next, base: minimum <= 20 ? minimum : null }; setNotice(`底座过薄可能切到轨迹或过脆，已回拉至安全厚度 ${minimum.toFixed(1)} mm。`); }
    }
    setParams(next);
  }
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const title = mode === 'delete' ? '删除作品' : mode === 'print' ? '打印参数' : '生成摘要';
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
    <p><strong>{job.name}</strong> · {job.date || '日期未提供'}<br />{job.id}</p>
    {loading ? <p role="status">正在读取…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {mode === 'delete' ? <><p>将永久删除「{job.name}」的整个作品目录，此操作不可恢复。缓存和原始 tracks 文件会保留。</p>
      <Button variant="primary" disabled={busy || ['queued', 'running'].includes(job.status)} onClick={() => void act(async () => {
        const result = await window.huanApp.terrain.delete({ id: job.id }); if (!result.ok) throw new Error(result.message); onDeleted();
      })}>{busy ? '正在删除…' : '永久删除'}</Button></> : null}
    {summary ? <>
      <h3>数据完整度</h3><table><thead><tr><th>要素</th><th>状态</th><th>来源</th><th>数量</th><th>错误</th></tr></thead>
        <tbody>{Object.entries(summary.features).map(([key, value]) => <tr key={key}><td>{featureNames[key] ?? key}</td><td>{states[value.state]}</td><td>{value.source ?? '—'}</td><td>{value.count ?? '—'}</td><td>{value.error ?? '—'}</td></tr>)}</tbody></table>
      {!Object.keys(summary.features).length ? <p>旧作品未记录要素状态。</p> : null}
      <h3>警告</h3>{summary.warnings.length ? <ul>{summary.warnings.map(w => <li key={w.message}>{w.message} ×{w.count}</li>)}</ul> : <p>无警告</p>}
      <h3>模型度量</h3><table><tbody>{Object.entries(summary.metrics).filter(([, value]) => value !== undefined).map(([key, value]) => <tr key={key}><th>{key}</th><td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td></tr>)}</tbody></table>
      <h3>阶段耗时</h3><table><tbody>{summary.job.stages.map(stage => <tr key={stage.key}><th>{stage.name}</th><td>{stage.elapsed_seconds ?? '—'} 秒</td></tr>)}<tr><th>总耗时</th><td>{summary.job.total_seconds ?? '—'} 秒</td></tr></tbody></table>
      <p>STL：{summary.files.stl ? '存在' : '不存在'} · 3MF：{summary.files['3mf'] ? '存在' : '不存在'}</p>
    </> : null}
    {params ? <>
      {generating ? <p role="status">正在按已保存参数重新生成，请稍候…</p> : null}
      <p>拓竹 A1 · 床面 256³ mm · 可用 240 × 240 mm · 0.4 mm 喷嘴 · 0.2 mm 层高 · PLA · 固定填充 15%</p>
      <div className="terrain-print-presets">{[{ name: '摆件标准', longEdge: 180, colors: 'four' }, { name: '床面最大', longEdge: 240, colors: 'four' }, { name: '快速单色', longEdge: 120, colors: 'single' }].map(preset => <Button key={preset.name} aria-pressed={params.longEdge === preset.longEdge && params.colors === preset.colors} onClick={() => update({ longEdge: preset.longEdge, colors: preset.colors === 'four' ? 'four' : 'single', base: null })}>{preset.name}</Button>)}</div>
      <label>长边 {params.longEdge} mm<Input aria-label="模型长边" type="range" min="80" max="240" step="1" value={params.longEdge} onChange={event => update({ ...params, longEdge: Number(event.target.value) })} /></label>
      <label>配色 <Select value={params.colors} options={[{ value: 'four', label: '四色' }, { value: 'single', label: '单色' }]} onValueChange={colors => update({ ...params, colors })} /></label>
      <details><summary>底座厚度：{params.base === null ? `自动（当前 ${estimate?.base.toFixed(1) ?? '—'} mm）` : `${params.base.toFixed(1)} mm`}</summary>
        <label>厚度（4–20 mm，0.2 mm 步进）<Input aria-label="底座厚度" type="number" min="4" max="20" step="0.2" disabled={!estimate || estimate.minimumBase > 20} value={params.base ?? estimate?.base ?? 4} onChange={event => { if (event.target.value) update({ ...params, base: Math.min(20, Math.max(4, Math.round(Number(event.target.value) * 5) / 5)) }); }} /></label><Button onClick={() => update({ ...params, base: null })}>恢复自动底座</Button>
      </details>
      {estimate ? <><table><tbody>
        <tr><th>比例 / XYZ</th><td>约 1:{Math.round(estimate.denominator)} · {estimate.x.toFixed(1)} × {estimate.y.toFixed(1)} × {estimate.height.toFixed(1)} mm</td></tr>
        <tr><th>高度夸张 / 层数</th><td>{estimate.exaggeration.toFixed(2)} 倍 · {estimate.layers} 层</td></tr>
        <tr><th>模型体积 / 耗材</th><td>约 {estimate.volume.toFixed(1)} cm³ / {estimate.grams.toFixed(1)} g</td></tr>
        <tr><th>换色 / 冲刷 / 擦料塔</th><td>约 {estimate.changes} 次 / {estimate.purge.toFixed(1)} g / {estimate.tower.toFixed(1)} g</td></tr>
        <tr><th>时长</th><td>约 {(estimate.hours * .8).toFixed(1)}–{(estimate.hours * 1.2).toFixed(1)} 小时，以 Bambu Studio 切片为准</td></tr>
      </tbody></table>{estimate.compressed ? <p role="status">高度超出 254 mm，已压低高度夸张。</p> : null}</> : <p>旧作品缺少网格或体积数据，无法计算可靠估算；仍可保存参数。</p>}
      <p>AMS lite 最多 4 色：F1 地形+草地 #C6CBB5（房屋/刻度并入）；F2 水系 #2389C9；F3 徒步线 #E94F39；F4 林区 #24563B。</p>
      <p>用 Bambu Studio 打开 3MF，确认四色映射后切片。当前 3MF 是单对象和面颜色材质。保存后可按参数重新生成尺寸与底座；配色选项用于耗材估算，模型继续使用现有面颜色材质。</p>
      {!saved ? <p role="status">请先保存打印参数</p> : null}
      <div className="terrain-print-presets"><Button disabled={busy || generating} onClick={() => void act(async () => {
        const result = await window.huanApp.terrain.savePrintParams({ id: job.id, params }); if (!result.ok) throw new Error(result.message); setSaved(true); setNotice('参数已保存');
      })}>保存参数</Button><Button disabled={busy || generating || !model || !saved} onClick={() => void act(async () => {
        const result = await window.huanApp.terrain.regenerate({ id: job.id });
        if (!result.ok) throw new Error(result.message);
        setGeneration(result.job.status); setNotice('已按保存参数加入生成队列');
      })}>{generating ? '正在生成…' : '按参数重新生成'}</Button><Button disabled={busy || generating || generation !== 'completed'} onClick={() => void act(async () => {
        const content = await assetReader(job.id)('terrain.3mf', 'models');
        const url = URL.createObjectURL(new Blob([content])); const link = document.createElement('a'); link.href = url; link.download = `${job.id}.3mf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>仅下载当前 3MF</Button></div>
    </> : null}
  </Modal>;
}
