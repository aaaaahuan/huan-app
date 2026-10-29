import proj4 from 'proj4';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { overpass } from '../datasets/overpass';
import type { FetchFile } from '../datasets/network';
import type { Bounds } from '../pipeline/tracks';
import { writeBytes, writeJson } from '../pipeline/state';

const styles = {
  major: { label: '主干道路', color: '#ffc56a', width_mm: .55, min_px: 3.5, max_mm: 2.8 },
  secondary: { label: '次干道路', color: '#fff0c2', width_mm: .40, min_px: 2.5, max_mm: 2 },
  local: { label: '支路', color: '#f4ddba', width_mm: .28, min_px: 2, max_mm: 1.6 },
  trail: { label: '小路', color: '#e9c18f', width_mm: .16, min_px: 1.5, max_mm: 1.2 }
};
function classify(highway: string): keyof typeof styles | undefined {
  const base = highway.replace(/_link$/, '');
  if (['motorway', 'trunk', 'primary'].includes(base)) return 'major';
  if (['secondary', 'tertiary'].includes(base)) return 'secondary';
  if (['residential', 'unclassified', 'service', 'living_street'].includes(highway)) return 'local';
  if (['track', 'path', 'footway', 'bridleway', 'steps', 'cycleway'].includes(highway)) return 'trail';
  return;
}
const geometry = z.array(z.object({ lon: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) }));
// Liang–Barsky 裁剪逐段线，缺失节点已由下载器整条剔除，不跨缺口连接。
function clip(a: number[], b: number[], size: number[]) {
  let lo = 0, hi = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy], q = [a[0], size[0] - a[0], a[1], size[1] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return;
  }
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}
export async function prepareRoads(root: string, job: string, geographic: Bounds, bounds: Bounds, zone: number, south: boolean, scale: number, warnings: string[], fetch?: FetchFile) {
  let raw: Awaited<ReturnType<typeof overpass>>['doc'] = { elements: [] };
  let source: Record<string, unknown>;
  try { const result = await overpass(root, geographic, 'highway', fetch); raw = result.doc; source = { ...result.source, available: true }; }
  catch (error) { const message = `道路获取失败：${error instanceof Error ? error.message : String(error)}`; warnings.push(message); source = { available: false, error: message }; }
  await writeJson(join(job, 'data/osm_roads_raw.json'), raw);
  await writeJson(join(job, 'data/osm_roads_source.json'), { ...source, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', license_url: 'https://www.openstreetmap.org/copyright' });
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const size = [(bounds[2] - bounds[0]) * scale, (bounds[3] - bounds[1]) * scale];
  const buffers = { major: [] as number[], secondary: [] as number[], local: [] as number[], trail: [] as number[] };
  const counts = { major: 0, secondary: 0, local: 0, trail: 0 };
  let overflow = false;
  const roadsFloatLimit = Number(process.env.HUAN_TERRAIN_ROADS_FLOAT_LIMIT) || 18_000_000;
  ways: for (const el of raw.elements) {
    const kind = classify(el.tags?.highway ?? '');
    if (el.type !== 'way' || !kind) continue;
    const parsed = geometry.safeParse(el.geometry); if (!parsed.success) continue;
    const points = parsed.data.map(p => { const xy = projection.forward([p.lon, p.lat]); return [(xy[0] - bounds[0]) * scale, (xy[1] - bounds[1]) * scale]; });
    let included = false;
    for (let i = 1; i < points.length; i++) {
      const segment = clip(points[i - 1], points[i], size); if (!segment) continue;
      const [a, b] = segment, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-8) continue;
      included = true;
      const nx = -dy / length * styles[kind].width_mm / 2, ny = dx / length * styles[kind].width_mm / 2, n = Math.max(1, Math.ceil(length / .12));
      for (let j = 0; j < n; j++) {
        const u = [a[0] + dx * j / n, a[1] + dy * j / n], v = [a[0] + dx * (j + 1) / n, a[1] + dy * (j + 1) / n];
        for (const [p, sign] of [[u, -1], [v, -1], [v, 1], [u, -1], [v, 1], [u, 1]] as const) buffers[kind].push(Math.max(0, Math.min(size[0], p[0] + sign * nx)), Math.max(0, Math.min(size[1], p[1] + sign * ny)), 0);
        if (buffers[kind].length > roadsFloatLimit) { overflow = true; break ways; }
      }
    }
    if (included) counts[kind]++;
  }
  if (overflow) {
    warnings.push('道路预览超过安全上限，已跳过道路图层');
    for (const kind of Object.keys(styles) as (keyof typeof styles)[]) await rm(join(job, 'web', `layers/roads_${kind}.bin`), { force: true });
    return { count: 0, counts: { major: 0, secondary: 0, local: 0, trail: 0 }, groups: {}, preview_only: true, lift_mm: .07 };
  }
  const groups: Record<string, typeof styles.major & { vertices: string; vertex_count: number }> = {};
  for (const kind of Object.keys(styles) as (keyof typeof styles)[]) {
    const path = `layers/roads_${kind}.bin`, points = buffers[kind];
    if (!points.length) { await rm(join(job, 'web', path), { force: true }); continue; }
    const bytes = Buffer.alloc(points.length * 4); points.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    await writeBytes(join(job, 'web', path), bytes);
    groups[kind] = { ...styles[kind], vertices: `./${path}`, vertex_count: points.length / 3 };
  }
  return { count: Object.values(counts).reduce((a, b) => a + b, 0), counts, groups, preview_only: true, lift_mm: .07 };
}
