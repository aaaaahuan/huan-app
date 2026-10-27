import proj4 from 'proj4';
import { defaultFeatures, type FeatureConfig } from '../config';
import type { OsmMasks } from './osm';
import type { HeightGrid } from './terrain';
import type { Bounds, Coordinate } from '../pipeline/tracks';

export const palette = [
  { id: 0, name: 'Terrain / 地形', hex: '#C6CBB5' },
  { id: 1, name: 'Water / 河流与水体', hex: '#2389C9' },
  { id: 2, name: 'Tree cover / 林区', hex: '#24563B' },
  { id: 3, name: 'Snow and ice / 冰雪', hex: '#F5FAFF' },
  { id: 4, name: 'Hiking route / 徒步路线', hex: '#E94F39' },
  { id: 5, name: 'Grassland / 草地', hex: '#A2B96A' },
  { id: 6, name: 'House walls / 房屋白墙', hex: '#F7F7F2' },
  { id: 7, name: 'House pin and roof / 图钉粉顶', hex: '#F4A7B9' },
  { id: 8, name: 'Elevation scale / 海拔刻度', hex: '#39434B' }
];
export interface SurfaceLayers {
  base: Float32Array; classes: Uint8Array; distance: Float32Array;
  forest: Float32Array; water: Float32Array; z: Float32Array; report: Record<string, unknown>; routeGap: Uint8Array;
  distanceAt: (x: number, y: number) => number;
}
type Point = [number, number];
interface Node { point: Point; axis: number; left?: Node; right?: Node }
function tree(points: Point[], depth = 0): Node | undefined {
  if (!points.length) return;
  const axis = depth % 2, middle = Math.floor(points.length / 2);
  points.sort((a, b) => a[axis] - b[axis]);
  return { point: points[middle], axis, left: tree(points.slice(0, middle), depth + 1), right: tree(points.slice(middle + 1), depth + 1) };
}
// 与 scipy cKDTree 相同，查询加密样本的欧氏距离，而非栅格化路线的距离变换。
function nearest(root: Node, x: number, y: number) {
  let best = Infinity;
  function visit(node?: Node) {
    if (!node) return;
    best = Math.min(best, (x - node.point[0]) ** 2 + (y - node.point[1]) ** 2);
    const delta = (node.axis === 0 ? x : y) - node.point[node.axis];
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta < best) visit(delta < 0 ? node.right : node.left);
  }
  visit(root); return Math.sqrt(best);
}
export function surfaceLayers(grid: HeightGrid, coordinates: Coordinate[], bounds: Bounds, zone: number, south: boolean, cfg: FeatureConfig = defaultFeatures, osm?: OsmMasks, routeGap = new Uint8Array(grid.width * grid.height)): SurfaceLayers {
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const route: Point[] = coordinates.map(p => { const xy = projection.forward(p); return [(xy[0] - bounds[0]) * grid.scale, (xy[1] - bounds[1]) * grid.scale]; });
  const dense: Point[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .06));
    if (dense.length + n > 2_000_000) throw new Error('路线加密样本超过安全上限');
    for (let j = 0; j < n; j++) dense.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  dense.push(route[route.length - 1]);
  const root = tree(dense); if (!root) throw new Error('缺少路线样本');
  const distanceAt = (x: number, y: number) => nearest(root, x, y);
  const count = grid.width * grid.height, base = new Float32Array(count), classes = new Uint8Array(count), distance = new Float32Array(count), forest = new Float32Array(count), z = new Float32Array(count);
  let minimum = Infinity; for (const h of grid.elevations) minimum = Math.min(minimum, h);
  if (!cfg.houses.enabled) routeGap = new Uint8Array(count);
  const water = new Float32Array(count), river = osm?.river ?? new Uint8Array(count), lake = new Uint8Array(count);
  const levels: { vertices: number; level_mm: number; span_mm: number }[] = [];
  for (let i = 0; i < count; i++) base[i] = grid.base + (grid.elevations[i] - minimum) * grid.scale * grid.exaggeration;
  for (let i = 0; i < count; i++) if (river[i]) water[i] = -cfg.rivers.depth_mm;
  for (const indices of osm?.lakes ?? []) {
    const values: number[] = [];
    for (const i of indices) values.push(base[i]);
    if (!values.length) continue;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2), median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    const level = Math.max(.8, median - cfg.rivers.depth_mm);
    for (const i of indices) { lake[i] = 1; water[i] = level - base[i]; }
    levels.push({ vertices: values.length, level_mm: level, span_mm: 0 });
  }
  // 先按来源建立互斥类别；关闭水体时恢复普通地形，不露出被水覆盖的林/雪分类。
  for (let i = 0; i < count; i++) {
    const x = i % grid.width * grid.size[0] / (grid.width - 1), y = Math.floor(i / grid.width) * grid.size[1] / (grid.height - 1), wc = grid.classes?.[i];
    const id = river[i] || lake[i] ? 1 : wc === 70 || osm?.snow[i] ? 3 : wc === 10 || osm?.forest[i] ? 2 : wc === 30 ? 5 : 0;
    classes[i] = (id === 1 ? cfg.rivers.enabled : id === 2 ? cfg.forest.enabled : id === 3 ? cfg.snow.enabled : id === 5 ? cfg.grass.enabled : true) ? id : 0;
    if (classes[i] === 2) forest[i] = cfg.forest.raise_mm + cfg.forest.texture_mm * (.5 + .25 * Math.sin(x * 2 * Math.PI / 1.6) * Math.cos(y * 2 * Math.PI / 1.4) + .25 * Math.sin((x + y) * 2 * Math.PI / 2.3));
    if (!cfg.rivers.enabled) water[i] = 0;
    distance[i] = distanceAt(x, y);
    z[i] = composeHeight(base[i], classes[i], forest[i], water[i], 0, distance[i], cfg, !!routeGap[i]).z;
  }
  return { base, classes, distance, forest, water, z, routeGap, distanceAt, report: { ...osm?.report, lake_levels: cfg.rivers.enabled ? levels : [], river_depth_mm: cfg.rivers.enabled ? cfg.rivers.depth_mm : null, mask_vertices: { river: cfg.rivers.enabled ? river.reduce((a, b) => a + b, 0) : 0, lake: cfg.rivers.enabled ? lake.reduce((a, b) => a + b, 0) : 0, forest: classes.filter(c => c === 2).length, grass: classes.filter(c => c === 5).length, snow: classes.filter(c => c === 3).length }, mask_priority: 'water > snow > forest > grass; route over max(base, surface)' } };
}

