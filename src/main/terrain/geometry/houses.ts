import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import proj4 from 'proj4';
import { z } from 'zod';
import design from './pin-house.json';
import type { FeatureConfig } from '../config';
import type { HeightGrid, PrintableMesh } from './terrain';
import type { SurfaceLayers } from './features';
import type { Bounds } from '../pipeline/tracks';
import { writeBytes, writeJson, directory } from '../pipeline/state';

const rowSchema = z.object({ photo_index: z.number().int().positive(), longitude: z.number().finite().min(-180).max(180), latitude: z.number().finite().min(-90).max(90), has_house: z.union([z.boolean(), z.literal('uncertain')]), reason: z.string().max(500).default(''), file_id: z.string().optional() });
type Row = z.infer<typeof rowSchema>;
export interface HousePoint extends Row { model_xy_mm: [number, number]; scene_origin_mm: [number, number, number]; route_gap_radius_mm: number; nearest_route_footprint_clearance_lower_bound_mm?: number }
export async function houseGaps(job: string, grid: HeightGrid, bounds: Bounds, zone: number, south: boolean, cfg: FeatureConfig, photos: { index: number; longitude: number; latitude: number; file_id: string }[], warnings: string[]) {
  // 仅接受任务内固定判断文件；配置中的外部路径不能赋予 worker 任意文件读取权。
  if (cfg.houses.list_file !== 'data/photo_houses.json') throw new Error('原生房屋判断仅支持 data/photo_houses.json');
  const path = join(job, 'data/photo_houses.json');
  let rows: Row[];
  try {
    const file = await lstat(path); if (!file.isFile() || file.size > 2_000_000) throw new Error('房屋判断文件无效');
    rows = z.object({ points: z.array(rowSchema).max(10000) }).parse(JSON.parse(await readFile(path, 'utf8'))).points;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    rows = photos.map(p => ({ photo_index: p.index, longitude: p.longitude, latitude: p.latitude, file_id: p.file_id, has_house: 'uncertain', reason: '尚无人工房屋判断；未运行照片识别' }));
    await writeJson(path, { method: photos.length ? 'native_unclassified' : 'no_photos', points: rows });
    if (photos.length) warnings.push('照片房屋尚未自动识别；仅应用任务内已有人工判断');
  }
  const indices = new Set<number>();
  for (const row of rows) {
    if (indices.has(row.photo_index)) throw new Error('房屋判断照片索引重复'); indices.add(row.photo_index);
    const photo = photos.find(p => p.index === row.photo_index);
    if (!photo || Math.abs(photo.longitude - row.longitude) > 1e-7 || Math.abs(photo.latitude - row.latitude) > 1e-7) throw new Error('房屋判断与轨迹照片点不匹配');
  }
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const gap = new Uint8Array(grid.width * grid.height), points: HousePoint[] = [], outside: number[] = [];
  const radius = cfg.houses.route_gap_mm + 2 * Math.hypot(grid.size[0] / (grid.width - 1), grid.size[1] / (grid.height - 1));
  if (cfg.houses.enabled) for (const row of rows) {
    if (row.has_house !== true && !(row.has_house === 'uncertain' && cfg.houses.include_uncertain)) continue;
    const xy = projection.forward([row.longitude, row.latitude]), x = (xy[0] - bounds[0]) * grid.scale, y = (xy[1] - bounds[1]) * grid.scale;
    if (x < 0 || y < 0 || x > grid.size[0] || y > grid.size[1]) { outside.push(row.photo_index); continue; }
    points.push({ ...row, model_xy_mm: [x, y], scene_origin_mm: [x, y, 0], route_gap_radius_mm: cfg.houses.route_gap_mm });
    for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) if ((i * grid.size[0] / (grid.width - 1) - x) ** 2 + (j * grid.size[1] / (grid.height - 1) - y) ** 2 <= radius ** 2) gap[j * grid.width + i] = 1;
  }
  return { gap, points, outside, rows };
}
// 点到三角形的精确 XY 距离；保守圆包络覆盖整个 pin 屋，保证 footprint 与路线不相交。
function pointTriangle(x: number, y: number, triangle: number[][]) {
  let distance = Infinity, positive = false, negative = false;
  for (let k = 0; k < 3; k++) {
    const a = triangle[k], b = triangle[(k + 1) % 3], dx = b[0] - a[0], dy = b[1] - a[1];
    const cross = dx * (y - a[1]) - dy * (x - a[0]); positive ||= cross > 0; negative ||= cross < 0;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return positive && negative ? distance : 0;
}
export async function placeHouses(job: string, grid: HeightGrid, layers: SurfaceLayers, terrain: PrintableMesh, cfg: FeatureConfig, houses: Awaited<ReturnType<typeof houseGaps>>) {
  if (cfg.houses.model_stl !== 'data/house_designs/5_pin_house.stl' || cfg.houses.model_glb !== 'data/house_designs/5_pin_house.glb') throw new Error('原生房屋仅支持已核验的 5_pin_house 设计');
  const meshes: PrintableMesh[] = [], faceGap = new Uint8Array(2 * (grid.width - 1) * (grid.height - 1));
  for (let face = 0; face < faceGap.length; face++) {
    const ids = terrain.triangles.subarray(face * 3, face * 3 + 3);
    const x = ids.reduce((s, i) => s + terrain.vertices[i * 3], 0) / 3, y = ids.reduce((s, i) => s + terrain.vertices[i * 3 + 1], 0) / 3;
    faceGap[face] = Number(ids.some(i => houses.gap[i]) || houses.points.some(p => Math.hypot(x - p.model_xy_mm[0], y - p.model_xy_mm[1]) <= p.route_gap_radius_mm));
    if (faceGap[face] && terrain.materials[face] === 4) {
      const sample = Math.round(y / grid.size[1] * (grid.height - 1)) * grid.width + Math.round(x / grid.size[0] * (grid.width - 1));
      terrain.materials[face] = layers.classes[sample];
    }
  }
  for (const point of houses.points) {
    const [x, y] = point.model_xy_mm, ix = x / grid.size[0] * (grid.width - 1), iy = y / grid.size[1] * (grid.height - 1), i = Math.min(Math.floor(ix), grid.width - 2), j = Math.min(Math.floor(iy), grid.height - 2), fx = ix - i, fy = iy - j;
    const a = j * grid.width + i, za = layers.z[a], zb = layers.z[a + 1], zc = layers.z[a + grid.width], zd = layers.z[a + grid.width + 1];
    const surface = fx >= fy ? (1 - fx) * za + (fx - fy) * zb + fy * zd : (1 - fy) * za + fx * zd + (fy - fx) * zc;
    point.scene_origin_mm = [x, y, surface - cfg.houses.sink_mm];
    let minCenter = Infinity;
    for (let face = 0; face < faceGap.length; face++) {
      const ids = terrain.triangles.subarray(face * 3, face * 3 + 3);
      if (terrain.materials[face] !== 4 && !ids.some(id => !layers.routeGap[id] && layers.distance[id] < .85 && layers.z[id] - Math.max(layers.base[id], layers.base[id] + layers.water[id], layers.base[id] + layers.forest[id]) > 1e-6)) continue;
      minCenter = Math.min(minCenter, pointTriangle(x, y, Array.from(ids, id => [terrain.vertices[id * 3], terrain.vertices[id * 3 + 1]])));
    }
    const clearance = minCenter - 1.7 * cfg.houses.scale;
    if (minCenter < point.route_gap_radius_mm || clearance <= 0 || clearance < cfg.houses.min_route_clearance_mm) throw new Error('房屋与路线净距不足');
    if (Number.isFinite(clearance)) point.nearest_route_footprint_clearance_lower_bound_mm = clearance;
    const vertices = Float32Array.from(design.vertices, (v, k) => v * cfg.houses.scale + point.scene_origin_mm[k % 3]);
    meshes.push({ vertices, triangles: Uint32Array.from(design.triangles), materials: Uint32Array.from(design.materials), volume: 0 });
  }
  if (houses.points.length) {
    await directory(join(job, 'web/house_designs'));
    await writeBytes(join(job, 'web/house_designs/5_pin_house.glb'), Buffer.from(design.glb, 'base64'));
  }
  return { meshes, faceGap, report: { placed_points: houses.points, outside_indices: houses.outside, model_glb: './house_designs/5_pin_house.glb', scale: cfg.houses.scale, sink_mm: cfg.houses.sink_mm, route_gap_mm: cfg.houses.route_gap_mm, gap_vertex_count: houses.gap.reduce((a, b) => a + b, 0), gap_face_count: faceGap.reduce((a, b) => a + b, 0), design_provenance: design.provenance, clearance_rule: 'Exact point-to-route-triangle distance minus enclosing pin radius; strict positive lower bound' } };
}
