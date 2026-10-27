import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, mkdtemp, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Bounds } from '../pipeline/tracks';
import { writeJson } from '../pipeline/state';
import { DownloadError, fetchFile, proxyRecord, type FetchFile } from './network';
export const OVERPASS_SERVER_TIMEOUT = 90, OVERPASS_ATTEMPT = 105, OVERPASS_BUDGET = 240, OSM_API_RESERVE = 60, OVERPASS_MIN_ATTEMPT = 20;
export const _slow_endpoints = new Set<string>();
const element = z.object({ type: z.string(), id: z.number(), lat: z.number().optional(), lon: z.number().optional(), nodes: z.array(z.number()).optional(), tags: z.record(z.string(), z.string()).optional() }).passthrough();
const document = z.object({ elements: z.array(element), remark: z.unknown().optional() }).passthrough();
type Element = z.infer<typeof element>;
export type OsmDocument = z.infer<typeof document>;
async function readOsm(path: string) {
  const file = await lstat(path);
  if (!file.isFile() || file.size > 100_000_000) throw new Error('OSM 响应超过 100 MB 或不是普通文件');
  return decode(await readFile(path, 'utf8'));
}
function decode(raw: string) { const doc = document.parse(JSON.parse(raw)); if ('remark' in doc) throw new Error('Overpass 返回不完整数据'); return doc; }
export function overpassQuery(bounds: Bounds, kind: 'natural' | 'building' | 'highway' | 'settlement' = 'natural') {
  const [w, s, e, n] = bounds, box = `(${s.toFixed(7)},${w.toFixed(7)},${n.toFixed(7)},${e.toFixed(7)})`;
  const tags = kind === 'building' ? ['nwr[building]'] : kind === 'highway' ? ['way["highway"]'] : kind === 'settlement' ? ['node[place~"^(city|town|village|hamlet|locality)$"]', 'way[landuse~"^(residential|commercial|retail|industrial)$"]', 'relation[landuse~"^(residential|commercial|retail|industrial)$"]'] : ['way[waterway~"^(river|stream)$"]', 'nwr[natural=water]', 'nwr[landuse=forest]', 'nwr[natural~"^(wood|glacier)$"]'];
  const body = `(${tags.map(t => `${t}${box};`).join('')});out body geom;`;
  return { query: `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT}];${body}`, key: createHash('sha256').update(`[out:json][timeout:25];${body}`).digest('hex').slice(0, 24) };
}
export async function osmMap(bounds: Bounds, deadline: number, temp: string, fetch: FetchFile, settlement = false, now = () => performance.now() / 1000): Promise<OsmDocument> {
  const nodes = new Map<number, Element>(), ways = new Map<number, Element>(), tagged = new Map<number, Element>(); let tiles = 0;
  const keep = (el: Element) => settlement ? (el.type === 'node' ? /^(city|town|village|hamlet|locality)$/.test(el.tags?.place ?? '') : el.type === 'way' && /^(residential|commercial|retail|industrial)$/.test(el.tags?.landuse ?? '')) : el.type === 'way' && Boolean(el.tags?.highway);
  async function tile(b: Bounds, depth = 0): Promise<void> {
    const remaining = deadline - now(); if (remaining <= 0) throw new Error('OSM API 总预算耗尽');
    const [w, s, e, n] = b;
    const split = async () => {
      if (depth >= 12) throw new Error('OSM API 区域要素过密');
      if (e - w >= n - s) { const m = (w + e) / 2; await tile([w, s, m, n], depth + 1); await tile([m, s, e, n], depth + 1); }
      else { const m = (s + n) / 2; await tile([w, s, e, m], depth + 1); await tile([w, m, e, n], depth + 1); }
    };
    if ((e - w) * (n - s) > 0.25) return split();
    const path = join(temp, 'map.json'); let doc: OsmDocument;
    try { await fetch('https://api.openstreetmap.org/api/0.6/map.json', path, Math.min(30, remaining), { bbox: b.join(',') }); doc = await readOsm(path); }
    catch (error) { if (error instanceof DownloadError && error.status === 400) return split(); throw error; }
    tiles++;
    for (const el of doc.elements) {
      if (el.type === 'node') { nodes.set(el.id, el); if (keep(el)) tagged.set(el.id, el); }
      else if (el.type === 'way' && keep(el)) ways.set(el.id, el);
      // /map 回退有意丢弃 relation，与 Python 相同；聚落覆盖可能不完整。
    }
  }
  await tile(bounds);
  const elements = [...tagged.values()];
  for (const way of ways.values()) {
    const ids = way.nodes ?? [];
    if (ids.length < 2 || ids.some(id => !nodes.has(id))) continue;
    const geometry = ids.map(id => nodes.get(id)).filter((n): n is Element => !!n && n.lat !== undefined && n.lon !== undefined).map(n => ({ lat: n.lat, lon: n.lon }));
    if (geometry.length >= 2) elements.push({ type: 'way', id: way.id, tags: way.tags, geometry });
  }
  return { elements, map_tiles: tiles };
}
export async function overpass(root: string, bounds: Bounds, kind: 'natural' | 'building' | 'highway' | 'settlement' = 'natural', fetch = fetchFile(), now = () => performance.now() / 1000) {
  const cache = join(root, 'cache'); await mkdir(cache, { recursive: true });
  if (!(await lstat(cache)).isDirectory()) throw new Error('缓存目录不能是符号链接');
  const { query, key } = overpassQuery(bounds, kind), cached = join(cache, `osm-${key}.json`), sourceFile = join(cache, `osm-${key}.source.json`);
  try {
    if (!(await lstat(cached)).isFile() || (await lstat(cached)).size > 100_000_000) throw new Error('OSM 缓存无效');
    const doc = decode(await readFile(cached, 'utf8'));
    let source: Record<string, unknown> = {};
    try { source = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(sourceFile, 'utf8'))); } catch { /* 兼容没有 sidecar 的旧缓存。 */ }
    if (source.source_type !== 'local') return { doc, source: { ...source, cache_hit: true, query, coverage_bounds_wgs84: bounds } };
  } catch { /* 损坏缓存重新请求，不伪造成功。 */ }
  const wide = kind === 'highway' || kind === 'settlement', reserve = wide ? OSM_API_RESERVE : 0, deadline = now() + OVERPASS_BUDGET + reserve;
  const endpoints = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', ...(wide ? ['https://maps.mail.ru/osm/tools/overpass/api/interpreter'] : []), 'https://overpass-api.de/api/interpreter'].sort((a, b) => Number(_slow_endpoints.has(a)) - Number(_slow_endpoints.has(b)));
  const errors: { endpoint: string; error: string }[] = [], temp = await mkdtemp(join(cache, 'osm-'));
  async function save(doc: OsmDocument, source: Record<string, unknown>) { await writeJson(cached, doc); await writeJson(sourceFile, source); return { doc, source }; }
  try {
    for (const endpoint of endpoints) {
      const remaining = deadline - now() - reserve;
      if (remaining < OVERPASS_MIN_ATTEMPT) { errors.push({ endpoint: 'budget', error: 'Overpass 总预算耗尽' }); break; }
      const attempt = Math.min(OVERPASS_ATTEMPT, remaining), started = now();
      try {
        const path = join(temp, 'response.json'); await fetch(endpoint, path, attempt, { data: query });
        const doc = await readOsm(path); _slow_endpoints.delete(endpoint);
        return await save(doc, { cache_hit: false, source_type: 'overpass', proxy: await proxyRecord(endpoint), endpoint, query, coverage_bounds_wgs84: bounds, timestamp: doc.osm3s ?? {}, previous_errors: errors });
      } catch (error) {
        if (error instanceof DownloadError && error.timedOut && attempt === OVERPASS_ATTEMPT && now() - started >= attempt - 1) _slow_endpoints.add(endpoint);
        errors.push({ endpoint, error: error instanceof Error ? error.message : 'OSM 获取失败' });
      }
    }
    if (wide && now() < deadline) {
      try { const doc = await osmMap(bounds, deadline, temp, fetch, kind === 'settlement', now); return await save(doc, { cache_hit: false, source_type: 'osm_api', map_tiles: doc.map_tiles, endpoint: 'https://api.openstreetmap.org/api/0.6/map.json', query, coverage_bounds_wgs84: bounds, previous_errors: errors, warnings: ['OSM /map 回退丢弃 relations，聚落面积可能不完整'] }); }
      catch (error) { errors.push({ endpoint: 'osm_api', error: error instanceof Error ? error.message : '获取失败' }); }
    }
    throw new Error(JSON.stringify(errors));
  } finally { await rm(temp, { recursive: true, force: true }); }
}
