import proj4 from 'proj4';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { Bounds } from '../pipeline/tracks';
import { overpass, type OsmDocument } from '../datasets/overpass';
import { fetchFile, type FetchFile } from '../datasets/network';
import { writeJson } from '../pipeline/state';

const styles = {
  city: { rank: 1, font_px: 17 }, town: { rank: 2, font_px: 15 },
  village: { rank: 3, font_px: 13 }, hamlet: { rank: 4, font_px: 12 }, locality: { rank: 5, font_px: 11 }
};
type Kind = keyof typeof styles;
function isKind(value: string): value is Kind { return Object.hasOwn(styles, value); }

// 地名仅来自真实 OSM node；按投影模型边界裁剪，不将 landuse 面中心伪装成地名。
export function placeLabels(raw: OsmDocument, bounds: Bounds, zone: number, south: boolean, scale: number) {
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const seen = new Set<number>();
  const labels = [];
  for (const el of raw.elements) {
    const tags = el.tags ?? {}, kind = tags.place ?? '';
    if (el.type !== 'node' || !isKind(kind) || seen.has(el.id) || el.lon === undefined || el.lat === undefined || Math.abs(el.lon) > 180 || Math.abs(el.lat) > 90) continue;
    const name = ['name:zh', 'name:zh-Hans', 'name:zh-CN', 'name'].map(key => tags[key]?.trim()).find(Boolean);
    if (!name) continue;
    const [x, y] = projection.forward([el.lon, el.lat]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3]) continue;
    seen.add(el.id);
    const text = (tags.population ?? '').replaceAll(',', '').trim();
    const population = /^[+-]?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
    labels.push({ name, name_source: tags.name !== name ? tags.name ?? null : null, kind, rank: styles[kind].rank, x_mm: (x - bounds[0]) * scale, y_mm: (y - bounds[1]) * scale, population, osm_id: el.id });
  }
  labels.sort((a, b) => a.rank - b.rank || (b.population ?? 0) - (a.population ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const kept = labels.slice(0, 400);
  return { labels: kept, styles, preview_only: true, dropped_over_limit: Math.max(0, labels.length - 400) };
}

export async function preparePlaces(root: string, job: string, geographic: Bounds, projected: Bounds, zone: number, south: boolean, scale: number, warnings: string[], fetch: FetchFile = fetchFile()) {
  let raw: OsmDocument = { elements: [] };
  const license = { license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', license_url: 'https://www.openstreetmap.org/copyright' };
  let source: Record<string, unknown>;
  try {
    const result = await overpass(root, geographic, 'settlement', fetch);
    raw = result.doc; source = { ...result.source, ...license, available: true };
  } catch (error) {
    const message = `地名数据获取失败：${error instanceof Error ? error.message : '未知错误'}`;
    warnings.push(message); source = { ...license, available: false, error: message };
  }
  await writeJson(join(job, 'data/osm_settlements_raw.json'), raw);
  await writeJson(join(job, 'data/osm_settlements_source.json'), source);
  const doc = placeLabels(raw, projected, zone, south, scale);
  const path = join(job, 'web/layers/places.json');
  if (doc.labels.length) await writeJson(path, doc);
  else await rm(path, { force: true });
  return { preview_only: true, places: { count: doc.labels.length, dropped_over_limit: doc.dropped_over_limit, url: doc.labels.length ? './layers/places.json' : null, lift_mm: .6 } };
}
