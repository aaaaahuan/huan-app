import proj4 from 'proj4';
import type { HeightGrid } from './terrain';
import type { Bounds, Coordinate } from '../pipeline/tracks';

export const palette = [
  { id: 0, name: 'Terrain / 地形', hex: '#C6CBB5' },
  { id: 1, name: 'Water / 河流与水体', hex: '#2389C9' },
  { id: 2, name: 'Tree cover / 林区', hex: '#24563B' },
  { id: 3, name: 'Snow and ice / 冰雪', hex: '#F5FAFF' },
  { id: 4, name: 'Hiking route / 徒步路线', hex: '#E94F39' },
  { id: 5, name: 'Grassland / 草地', hex: '#A2B96A' }
];
export interface SurfaceLayers {
  base: Float32Array; classes: Uint8Array; distance: Float32Array;
  forest: Float32Array; z: Float32Array;
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
export function surfaceLayers(grid: HeightGrid, coordinates: Coordinate[], bounds: Bounds, zone: number, south: boolean): SurfaceLayers {
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
  for (let i = 0; i < count; i++) {
    const x = i % grid.width * grid.size[0] / (grid.width - 1), y = Math.floor(i / grid.width) * grid.size[1] / (grid.height - 1);
    base[i] = grid.base + (grid.elevations[i] - minimum) * grid.scale * grid.exaggeration;
    const wc = grid.classes?.[i]; classes[i] = wc === 10 ? 2 : wc === 30 ? 5 : wc === 70 ? 3 : 0;
    // features.json 默认值；草地与雪只改变材质，林区为符号化纹理。
    if (classes[i] === 2) forest[i] = .32 + .12 * (.5 + .25 * Math.sin(x * 2 * Math.PI / 1.6) * Math.cos(y * 2 * Math.PI / 1.4) + .25 * Math.sin((x + y) * 2 * Math.PI / 2.3));
    distance[i] = distanceAt(x, y);
    z[i] = base[i] + forest[i] + Math.max(0, Math.min(1, (.85 - distance[i]) / .13)) * .8;
  }
  return { base, classes, distance, forest, z, distanceAt };
}
