import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { SaxesParser } from 'saxes';
import { strFromU8, unzipSync } from 'fflate';
import type { TerrainExportModel } from '@shared/contracts/terrain';
import { composePreview } from '@shared/terrain-surface';
import { resolveJobAsset } from './assets';
import { serializeTerrain } from './pipeline/export';

const metadataSchema = z.object({
  size: z.tuple([z.number().positive(), z.number().positive()]),
  palette: z.array(z.object({ id: z.number().int().nonnegative(), name: z.string(), hex: z.string() })),
  preview_layers: z.object({
    grid: z.tuple([z.number().int().min(2), z.number().int().min(2)]),
    available: z.record(z.string(), z.boolean()), base: z.string(), classes: z.string(), distance: z.string(),
    forest: z.string().optional(), rivers: z.string().optional(), houses: z.string().optional(), route_gap: z.string().optional()
  })
});

// 只接受本应用的单实体、逐面纯色模型；未知结构明确报错，避免丢失附件或变换。
function parseModel(content: Uint8Array) {
  const xml = unzipSync(content)['3D/3dmodel.model'];
  if (!xml || xml.byteLength > 250_000_000) throw new Error('3MF 模型数据无效或过大');
  const positions: number[] = [], triangles: number[] = [], materials: number[] = [];
  const colors: { id: number; name: string; hex: string }[] = [];
  let objects = 0, meshes = 0, items = 0, objectId = '', materialId = '';
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw new Error('3MF 不允许外部文档声明'); });
  parser.on('opentag', tag => {
    const attr = (key: string) => String(tag.attributes[key] ?? '');
    const number = (key: string) => { const text = attr(key), n = Number(text); if (!text || !Number.isFinite(n)) throw new Error('3MF 数值无效'); return n; };
    switch (tag.name) {
      case 'model': if (attr('unit') !== 'millimeter') throw new Error('暂不支持此模型单位'); break;
      case 'object': if (++objects !== 1 || attr('transform')) throw new Error('暂不支持此模型结构'); objectId = attr('id'); break;
      case 'mesh': if (++meshes !== 1) throw new Error('暂不支持多网格模型'); break;
      case 'basematerials': if (materialId) throw new Error('暂不支持多组材质'); materialId = attr('id'); break;
      case 'base': {
        const color = attr('displaycolor');
        if (!/^#[\da-f]{6}(ff)?$/i.test(color)) throw new Error('模型材质颜色无效');
        colors.push({ id: colors.length, name: attr('name'), hex: color.slice(0, 7) }); break;
      }
      case 'vertex': positions.push(number('x'), number('y'), number('z')); break;
      case 'triangle': {
        if (attr('pid') !== materialId || ['p2', 'p3'].some(key => attr(key) && attr(key) !== attr('p1'))) throw new Error('暂不支持混合面材质');
        const indices = ['v1', 'v2', 'v3'].map(number), material = number('p1');
        if ([...indices, material].some(n => !Number.isInteger(n) || n < 0)) throw new Error('模型索引无效');
        triangles.push(...indices); materials.push(material); break;
      }
      case 'components': case 'component': throw new Error('暂不支持组合模型');
      case 'item': if (++items !== 1 || attr('objectid') !== objectId || attr('transform')) throw new Error('暂不支持此模型构建方式'); break;
    }
    if (positions.length > 6_000_000 || triangles.length > 12_000_000) throw new Error('模型超过导出处理上限');
  });
  parser.write(strFromU8(xml)).close();
  if (objects !== 1 || meshes !== 1 || items !== 1 || !positions.length || !triangles.length || !colors.length) throw new Error('模型结构不完整');
  return { vertices: new Float32Array(positions), triangles: new Uint32Array(triangles), materials: new Uint32Array(materials), volume: 0, colors };
}

