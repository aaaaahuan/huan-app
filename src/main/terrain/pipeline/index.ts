import { randomBytes } from 'node:crypto';
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { terrainUploadSchema, type TerrainJobStatus, type TerrainUpload } from '@shared/contracts/terrain';
import { readJobStatus, resolveJobFile, resolveJobPath } from '../assets';
import { pendingStages, Progress, writeJson, writeBytes } from './state';
import { PIPELINE_PENDING, parseJobTrack } from './tracks';
import { prepareFeatures } from '../datasets';
import { buildTerrain } from '../geometry/terrain';
import { targetGrid } from '../datasets/grid';
import { exportTerrain } from './export';
import type { FetchFile } from '../datasets/network';

const active = new Set<string>();
// 写入目录拒绝符号链接，不能沿用只读资源解析的目录内链接容忍策略。
async function directory(path: string) {
  await mkdir(path, { recursive: true });
  if (!(await lstat(path)).isDirectory()) throw new Error('写入目录不能是符号链接');
  return realpath(path);
}
function reset(state: TerrainJobStatus): TerrainJobStatus {
  const { finished_at: _finished, total_seconds: _total, updated_at: _updated, worker_pid: _pid, ...rest } = state;
  void _finished; void _total; void _updated; void _pid;
  const stages = pendingStages(); stages[0].detail = PIPELINE_PENDING;
  return { ...rest, status: 'queued', error: null, started_at: Date.now() / 1000, stages };
}
async function runNative(root: string, job: string, state: TerrainJobStatus, fetch?: FetchFile) {
  const progress = new Progress(job, state);
  try {
    await directory(join(job, 'data'));
    await progress.stage('parse', '校验并解析 KML/KMZ');
    const route = await parseJobTrack(job, state.input_file, state.filename);
    state.name = route.name;
    const warnings = [...route.warnings];
    state.warnings = warnings;
    await progress.detail(`${route.point_count} 个轨迹点、${route.photo_points.length} 个照片点；${route.date || '未提供日期'}`);
    await writeJson(join(job, 'spec.json'), { route, warnings });
    await progress.stage('dem', '尝试获取 Copernicus DEM、WorldCover 与 OSM；失败记录警告');
    const datasets = await prepareFeatures(root, job, route.bounds_wgs84, warnings, fetch);
    const { rasters, ...availability } = datasets;
    await writeJson(join(job, 'spec.json'), { route, warnings, datasets: availability });
    await progress.detail(Object.entries(availability).map(([key, available]) => `${key}：${available ? '已获取' : '不可用（见警告）'}`).join('；'));
    await progress.stage('terrain', '真实 DEM 目标网格与 Manifold 封闭实体');
    const grid = await targetGrid(job, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', rasters.dem, rasters.worldcover);
    const mesh = await buildTerrain(grid);
    warnings.push('本作品仅包含真实 DEM 与底座；路线、地表浮雕、房屋、海拔刻度及 Three 预览尚未迁移');
    await progress.stage('features', '未实现地表浮雕；不将分类数据冒充实体');
    await progress.stage('photos', '未实现照片与房屋');
    await progress.stage('scale', '未实现海拔刻度');
    await progress.stage('export', '导出 DEM 核心 STL / 单材质 3MF 并校验');
    const validation = await exportTerrain(job, mesh);
    await progress.stage('preview', '仅封装下载页；原生 Three viewer 留待 Phase 6');
    await directory(join(job, 'web'));
    await writeJson(join(job, 'web/metadata.json'), { route_info: route, warnings, validation, native_core_only: true });
    await writeBytes(join(job, 'web/index.html'), '<!doctype html><meta charset="utf-8"><title>原生地形核心</title><h1>DEM 地形与底座</h1><p>路线、地表、房屋、刻度及三维预览尚未实现。</p><a href="../models/terrain.stl">下载 STL</a> · <a href="../models/terrain.3mf">下载 3MF</a>');
    await writeJson(join(job, 'spec.json'), { route, warnings, datasets: availability, model: { size_mm: 200, padding_m: 1100, base_mm: grid.base, vertical_exaggeration: grid.exaggeration }, native_core_only: true });
    await progress.finish();
  } catch (error) { await progress.fail(error instanceof Error ? error.message : '原生流水线失败'); }
  return state;
}
export async function createJob(root: string, input: TerrainUpload, fetch?: FetchFile): Promise<TerrainJobStatus> {
  const { filename, content } = terrainUploadSchema.parse(input);
  const jobs = await directory(join(root, 'jobs'));
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const id = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${randomBytes(5).toString('hex')}`;
  const job = join(jobs, id);
  const inputFile = filename.toLowerCase().endsWith('.kmz') ? 'input.kmz' : 'input.kml';
  await mkdir(job);
  try {
    await mkdir(join(job, 'data'));
    await writeFile(join(job, inputFile), content, { flag: 'wx' });
    const state = reset({ id, filename: basename(filename.replaceAll('\\', '/')), input_file: inputFile, status: 'queued', started_at: 0, stages: [], preview_url: `/jobs/${id}/web/`, error: null, origin: 'native' });
    await writeJson(join(job, 'status.json'), state);
    active.add(job);
    try { return await runNative(root, job, state, fetch); } finally { active.delete(job); }
  } catch (error) { await rm(job, { recursive: true, force: true }); throw error; }
}
export async function retryJob(root: string, id: string, fetch?: FetchFile): Promise<TerrainJobStatus> {
  await directory(join(root, 'jobs'));
  const job = await resolveJobPath(root, id);
  if (active.has(job)) throw new Error('任务尚在运行');
  active.add(job);
  try {
    const old = await readJobStatus(root, id);
    // Python 的 ACTIVE 不与原生共享；遗留任务不在这里重试，避免两个调度器写同一作品。
    if (old.origin !== 'native') throw new Error('旧作品请在原预览中重试，原生流水线尚未迁移');
    await resolveJobFile(root, id, [old.input_file]);
    if ((await lstat(join(root, 'jobs', id))).isSymbolicLink()) throw new Error('不能写入链接作品目录');
    const attempts = await directory(join(job, 'attempts'));
    await writeJson(join(attempts, `${Date.now()}-${randomBytes(5).toString('hex')}.json`), old);
    const state = reset(old);
    await writeJson(join(job, 'status.json'), state);
    return await runNative(root, job, state, fetch);
  } finally { active.delete(job); }
}
