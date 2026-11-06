import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerrainFeatureStatus, TerrainJobStatus } from '@shared/contracts/terrain';
import { directory, Progress, writeJson, writeBytes } from './state';
import { parseJobTrack, parseTrack } from './tracks';
import { prepareFeatures } from '../datasets';
import { buildTerrain } from '../geometry/terrain';
import { z } from 'zod';
import { terrainPrintParamsSchema } from '@shared/contracts/terrain';
import { targetGrid, regenerateGrid } from '../datasets/grid';
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
  const feature_status: TerrainFeatureStatus = Object.fromEntries(['dem', 'rivers', 'forest', 'grass', 'snow', 'track', 'roads', 'houses', 'photos', 'elevation_scale', 'places', 'settlements'].map(key => [key, { state: 'skipped' }]));
  try {
    await directory(join(job, 'data'));
    await directory(join(job, 'web'));
    // 重试期间清掉旧的要素状态，失败摘要不能沿用上一轮的成功结果。
    await writeJson(join(job, 'web/metadata.json'), { feature_status });
    const config = await loadFeatures(job), preserved = await preservedModel(job);
    const spec = z.object({ print_params: terrainPrintParamsSchema.optional(), datasets: z.object({ dem: z.boolean(), worldcover: z.boolean(), osm: z.boolean() }).optional() }).parse(JSON.parse(await readFile(join(job, 'spec.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{}'; throw error;
    })));
    const printParams = spec.print_params;
    fetch ??= fetchFile(config);
    const { network: _network, ...effective } = config; void _network;
    if (!printParams) await progress.stage('parse', '校验并解析 KML/KMZ');
    else for (const stage of state.stages.slice(0, 2)) Object.assign(stage, { status: 'done', elapsed_seconds: 0, detail: '复用已保存数据' });
    const route = printParams ? parseTrack(await readFile(join(job, 'data/source.kml')), state.filename).info : await parseJobTrack(job, state.input_file, state.filename);
    state.name = route.name;
    feature_status.track = { state: 'present', count: route.point_count, source: 'KML/KMZ' };
    const warnings = [...route.warnings];
    state.warnings = warnings;
    if (!printParams) {
      await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings });
      await progress.stage('dem', '获取地形数据');
    }
    const datasets = printParams ? null : await prepareFeatures(root, job, route.bounds_wgs84, warnings, fetch);
    const availability = datasets ? { dem: datasets.dem, worldcover: datasets.worldcover, osm: datasets.osm } : spec.datasets ?? { dem: true, worldcover: false, osm: false };
    await progress.stage('terrain', printParams ? '复用缓存网格，按已保存参数重新建模' : '真实 DEM 目标网格与 Manifold 封闭实体');
    const { coordinates } = parseTrack(await readFile(join(job, 'data/route.kml')), state.filename);
    const routeElevations = coordinates.flatMap(p => p[2] === undefined ? [] : [p[2]]);
    if (datasets) await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings, datasets: availability });
    const grid = datasets
      ? await targetGrid(job, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', datasets.rasters.dem, datasets.rasters.worldcover, routeElevations, preserved)
      : await regenerateGrid(job, printParams);
    feature_status.dem = { state: 'present', count: grid.width * grid.height, source: 'Copernicus DEM GLO-30' };
    await progress.stage('features', 'OSM 拓扑、局部湖水位及互斥地表掩膜');
    const raw: OsmDocument = JSON.parse(await readFile(join(job, 'data/osm_features_raw.json'), 'utf8'));
    const masks = await osmMasks(raw, grid, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config);
    const houses = await houseGaps(job, grid, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config, route.photo_points, warnings);
    const layers = surfaceLayers(grid, coordinates, route.bounds_projected, route.utm_zone, route.hemisphere === 'S', config, masks, houses.gap);
    for (const [key, id] of [['rivers', 1], ['forest', 2], ['grass', 5], ['snow', 3]] as const) {
      const count = layers.classes.filter(c => c === id).length;
      feature_status[key] = { state: !config[key].enabled ? 'skipped' : count ? 'present' : 'empty', count };
    }
    const previewMesh = await buildTerrain(grid, layers);
    await progress.stage('photos', '应用照片点人工判断，放置独立 pin 屋并校验路线净距');
    const houseLayer = await placeHouses(job, grid, layers, previewMesh, config, houses);
    feature_status.houses = { state: !config.houses.enabled ? 'skipped' : houseLayer.meshes.length ? 'present' : 'empty', count: houseLayer.meshes.length };
    await progress.stage('scale', '轨迹首尾记录海拔、侧壁自动布局及浮雕');
    // 非 preserve 分支与 Python 一致，优先选择南/东中 DEM 剖面面积较大的侧面。
    const southArea = grid.elevations.subarray(0, grid.width).reduce((a, b) => a + b, 0) / grid.width * grid.size[0];
    let eastArea = 0; for (let y = 0; y < grid.height; y++) eastArea += grid.elevations[y * grid.width + grid.width - 1];
    if (!preserved) config.elevation_scale.side = southArea >= eastArea / grid.height * grid.size[1] ? 'south' : 'east';
    const scaleLayer = await elevationScale(config.elevation_scale, grid, layers.base, routeElevations);
    feature_status.elevation_scale = { state: !config.elevation_scale.enabled ? 'skipped' : scaleLayer.mesh ? 'present' : 'empty', count: scaleLayer.mesh ? 1 : 0 };
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
      for (const key of ['roads', 'places', 'settlements']) feature_status[key] = { state: 'failed', error: message };
      await writeJson(join(job, 'web/metadata.json'), { feature_status, warnings, validation });
    }
    await writeBytes(join(job, 'web/index.html'), '<!doctype html><meta charset="utf-8"><title>原生地形核心</title><h1>DEM 地形与底座</h1><p>已包含路线、OSM 水系/林区/冰川、WorldCover 林/草/雪与海拔刻度；请在应用内查看可切换图层的三维预览。</p><a href="../models/terrain.stl">下载 STL</a> · <a href="../models/terrain.3mf">下载 3MF</a>');
    await writeJson(join(job, 'spec.json'), { preserve_imported_assets: !!preserved, ...(preserved ? { model: preserved } : {}), route, warnings, datasets: availability, model: { size_mm: Math.max(...grid.size), padding_m: 1100, base_mm: grid.base, vertical_exaggeration: grid.exaggeration }, ...(printParams ? { print_params: printParams } : {}), native_core_only: false, configuration: effective });
    await progress.finish();
  } catch (error) {
    const message = error instanceof Error ? error.message : '原生流水线失败';
    const stage = state.stages.find(stage => stage.status === 'running')?.key;
    const keys = stage === 'dem' || stage === 'terrain' ? ['dem'] : stage === 'features' ? ['rivers', 'forest', 'grass', 'snow'] : stage === 'photos' ? ['houses'] : stage === 'scale' ? ['elevation_scale'] : [];
    for (const key of keys) feature_status[key] = { state: 'failed', error: message };
    await writeJson(join(job, 'web/metadata.json'), { feature_status, warnings: state.warnings ?? [] });
    await progress.fail(message);
  }
  return state;
}
