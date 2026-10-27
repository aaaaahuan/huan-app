import { readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import proj4 from 'proj4';
import { writeJson } from './state';

export const PIPELINE_PENDING = '等待解析 KML/KMZ 并构建原生地形';
const MAX_XML = 50_000_000;
type Node = { tag: string; uri: string; text: string; attrs: Record<string, string>; children: Node[] };
const K = 'http://www.opengis.net/kml/2.2';
const G = 'http://www.google.com/kml/ext/2.2';
export type Coordinate = [number, number, number];
export type Bounds = [number, number, number, number];
function children(node: Node, tag: string, uri = K) { return node.children.filter(n => n.tag === tag && n.uri === uri); }
function descendants(node: Node, tag: string, uri = K): Node[] { return node.children.flatMap(n => [...(n.tag === tag && n.uri === uri ? [n] : []), ...descendants(n, tag, uri)]); }
function text(node: Node, tag: string) { return children(node, tag)[0]?.text.trim() ?? ''; }
function extended(node: Node) { return Object.fromEntries(children(node, 'ExtendedData').flatMap(n => children(n, 'Data')).map(n => [n.attrs.name, text(n, 'value')])); }

// 先审计中央目录，才允许解压选定 KML；不解压附件，不接受 ZIP64/加密/路径逃逸。
export function extractKml(bytes: Uint8Array, kmz: boolean): Uint8Array {
  if (!kmz) { if (bytes.length > MAX_XML) throw new Error('KML 超过 50 MB'); return bytes; }
  if (bytes.length > 150_000_000) throw new Error('KMZ 压缩大小超过 150 MB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('KMZ ZIP 目录损坏');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 2500 || start + size !== end) throw new Error('KMZ 文件数量超限或 ZIP 格式不受支持');
  let offset = start, total = 0;
  const names: string[] = [], seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('KMZ ZIP 目录损坏');
    const compressed = view.getUint32(offset + 20, true), uncompressed = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (offset + 46 + length + extra + comment > end || local + 30 > start) throw new Error('KMZ 条目越界');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(s => s === '..' || s === '.') || seen.has(name)) throw new Error('KMZ 包含不安全或重复路径');
    seen.add(name);
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || ((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error('KMZ 不支持加密、ZIP64 或链接条目');
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new Error('KMZ 本地条目与目录不一致');
    const localLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    if (local + 30 + localLength + localExtra + compressed > start || new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localLength)) !== name) throw new Error('KMZ 条目大小或名称不一致');
    total += uncompressed;
    if (total > 800_000_000 || compressed > 150_000_000) throw new Error('KMZ 解压总量超过 800 MB');
    if (name.toLowerCase().endsWith('.kml')) { if (uncompressed > MAX_XML) throw new Error('KML 超过 50 MB'); names.push(name); }
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) throw new Error('KMZ ZIP 目录大小不一致');
  const selected = names.find(n => n.toLowerCase() === 'doc.kml') ?? (names.length === 1 ? names[0] : undefined);
  if (!selected) throw new Error('KMZ 需要 doc.kml 或唯一 KML');
  try {
    const result = unzipSync(bytes, { filter: file => file.name === selected && file.originalSize <= MAX_XML });
    if (!result[selected] || result[selected].length > MAX_XML) throw new Error('size');
    return result[selected];
  } catch { throw new Error('KMZ KML 解压失败或大小超限'); }
}
function xml(raw: Uint8Array): Node {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new Error('KML 必须为 UTF-8 XML'); }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(source)) throw new Error('不接受 XML DTD/实体');
  const root: Node = { tag: '', uri: '', text: '', attrs: {}, children: [] }, stack = [root];
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('不接受 XML DTD/实体'); });
  parser.on('opentag', tag => {
    if (++nodes > 1_000_000 || stack.length > 64) throw new Error('KML XML 节点数或嵌套深度超限');
    const node: Node = { tag: tag.local, uri: tag.uri, text: '', attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])), children: [] };
    stack[stack.length - 1].children.push(node); stack.push(node);
  });
  parser.on('text', value => { stack[stack.length - 1].text += value; });
  parser.on('cdata', value => { stack[stack.length - 1].text += value; });
  parser.on('closetag', () => { stack.pop(); });
  try { parser.write(source).close(); } catch (error) { throw new Error(`KML XML 无效：${error instanceof Error ? error.message : '解析失败'}`, { cause: error }); }
  const result = root.children[0];
  if (!result || result.tag !== 'kml' || result.uri !== K) throw new Error('不是 KML 2.2 文档');
  return result;
}
export function parseTrack(raw: Uint8Array, filename: string) {
  const root = xml(raw), doc = children(root, 'Document')[0] ?? root, ext = extended(doc);
  let missingAltitude = false;
  function coord(value: string, delimiter: RegExp, photo = false): Coordinate {
    const fields = value.trim().split(delimiter);
    const numbers = fields.map(v => v === '' ? NaN : Number(v));
    if (numbers.length < 2 || numbers.length > 3 || numbers.some(v => !Number.isFinite(v)) || Math.abs(numbers[0]) > 180 || numbers[1] < (photo ? -90 : -80) || numbers[1] > (photo ? 90 : 84)) throw new Error('坐标无效：仅支持经度 ±180、UTM 纬度 -80 至 84');
    if (!photo && numbers.length < 3) missingAltitude = true;
    return [numbers[0], numbers[1], numbers[2] ?? 0];
  }
  const tracks = descendants(root, 'Track', G);
  let segments = tracks.map(n => children(n, 'coord', G).map(v => coord(v.text, /\s+/))).filter(s => s.length);
  if (!segments.length) segments = descendants(root, 'LineString').map(n => text(n, 'coordinates').split(/\s+/).filter(Boolean).map(v => coord(v, /,/))).filter(s => s.length);
  const coordinates = segments.flat();
  if (coordinates.length < 2 || coordinates.length > 200000) throw new Error('未找到可用轨迹，或轨迹超过 20 万点');
  const longs = coordinates.map(p => p[0]);
  let west = Infinity, east = -Infinity;
  for (const lon of longs) { west = Math.min(west, lon); east = Math.max(east, lon); }
  if (east - west > 180) throw new Error('暂不支持跨日期变更线轨迹');
  const lon = longs.reduce((a, b) => a + b, 0) / coordinates.length, lat = coordinates.reduce((a, p) => a + p[1], 0) / coordinates.length;
  const zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${lat < 0 ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of coordinates) { const [x, y] = projection.forward(p); bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y); }
  bounds[0] -= 1100; bounds[1] -= 1100; bounds[2] += 1100; bounds[3] += 1100;
  if (Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) > 200000) throw new Error('模型跨度超过 200 km；请裁剪轨迹后重试');
  const geographic: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 22; i++) for (const p of [[bounds[0] + (bounds[2] - bounds[0]) * i / 22, bounds[1]], [bounds[0] + (bounds[2] - bounds[0]) * i / 22, bounds[3]], [bounds[0], bounds[1] + (bounds[3] - bounds[1]) * i / 22], [bounds[2], bounds[1] + (bounds[3] - bounds[1]) * i / 22]]) {
    const [x, y] = projection.inverse(p); geographic[0] = Math.min(geographic[0], x); geographic[1] = Math.min(geographic[1], y); geographic[2] = Math.max(geographic[2], x); geographic[3] = Math.max(geographic[3], y);
  }
  let date = '';
  if (ext.BeginTime && Number.isFinite(Number(ext.BeginTime))) { const d = new Date(Number(ext.BeginTime) + 8 * 3600000); if (Number.isFinite(d.getTime())) date = d.toISOString().slice(0, 10); }
  if (!date) date = tracks.flatMap(n => children(n, 'when'))[0]?.text.slice(0, 10) ?? '';
  const photos = descendants(root, 'Placemark').flatMap(pm => {
    const value = children(pm, 'Point')[0], data = extended(pm);
    if (!value || !text(pm, 'styleUrl').includes('MarkerStylePicture') || !/^\d+$/.test(data.FileId ?? '')) return [];
    const p = coord(text(value, 'coordinates'), /,/, true);
    return [{ file_id: data.FileId, longitude: p[0], latitude: p[1], recorded_altitude_m: text(value, 'coordinates').split(',').length > 2 ? p[2] : null, timestamp_ms: data.Time ?? null, name: text(pm, 'name'), note: data.description ?? '' }];
  }).map((p, i) => ({ index: i + 1, ...p }));
  const info = { name: text(doc, 'name') || basename(filename).replace(/\.(kml|kmz)$/i, ''), date, point_count: coordinates.length, epsg: (lat < 0 ? 32700 : 32600) + zone, utm_zone: zone, hemisphere: lat < 0 ? 'S' : 'N', bounds_wgs84: geographic, bounds_projected: bounds, photo_points: photos, segments: segments.map(s => s.length), missing_altitude: missingAltitude, warnings: segments.length > 1 ? ['多个 Track 段按导出顺序连接，段间停录空隙可能形成连接线'] : [] };
  return { info, coordinates };
}
async function writeBytes(path: string, bytes: Uint8Array | string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export async function parseJobTrack(job: string, inputFile: string, filename: string) {
  const path = join(job, inputFile);
  if ((await stat(path)).size > (inputFile.endsWith('.kmz') ? 150_000_000 : MAX_XML)) throw new Error('轨迹文件大小超限');
  const raw = extractKml(await readFile(path), inputFile.endsWith('.kmz'));
  const parsed = parseTrack(raw, filename);
  await writeBytes(join(job, 'data/source.kml'), raw);
  await writeBytes(join(job, 'data/route.kml'), `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="${K}" xmlns:gx="${G}"><Document><gx:Track>${parsed.coordinates.map(p => `<gx:coord>${p.join(' ')}</gx:coord>`).join('')}</gx:Track></Document></kml>`);
  await writeJson(join(job, 'data/route_info.json'), parsed.info);
  return parsed.info;
}
