import { z } from 'zod';
import type { TerrainFeatureStatus } from '@shared/contracts/terrain';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HeightGrid, PrintableMesh } from '../geometry/terrain';
import { palette, type SurfaceLayers } from '../geometry/features';
import { writeBytes, writeJson } from './state';
import { prepareRoads } from '../overlays/roads';
import { preparePlaces } from '../overlays';
import type { Bounds } from './tracks';
import type { FetchFile } from '../datasets/network';

// 使用未经布尔重排的高度场拓扑；图层开关仅重组显示，不改写打印资产。
export async function packagePreview(job: string, grid: HeightGrid, mesh: PrintableMesh, layers: SurfaceLayers, metadata: Record<string, unknown>, places?: { root: string; geographic: Bounds; projected: Bounds; zone: number; south: boolean; warnings: string[]; fetch?: FetchFile }, scaleMesh?: PrintableMesh, faceGap?: Uint8Array, hasHouses = false) {
  for (const path of ['web', 'web/layers']) {
    await mkdir(join(job, path), { recursive: true });
    if (!(await lstat(join(job, path))).isDirectory()) throw new Error('预览目录不能是符号链接');
  }
  const top = 2 * (grid.width - 1) * (grid.height - 1);
  const available = { forest: layers.classes.includes(2), grass: layers.classes.includes(5), snow: layers.classes.includes(3), rivers: layers.classes.includes(1), houses: hasHouses, elevation_scale: !!scaleMesh, roads: false, places: false, settlements: false };
  async function floats(path: string, values: Float32Array | Uint32Array) {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => { if (values instanceof Float32Array) bytes.writeFloatLE(v, i * 4); else bytes.writeUInt32LE(v, i * 4); });
    await writeBytes(join(job, 'web', path), bytes);
  }
  await floats('vertices.bin', mesh.vertices); await floats('faces.bin', mesh.triangles);
  await writeBytes(join(job, 'web/face_materials.bin'), Uint8Array.from(mesh.materials));
  if (hasHouses) {
    await writeBytes(join(job, 'web/layers/route_gap.bin'), layers.routeGap);
    if (faceGap) await writeBytes(join(job, 'web/layers/face_gap.bin'), faceGap);
  }
  await floats('layers/base_z.bin', layers.base); await floats('layers/route_distance.bin', layers.distance);
  await writeBytes(join(job, 'web/layers/classes.bin'), layers.classes);
  // 保存未施加房屋缺口的路线面，关闭房屋时才能恢复完整红色路线。
  const routeFaces = new Uint8Array(top);
  for (let face = 0; face < top; face++) {
    const ids = mesh.triangles.subarray(face * 3, face * 3 + 3);
    const x = ids.reduce((sum, id) => sum + mesh.vertices[id * 3], 0) / 3;
    const y = ids.reduce((sum, id) => sum + mesh.vertices[id * 3 + 1], 0) / 3;
    routeFaces[face] = Number(layers.distanceAt(x, y) < .72);
  }
  await writeBytes(join(job, 'web/layers/face_route.bin'), routeFaces);
  if (scaleMesh) { await floats('layers/elevation_scale_vertices.bin', scaleMesh.vertices); await floats('layers/elevation_scale_faces.bin', scaleMesh.triangles); }
  if (available.rivers) await floats('layers/rivers.bin', layers.water);
  if (available.forest) await floats('layers/forest.bin', layers.forest);
  // 道路/聚落/地名为 preview_only；单层失败记警告并跳过，不阻断核心预览与打印资产。
  const overlayErrors: Record<string, string> = {};
  let settlements: Awaited<ReturnType<typeof preparePlaces>> | undefined;
  let roads: Awaited<ReturnType<typeof prepareRoads>> | undefined;
  if (places) {
    try { settlements = await preparePlaces(places.root, job, places.geographic, places.projected, places.zone, places.south, grid.scale, places.warnings, places.fetch, grid); }
    catch (error) { overlayErrors.places = `聚落/地名预览失败：${error instanceof Error ? error.message : String(error)}`; places.warnings.push(overlayErrors.places); }
    try { roads = await prepareRoads(places.root, job, places.geographic, places.projected, places.zone, places.south, grid.scale, places.warnings, places.fetch); }
    catch (error) { overlayErrors.roads = `道路预览失败：${error instanceof Error ? error.message : String(error)}`; places.warnings.push(overlayErrors.roads); }
  }
  available.roads = Boolean(roads && Object.keys(roads.groups).length);
  available.settlements = Boolean(settlements?.areas.url);
  available.places = Boolean(settlements?.places.count);
  const feature_status: TerrainFeatureStatus = {};
  const config = z.record(z.string(), z.unknown()).catch({}).parse(
    z.object({ effective: z.unknown() }).catch({ effective: {} }).parse(metadata.configuration).effective);
  const sourceSchema = z.object({ available: z.boolean().optional(), error: z.string().optional(), dataset: z.string().optional() }).passthrough();
  async function source(name: string) {
    try { return sourceSchema.parse(JSON.parse(await readFile(join(job, `data/${name}_source.json`), 'utf8'))); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
  }
  const dem = await source('dem'), osm = await source('osm'), cover = await source('worldcover');
  const roadSource = await source('osm_roads'), placeSource = await source('osm_settlements');
  function record(key: string, count: number, sources: (typeof dem)[], failure?: string) {
    const errors = sources.flatMap(s => s?.available === false ? [s.error ?? '数据获取失败'] : []);
    const state = z.object({ enabled: z.boolean() }).safeParse(config[key]).data?.enabled === false ? 'skipped' : failure || (!count && errors.length) ? 'failed' : count ? 'present' : 'empty';
    feature_status[key] = { state,
      count, source: sources.flatMap(s => s ? [s.dataset ?? '数据源未注明'] : []).join(' + ') || '生成管线',
      ...(state === 'failed' ? { error: failure ?? errors.join('；') } : {}) };
  }
  record('dem', grid.width * grid.height, [dem]);
  for (const [key, id] of [['rivers', 1], ['forest', 2], ['grass', 5], ['snow', 3]] as const)
    record(key, layers.classes.filter(c => c === id).length, key === 'rivers' ? [osm] : key === 'grass' ? [cover] : [cover, osm]);
  record('track', routeFaces.filter(Boolean).length, []);
  record('houses', hasHouses ? z.object({ placed_points: z.array(z.unknown()) }).parse(metadata.houses).placed_points.length : 0, []);
  record('photos', 0, []); feature_status.photos = { state: 'skipped', source: '照片附件解析尚未迁移' };
  record('elevation_scale', scaleMesh ? 1 : 0, []);
  record('roads', roads?.count ?? 0, [roadSource], overlayErrors.roads);
  record('places', settlements?.places.count ?? 0, [placeSource], overlayErrors.places);
  record('settlements', settlements ? Object.values(settlements.areas.cells).reduce((a, b) => a + b, 0) : 0, [placeSource], overlayErrors.places);
  await writeJson(join(job, 'web/metadata.json'), { ...metadata, feature_status, size: grid.size, palette: metadata.palette ?? palette, native_core_only: false,
    ...(settlements ? { settlements } : {}), ...(roads ? { roads } : {}),
    preview_layers: { grid: [grid.width, grid.height], top_faces: top, available, base: './layers/base_z.bin', classes: './layers/classes.bin', distance: './layers/route_distance.bin', face_route: './layers/face_route.bin', ...(hasHouses ? { route_gap: './layers/route_gap.bin', face_gap: './layers/face_gap.bin' } : {}), ...(available.settlements ? { settlements: settlements?.areas.url } : {}), ...(available.rivers ? { rivers: './layers/rivers.bin' } : {}), ...(available.forest ? { forest: './layers/forest.bin' } : {}), ...(available.places ? { places: settlements?.places.url } : {}) } });
}
