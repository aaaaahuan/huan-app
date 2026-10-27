import { mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HeightGrid, PrintableMesh } from '../geometry/terrain';
import { palette, type SurfaceLayers } from '../geometry/features';
import { writeBytes, writeJson } from './state';

// 使用未经布尔重排的高度场拓扑；图层开关仅重组显示，不改写打印资产。
export async function packagePreview(job: string, grid: HeightGrid, mesh: PrintableMesh, layers: SurfaceLayers, metadata: Record<string, unknown>) {
  for (const path of ['web', 'web/layers']) {
    await mkdir(join(job, path), { recursive: true });
    if (!(await lstat(join(job, path))).isDirectory()) throw new Error('预览目录不能是符号链接');
  }
  const top = 2 * (grid.width - 1) * (grid.height - 1);
  const available = { forest: layers.classes.includes(2), grass: layers.classes.includes(5), snow: layers.classes.includes(3), rivers: false, houses: false, elevation_scale: false, roads: false, places: false, settlements: false };
  async function floats(path: string, values: Float32Array | Uint32Array) {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => { if (values instanceof Float32Array) bytes.writeFloatLE(v, i * 4); else bytes.writeUInt32LE(v, i * 4); });
    await writeBytes(join(job, 'web', path), bytes);
  }
  await floats('vertices.bin', mesh.vertices); await floats('faces.bin', mesh.triangles);
  await writeBytes(join(job, 'web/face_materials.bin'), Uint8Array.from(mesh.materials));
  await floats('layers/base_z.bin', layers.base); await floats('layers/route_distance.bin', layers.distance);
  await writeBytes(join(job, 'web/layers/classes.bin'), layers.classes);
  await writeBytes(join(job, 'web/layers/face_route.bin'), Uint8Array.from(mesh.materials.subarray(0, top), id => id === 4 ? 1 : 0));
  if (available.forest) await floats('layers/forest.bin', layers.forest);
  await writeJson(join(job, 'web/metadata.json'), { ...metadata, size: grid.size, palette, native_core_only: false,
    preview_layers: { grid: [grid.width, grid.height], top_faces: top, available, base: './layers/base_z.bin', classes: './layers/classes.bin', distance: './layers/route_distance.bin', face_route: './layers/face_route.bin', ...(available.forest ? { forest: './layers/forest.bin' } : {}) } });
}
