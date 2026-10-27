import { mkdir, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import { palette } from '../geometry/features';
import type { PrintableMesh } from '../geometry/terrain';
import { writeJson, writeBytes } from './state';

export function validateMesh(mesh: PrintableMesh) {
  const { vertices: v, triangles: t } = mesh, edges = new Map<string, number>();
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (let i = 0; i < v.length; i++) { if (!Number.isFinite(v[i])) throw new Error('非有限顶点'); const k = i % 3; low[k] = Math.min(low[k], v[i]); high[k] = Math.max(high[k], v[i]); }
  for (let i = 0; i < t.length; i += 3) {
    const ids = [t[i], t[i + 1], t[i + 2]];
    if (new Set(ids).size !== 3 || ids.some(id => id * 3 + 2 >= v.length)) throw new Error('无效三角形');
    for (let j = 0; j < 3; j++) { const a = ids[j], b = ids[(j + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`; edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1)); }
    const [a, b, c] = ids.map(id => id * 3);
    volume += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  // 有向边抵消与无向边计数独立校验，不能只凭正体积认定封闭。
  const counts = new Map<string, number>();
  for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) { const a = t[i + j], b = t[i + (j + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  if ([...edges.values()].some(n => n !== 0) || [...counts.values()].some(n => n !== 2) || volume <= 0) throw new Error('网格不封闭或绕序不一致');
  return { vertices: v.length / 3, triangles: t.length / 3, dimensions_mm: high.map((n, k) => n - low[k]), volume_mm3: volume, watertight: true, winding_consistent: true };
}
export async function exportTerrain(job: string, mesh: PrintableMesh) {
  if (mesh.materials.length !== mesh.triangles.length / 3 || mesh.materials.some(id => id >= palette.length)) throw new Error('面材质来源无效');
  const report = validateMesh(mesh), { vertices: v, triangles: t } = mesh;
  const bytes = new Uint8Array(84 + report.triangles * 50), view = new DataView(bytes.buffer);
  view.setUint32(80, report.triangles, true);
  for (let i = 0; i < t.length; i += 3) {
    const points = [t[i], t[i + 1], t[i + 2]].map(id => Array.from(v.subarray(id * 3, id * 3 + 3)));
    const [a, b, c] = points, u = b.map((n, k) => n - a[k]), w = c.map((n, k) => n - a[k]);
    const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], length = Math.hypot(...normal);
    if (!length) throw new Error('退化三角形');
    [...normal.map(n => n / length), ...points.flat()].forEach((n, k) => view.setFloat32(84 + i / 3 * 50 + k * 4, n, true));
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="1">${palette.map(p => `<base name="${p.name}" displaycolor="${p.hex}FF"/>`).join('')}</basematerials><object id="2" type="model"><mesh><vertices>${Array.from({ length: v.length / 3 }, (_, i) => `<vertex x="${v[3 * i]}" y="${v[3 * i + 1]}" z="${v[3 * i + 2]}"/>`).join('')}</vertices><triangles>${Array.from({ length: t.length / 3 }, (_, i) => `<triangle v1="${t[3 * i]}" v2="${t[3 * i + 1]}" v3="${t[3 * i + 2]}" pid="1" p1="${mesh.materials[i]}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
  await mkdir(join(job, 'models'), { recursive: true });
  if (!(await lstat(join(job, 'models'))).isDirectory()) throw new Error('模型目录不能是符号链接');
  await writeBytes(join(job, 'models/terrain.stl'), bytes);
  await writeBytes(join(job, 'models/terrain.3mf'), zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model)
  }));
  const stl = await readFile(join(job, 'models/terrain.stl'));
  if (!stl.equals(bytes)) throw new Error('STL 写入后校验失败');
  const archive = unzipSync(await readFile(join(job, 'models/terrain.3mf')));
  if (strFromU8(archive['3D/3dmodel.model']) !== model) throw new Error('3MF 写入后校验失败');
  await writeJson(join(job, 'models/validation.json'), { ...report, materials: palette.filter(p => mesh.materials.includes(p.id)), limitations: ['OSM 要素、房屋和刻度尚未迁移'], serialization: 'STL bytes and 3MF XML round-trip; independent reader verification required' });
  return report;
}