export async function exportModel(root: string, input: TerrainExportModel): Promise<Uint8Array> {
  const read = async (path: string, area: 'web' | 'models' = 'web') => {
    const file = await resolveJobAsset(root, input.id, area, path.startsWith('./') ? path.slice(2) : path);
    if ((await stat(file)).size > 150_000_000) throw new Error('模型资源超过 150 MB');
    return new Uint8Array(await readFile(file));
  };
  if (input.track) return read(`terrain.${input.format}`, 'models');
  const meta = metadataSchema.parse(JSON.parse(new TextDecoder().decode(await read('metadata.json'))));
  const spec = meta.preview_layers, [nx, ny] = spec.grid, count = nx * ny;
  if (count > 2_000_000) throw new Error('高度场超过处理上限');
  const floats = async (path: string) => {
    const bytes = await read(path);
    if (bytes.byteLength !== count * 4) throw new Error('高度场尺寸不匹配');
    const result = new Float32Array(bytes.buffer);
    if (result.some(n => !Number.isFinite(n))) throw new Error('高度场包含无效数值');
    return result;
  };
  const bytes = async (path: string) => { const result = await read(path); if (result.length !== count) throw new Error('分类图层尺寸不匹配'); return result; };
  const [base, classes, distance, forest, rivers, houses, routeGap, original, packed] = await Promise.all([
    floats(spec.base), bytes(spec.classes), floats(spec.distance),
    spec.available.forest && spec.forest ? floats(spec.forest) : undefined,
    spec.available.rivers && spec.rivers ? floats(spec.rivers) : undefined,
    spec.available.houses && spec.houses ? floats(spec.houses) : undefined,
    spec.route_gap ? bytes(spec.route_gap) : undefined, read('vertices.bin'), read('terrain.3mf', 'models')
  ]);
  if (original.byteLength % 12 || original.byteLength < count * 12) throw new Error('原始高度场不完整');
  const originalVertices = new Float32Array(original.buffer);
  const layers = { base, classes, distance, forest, rivers, houses, routeGap };
  const full = composePreview(layers, { ...spec.available, track: true }).z;
  const { z: surface, preClass } = composePreview(layers, { ...spec.available, track: false });
  // 旧作品的 3MF 经布尔运算后顶点会重排，不能按预览顶点序号直接覆盖。
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(originalVertices[i * 3 + 2]) || Math.abs(full[i] - originalVertices[i * 3 + 2]) > .002) throw new Error('该作品的高度场规则不兼容，无法安全去除路径');
  }
  const mesh = parseModel(packed);
  const route = meta.palette.find(p => p.id === 4 && /route|路线|路径/i.test(p.name));
  if (!route) throw new Error('未能确认原模型的路径材质');
  // 旧版 3MF 会压缩未使用的调色板，文件内材质序号不等于元数据的类别 ID。
  const materialFor = (id: number) => {
    const color = meta.palette.find(p => p.id === id);
    if (!color) throw new Error('地表类别缺少材质');
    const existing = mesh.colors.findIndex(p => p.name === color.name && p.hex.toLowerCase() === color.hex.toLowerCase());
    if (existing !== -1) return existing;
    mesh.colors.push({ ...color, id: mesh.colors.length });
    return mesh.colors.length - 1;
  };
  const routeMaterial = mesh.colors.findIndex(p => p.name === route.name && p.hex.toLowerCase() === route.hex.toLowerCase());
  function sample(values: Float32Array, x: number, y: number) {
    const gx = Math.max(0, Math.min(nx - 1, x / meta.size[0] * (nx - 1))), gy = Math.max(0, Math.min(ny - 1, y / meta.size[1] * (ny - 1)));
    const i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(ny - 2, Math.floor(gy)), fx = gx - i, fy = gy - j;
    const a = values[j * nx + i], b = values[j * nx + i + 1], c = values[(j + 1) * nx + i], d = values[(j + 1) * nx + i + 1];
    return fx >= fy ? (1 - fx) * a + (fx - fy) * b + fy * d : (1 - fy) * a + fx * d + (fy - fx) * c;
  }
  const v = mesh.vertices, t = mesh.triangles;
  let changed = 0;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < -.002 || y < -.002 || x > meta.size[0] + .002 || y > meta.size[1] + .002) continue;
    const top = sample(full, x, y), next = sample(surface, x, y);
    // 只移动地形表面上的路径顶点，保留底座、房屋和刻度的其余顶点。
    if (Math.abs(z - top) < .002 && top - next > .00001) { v[i + 2] = next; changed++; }
  }
  let routeFaces = 0;
  for (let i = 0; i < mesh.materials.length; i++) {
    if (mesh.materials[i] !== routeMaterial) continue;
    routeFaces++;
    const ids = [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]];
    if (ids.some(id => id * 3 + 2 >= v.length)) throw new Error('模型索引越界');
    const x = ids.reduce((sum, id) => sum + v[id * 3], 0) / 3, y = ids.reduce((sum, id) => sum + v[id * 3 + 1], 0) / 3;
    const ix = Math.max(0, Math.min(nx - 1, Math.round(x / meta.size[0] * (nx - 1)))), iy = Math.max(0, Math.min(ny - 1, Math.round(y / meta.size[1] * (ny - 1))));
    mesh.materials[i] = materialFor(preClass[iy * nx + ix]);
  }
  if (routeFaces && !changed) throw new Error('未能定位路径凸起，已停止导出');
  // 去掉未使用的路径色，切片软件也不会再列出这一耗材。
  const used = new Set(mesh.materials), colors = mesh.colors.filter(p => used.has(p.id));
  const remap = new Map(colors.map((p, i) => [p.id, i]));
  mesh.materials = mesh.materials.map(id => { const next = remap.get(id); if (next === undefined) throw new Error('模型材质不存在'); return next; });
  const result = serializeTerrain(mesh, colors.map((p, id) => ({ ...p, id })));
  return input.format === '3mf' ? result.archive : result.bytes;
}
