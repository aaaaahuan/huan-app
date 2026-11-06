import type { TerrainPrintModel, TerrainPrintParams } from './contracts/terrain';

// 按地形高差与轨迹最低点计算夸张和安全底座，再适配打印高度。
function estimateDimensions(model: TerrainPrintModel, params: TerrainPrintParams) {
  const scale = Math.min(240, params.longEdge) / Math.max(...model.extent);
  const relief = (model.elevationRange[1] - model.elevationRange[0]) * scale;
  let exaggeration = Math.max(1, Math.min(2, 72 / Math.max(relief, .01)));
  const deficit = Math.max(0, model.elevationRange[0] - (model.routeMinimum ?? model.elevationRange[0])) * scale;
  const initialHeight = Math.max(params.base ?? 4, 4 + deficit * exaggeration) + relief * exaggeration;
  if (initialHeight > 254) exaggeration = Math.max(0, Math.min(exaggeration, (254 - Math.max(4, params.base ?? 4)) / Math.max(relief + deficit, .01)));
  const minimumBase = Math.ceil(Math.max(4, 4 + deficit * exaggeration) * 5) / 5;
  const base = Math.max(minimumBase, params.base ?? minimumBase);
  // 向上取层高可能因浮点误差多出一层，取整后仍须限制在打印高度内。
  const height = Math.min(254, Math.ceil((base + relief * exaggeration) * 5) / 5);
  return { scale, denominator: 1000 / scale, exaggeration, minimumBase, base, height,
    x: model.extent[0] * scale, y: model.extent[1] * scale, compressed: initialHeight > 254 };
}

function estimateVolume(model: TerrainPrintModel, params: TerrainPrintParams, height: number) {
  const ratio = Math.min(240, params.longEdge) / Math.max(model.dimensions[0], model.dimensions[1]);
  return model.volume * ratio ** 2 * height / model.dimensions[2];
}

// A1 + AMS lite 的估算常量；切片器仍是耗材与时长的最终依据。
function estimateMaterials(volume: number, height: number, colors: TerrainPrintParams['colors']) {
  const layers = Math.round(height / .2), changes = colors === 'four' ? Math.round(layers * 1.2) : 0;
  const purge = changes * .6, tower = colors === 'four' ? .15 * height : 0;
  const grams = volume * 1.24 * (.22 + .78 * .15);
  const hours = (volume * 1000 / 5 + changes * 15) / 3600;
  return { grams, layers, changes, purge, tower, hours };
}

export function estimateTerrainPrint(model: TerrainPrintModel, params: TerrainPrintParams) {
  const dimensions = estimateDimensions(model, params);
  const volume = estimateVolume(model, params, dimensions.height);
  return { ...dimensions, volume, ...estimateMaterials(volume, dimensions.height, params.colors) };
}