// feature_engine.compose 的逐顶点语义；独立 pin 房屋调用时 houseTop=0，圆缺口只抑制路线。
export function composeHeight(base: number, sourceClass: number, forest: number, water: number, houseTop: number, distance: number, cfg: FeatureConfig, routeGap = false) {
  let surface = base, category = 0;
  if (cfg.forest.enabled) { surface += forest; if (sourceClass === 2) category = 2; }
  if (cfg.rivers.enabled && sourceClass === 1) { surface = base + water; category = 1; }
  if (cfg.grass.enabled && sourceClass === 5) category = 5;
  if (cfg.snow.enabled && sourceClass === 3) category = 3;
  if (cfg.houses.enabled && houseTop > 0) { surface = Math.max(surface, houseTop); category = 6; }
  const gap = cfg.houses.enabled && routeGap, weight = gap ? 0 : Math.max(0, Math.min(1, (.85 - distance) / .13));
  const z = surface + weight * (Math.max(base, surface) - surface + .8);
  if (distance < .72 && !gap) category = 4;
  if (!Number.isFinite(z) || z <= .8) throw new Error('地表组合后的高度无效');
  return { z, category, surface };
}

export function featurePalette(cfg: FeatureConfig) {
  return palette.map(p => ({ ...p, hex: p.id === 7 ? cfg.houses.pin_color : p.id === 8 ? cfg.elevation_scale.color : p.hex }));
}
