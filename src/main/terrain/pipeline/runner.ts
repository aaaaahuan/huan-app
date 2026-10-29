import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerrainJobStatus } from '@shared/contracts/terrain';
import { directory, Progress, writeJson, writeBytes } from './state';
import { parseJobTrack, parseTrack } from './tracks';
import { prepareFeatures } from '../datasets';
import { buildTerrain } from '../geometry/terrain';
import { targetGrid } from '../datasets/grid';
import { exportTerrain } from './export';
import { loadFeatures, preservedModel } from '../config';
import { osmMasks } from '../geometry/osm';
import { houseGaps, placeHouses } from '../geometry/houses';
import { elevationScale, mergePrint } from '../geometry/scale';
import type { OsmDocument } from '../datasets/overpass';
import { surfaceLayers, featurePalette } from '../geometry/features';
import { packagePreview } from './preview';
import { fetchFile, type FetchFile } from '../datasets/network';

export async function runNative(root: string, job: string, state: TerrainJobStatus, fetch?: FetchFile) {
  const progress = new Progress(job, state);
  try {
    await directory(join(job, 'data'));
    const config = await loadFeatures(job), preserved = await preservedModel(job);
    fetch ??= fetchFile(config);
    const { network: _network, ...effective } = config; void _network;
    await progress.stage('parse', '校验并解析 KML/KMZ');
    const route = await parseJobTrack(job, state.input_file, state.filename);
    state.name = route.name;
    const warnings = [...route.warnings];
    state.warnings = warnings;
    await progress.detail(`${route.point_count} 个轨迹点、${route.photo_points.length} 个照片点；${route.date || '未提供日期'}`);
    await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings });
    await progress.stage('dem', '尝试获取 Copernicus DEM、WorldCover 与 OSM；失败记录警告');
    const datasets = await prepareFeatures(root, job, route.bounds_wgs84, warnings, fetch);
    const { rasters, ...availability } = datasets;
    await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings, datasets: availability });
    await progress.detail(Object.entries(availability).map(([key, available]) => `${key}：${available ? '已获取' : '不可用（见警告）'}`).join('；'));
    await progress.stage('terrain', '真实 DEM 目标网格与 Manifold 封闭实体');
    const { coordinates } = parseTrack(await readFile(join(job, 'data/route.kml')), state.filename);
    const routeElevations = coordinates.flatMap(p => p[2] === undefined ? [] : [p[2]]);
    const grid = await targetGrid(job, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', rasters.dem, rasters.worldcover, routeElevations, preserved);
    await progress.stage('features', 'OSM 拓扑、局部湖水位及互斥地表掩膜');
    const raw: OsmDocument = JSON.parse(await readFile(join(job, 'data/osm_features_raw.json'), 'utf8'));
    const masks = await osmMasks(raw, grid, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config);
    const houses = await houseGaps(job, grid, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config, route.photo_points, warnings);
    const layers = surfaceLayers(grid, coordinates, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config, masks, houses.gap);
    const previewMesh = await buildTerrain(grid, layers);
    await progress.stage('photos', '应用照片点人工判断，放置独立 pin 屋并校验路线净距');
    const houseLayer = await placeHouses(job, grid, layers, previewMesh, config, houses);
    await progress.stage('scale', '轨迹首尾记录海拔、侧壁自动布局及浮雕');
    // 非 preserve 分支与 Python 一致，优先选择南/东中 DEM 剖面面积较大的侧面。
    const southArea = grid.elevations.subarray(0, grid.width).reduce((a, b) => a + b, 0) / grid.width * grid.size[0];
    let eastArea = 0; for (let y = 0; y < grid.height; y++) eastArea += grid.elevations[y * grid.width + grid.width - 1];
    if (!preserved) config.elevation_scale.side = southArea >= eastArea / grid.height * grid.size[1] ? 'south' : 'east';
    const scaleLayer = await elevationScale(config.elevation_scale, grid, layers.base, routeElevations);
    const mesh = await mergePrint(previewMesh, [...houseLayer.meshes, ...(scaleLayer.mesh ? [scaleLayer.mesh] : [])]);
    await progress.stage('export', '导出地形 STL / 多材质 3MF 并校验');
    const validation = await exportTerrain(job, mesh, featurePalette(config));
    // 打印资产已落盘；预览/道路/聚落等 preview_only 失败只记警告，不回滚 completed。
    await progress.stage('preview', '封装原生 Viewer 网格与可切换地表图层');
    await directory(join(job, 'web'));
    try {
      await packagePreview(job, grid, previewMesh, layers, { route_info: route, warnings, validation, houses: houseLayer.report, features: layers.report, elevation_scale: scaleLayer.report, palette: featurePalette(config), configuration: { effective } }, { root, geographic: route.bounds_wgs84, projected: route.bounds_projected, zone: route.utm_zone, south: route.hemisphere === 'S', warnings, fetch }, scaleLayer.mesh, houseLayer.faceGap, houseLayer.meshes.length > 0);
    } catch (error) {
      const message = `预览封装失败：${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      state.warnings = warnings;
    }
    await writeBytes(join(job, 'web/index.html'), '<!doctype html><meta charset="utf-8"><title>原生地形核心</title><h1>DEM 地形与底座</h1><p>已包含路线、OSM 水系/林区/冰川、WorldCover 林/草/雪与海拔刻度；请在应用内查看可切换图层的三维预览。</p><a href="../models/terrain.stl">下载 STL</a> · <a href="../models/terrain.3mf">下载 3MF</a>');
    await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings, datasets: availability, model: { size_mm: 200, padding_m: 1100, base_mm: grid.base, vertical_exaggeration: grid.exaggeration }, native_core_only: false, configuration: effective });
    await progress.finish();
  } catch (error) { await progress.fail(error instanceof Error ? error.message : '原生流水线失败'); }
  return state;
}
