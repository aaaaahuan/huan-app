import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { terrainFeatureStatusSchema, terrainJobIdSchema, terrainPrintParamsSchema, type TerrainDetail, type TerrainPrintModel, type TerrainPrintParams } from '@shared/contracts/terrain';
import { estimateTerrainPrint } from '@shared/terrain-print';
import { readJobStatus, resolveJobFile, resolveJobPath } from './assets';
import { getJob, optionalJson } from './library';
import { writeJson } from './pipeline/state';

async function json(root: string, id: string, parts: string[]) {
  return await optionalJson(root, id, parts, z.record(z.string(), z.unknown())) ?? {};
}
export async function getSummary(root: string, id: string): Promise<TerrainDetail> {
  const job = await getJob(root, id), meta = await json(root, id, ['web', 'metadata.json']);
  const spec = await json(root, id, ['spec.json']), validation = await json(root, id, ['models', 'validation.json']);
  const features = meta.feature_status ? terrainFeatureStatusSchema.parse(meta.feature_status) : {};
  if (!meta.feature_status) {
    const legacy = z.object({ available: z.record(z.string(), z.boolean()) }).optional().parse(meta.preview_layers);
    for (const [key, value] of Object.entries(legacy?.available ?? {})) if (value) features[key] = { state: 'present' };
  }
  const messages = new Map<string, number>();
  // 跨文件取同一原文出现次数的最大值，避免副本重复计数，又不丢失各文件独有警告。
  const originals = new Map<string, number>();
  for (const value of [job.warnings, spec.warnings, meta.warnings]) {
    const counts = new Map<string, number>();
    for (const warning of z.array(z.string()).catch([]).parse(value)) counts.set(warning, (counts.get(warning) ?? 0) + 1);
    for (const [warning, count] of counts) originals.set(warning, Math.max(originals.get(warning) ?? 0, count));
  }
  for (const [warning, count] of originals) {
    const message = /无附件|没有附件|缺少附件/.test(warning) ? '照片无附件' : warning;
    messages.set(message, (messages.get(message) ?? 0) + count);
  }
  const model = z.record(z.string(), z.unknown()).catch({}).parse(spec.model);
  const files = { stl: false, '3mf': false };
  for (const format of ['stl', '3mf'] as const) {
    try { await resolveJobFile(root, id, ['models', `terrain.${format}`]); files[format] = true; }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  return { job, features, warnings: [...messages].map(([message, count]) => ({ message, count })),
    metrics: { ...model, ...validation, volume_cm3: typeof validation.volume_mm3 === 'number' ? validation.volume_mm3 / 1000 : undefined,
      track_distance_km: z.record(z.string(), z.unknown()).catch({}).parse(meta.route_info).track_distance_km }, files };
}
export async function getPrintParams(root: string, id: string) {
  await readJobStatus(root, id);
  const savedParams = await optionalJson(root, id, ['print_params.json'], terrainPrintParamsSchema);
  const params = savedParams ?? { longEdge: 180, colors: 'four' as const, base: null };
  const grid = await json(root, id, ['data', 'grid.json']), validation = await json(root, id, ['models', 'validation.json']);
  const gridSchema = z.object({ bounds_projected: z.tuple([z.number(), z.number(), z.number(), z.number()]), elevation_range_m: z.tuple([z.number(), z.number()]), route_minimum_m: z.number().nullable().optional(), base: z.number().optional(), scale: z.number().positive().optional(), exaggeration: z.number().positive().optional() });
  const reportSchema = z.object({ dimensions_mm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]), volume_mm3: z.number().positive() });
  let model: TerrainPrintModel | null = null;
  if (Object.keys(grid).length && Object.keys(validation).length) {
    const g = gridSchema.parse(grid), v = reportSchema.parse(validation), b = g.bounds_projected;
    model = { extent: [b[2] - b[0], b[3] - b[1]], elevationRange: g.elevation_range_m, routeMinimum: g.route_minimum_m ?? (g.base && g.scale && g.exaggeration ? g.elevation_range_m[0] - Math.max(0, g.base - 4) / (g.scale * g.exaggeration) : null), dimensions: v.dimensions_mm, volume: v.volume_mm3 / 1000 };
  }
  return { params, model, saved: savedParams !== undefined };
}
export async function savePrintParams(root: string, id: string, params: TerrainPrintParams) {
  if (!(await lstat(join(root, 'jobs', id))).isDirectory()) throw new Error('作品目录不能是符号链接');
  const { model } = await getPrintParams(root, id);
  if (model && params.base !== null && params.base < estimateTerrainPrint(model, params).minimumBase) throw new Error('底座低于最小安全厚度，请使用自动底座');
  await writeJson(join(await resolveJobPath(root, id), 'print_params.json'), params);
}
export async function deleteJob(root: string, id: string) {
  terrainJobIdSchema.parse(id);
  // realpath 会消除链接信息，必须先逐级检查原始路径，防止 jobs 链接把删除引向外部。
  for (const path of [root, join(root, 'jobs'), join(root, 'jobs', id)]) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`无法删除作品：数据目录到作品目录之间不能包含符号链接（${path}）。`);
    if (!info.isDirectory()) throw new Error(`无法删除作品：路径不是普通目录（${path}）。`);
  }
  const status = await readJobStatus(root, id);
  if (status.status === 'queued' || status.status === 'running') throw new Error('请先取消任务再删除');
  await rm(await resolveJobPath(root, id), { recursive: true });
}
