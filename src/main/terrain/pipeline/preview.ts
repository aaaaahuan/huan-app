import { mkdir, lstat } from 'node:fs/promises';
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
    await writeBytes(join(job, 'web/layers/houses.bin'), new Uint8Array(layers.base.length * 4));
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
  let settlements: Awaited<ReturnType<typeof preparePlaces>> | undefined;
  let roads: Awaited<ReturnType<typeof prepareRoads>> | undefined;
  if (places) {
    try { settlements = await preparePlaces(places.root, job, places.geographic, places.projected, places.zone, places.south, grid.scale, places.warnings, places.fetch, grid); }
    catch (error) { places.warnings.push(`聚落/地名预览失败：${error instanceof Error ? error.message : String(error)}`); }
    try { roads = await prepareRoads(places.root, job, places.geographic, places.projected, places.zone, places.south, grid.scale, places.warnings, places.fetch); }
    catch (error) { places.warnings.push(`道路预览失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  available.roads = Boolean(roads && Object.keys(roads.groups).length);
  available.settlements = Boolean(settlements?.areas.url);
  available.places = Boolean(settlements?.places.count);
  await writeJson(join(job, 'web/metadata.json'), { ...metadata, size: grid.size, palette: metadata.palette ?? palette, native_core_only: false,
    ...(settlements ? { settlements } : {}), ...(roads ? { roads } : {}),
    preview_layers: { grid: [grid.width, grid.height], top_faces: top, available, base: './layers/base_z.bin', classes: './layers/classes.bin', distance: './layers/route_distance.bin', face_route: './layers/face_route.bin', ...(hasHouses ? { houses: './layers/houses.bin', route_gap: './layers/route_gap.bin', face_gap: './layers/face_gap.bin' } : {}), ...(available.settlements ? { settlements: settlements?.areas.url } : {}), ...(available.rivers ? { rivers: './layers/rivers.bin' } : {}), ...(available.forest ? { forest: './layers/forest.bin' } : {}), ...(available.places ? { places: settlements?.places.url } : {}) } });
}
