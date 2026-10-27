import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerrainJobStatus } from '@shared/contracts/terrain';
import { directory, Progress, writeJson, writeBytes } from './state';
import { parseJobTrack, parseTrack } from './tracks';
import { prepareFeatures } from '../datasets';
import { buildTerrain } from '../geometry/terrain';
import { targetGrid } from '../datasets/grid';
import { exportTerrain } from './export';
import { surfaceLayers } from '../geometry/features';
import { packagePreview } from './preview';
import type { FetchFile } from '../datasets/network';

export async function runNative(root: string, job: string, state: TerrainJobStatus, fetch?: FetchFile) {
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
    const { coordinates } = parseTrack(await readFile(join(job, 'data/route.kml')), state.filename);
    const layers = surfaceLayers(grid, coordinates, route.bounds_projected, route.utm_zone, route.hemisphere === 'S');
    const mesh = await buildTerrain(grid, layers);
    warnings.push('本作品含路线及 WorldCover 林/草/雪；OSM 水系/林区/冰川、房屋及海拔刻度尚未迁移');
    await progress.stage('features', '已生成路线及 WorldCover 林区浮雕、草地与雪材质');
    await progress.stage('photos', '未实现照片与房屋');
    await progress.stage('scale', '未实现海拔刻度');
    await progress.stage('export', '导出地形 STL / 多材质 3MF 并校验');
    const validation = await exportTerrain(job, mesh);
    await progress.stage('preview', '封装原生 Viewer 网格与可切换地表图层');
    await directory(join(job, 'web'));
    await packagePreview(job, grid, mesh, layers, { route_info: route, warnings, validation }, { root, geographic: route.bounds_wgs84, projected: route.bounds_projected, zone: route.utm_zone, south: route.hemisphere === 'S', warnings, fetch });
    await writeBytes(join(job, 'web/index.html'), '<!doctype html><meta charset="utf-8"><title>原生地形核心</title><h1>DEM 地形与底座</h1><p>已包含路线与 WorldCover 林/草/雪；请在应用内查看可切换图层的三维预览。</p><a href="../models/terrain.stl">下载 STL</a> · <a href="../models/terrain.3mf">下载 3MF</a>');
    await writeJson(join(job, 'spec.json'), { route, warnings, datasets: availability, model: { size_mm: 200, padding_m: 1100, base_mm: grid.base, vertical_exaggeration: grid.exaggeration }, native_core_only: false });
    await progress.finish();
  } catch (error) { await progress.fail(error instanceof Error ? error.message : '原生流水线失败'); }
  return state;
}
