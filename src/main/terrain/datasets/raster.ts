import { fromFile } from 'geotiff';
import type { Bounds } from '../pipeline/tracks';
export interface RasterClip { width: number; height: number; origin: [number, number]; resolution: [number, number]; nodata: number | null; values: Float64Array }
export async function clipRaster(path: string, bounds: Bounds): Promise<RasterClip | null> {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(), keys = image.getGeoKeys();
    if (keys?.GeographicTypeGeoKey !== 4326 || keys.ProjectedCSTypeGeoKey) throw new Error('栅格瓦片 CRS 不是 EPSG:4326');
    const [rx, ry] = image.getResolution();
    const origin = image.getOrigin();
    // Copernicus 为 PixelIsPoint；按 GDAL RFC 33 将 tiepoint 中心转为像元外缘。
    const shift = keys.GTRasterTypeGeoKey === 2 ? 0.5 : 0;
    const ox = origin[0] - rx * shift, oy = origin[1] - ry * shift;
    if (!(rx > 0 && ry < 0)) throw new Error('栅格方向不受支持');
    const [w, s, e, n] = bounds;
    const x0 = Math.max(0, Math.floor((w - ox) / rx) - 2), x1 = Math.min(image.getWidth(), Math.ceil((e - ox) / rx) + 2);
    const y0 = Math.max(0, Math.floor((n - oy) / ry) - 2), y1 = Math.min(image.getHeight(), Math.ceil((s - oy) / ry) + 2);
    if (x0 >= x1 || y0 >= y1) return null;
    if ((x1 - x0) * (y1 - y0) > 20_000_000) throw new Error('栅格裁剪超过 2000 万像元');
    const values = await image.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true });
    return { width: x1 - x0, height: y1 - y0, origin: [ox + x0 * rx, oy + y0 * ry], resolution: [rx, ry], nodata: image.getGDALNoData(), values: Float64Array.from(values) };
  } finally { await tiff.close(); }
}
export function sampleRaster(clips: RasterClip[], lon: number, lat: number, method: 'nearest' | 'bilinear'): number | null {
  // 像元坐标以中心为原点；跨瓦片邻点逐个查找，缺失/NODATA 不填造数值。
  const at = (x: number, y: number): number | null => {
    for (const c of clips) {
      const col = Math.floor((x - c.origin[0]) / c.resolution[0]), row = Math.floor((y - c.origin[1]) / c.resolution[1]);
      if (col < 0 || row < 0 || col >= c.width || row >= c.height) continue;
      const value = c.values[row * c.width + col];
      return Number.isFinite(value) && value !== c.nodata ? value : null;
    }
    return null;
  };
  if (method === 'nearest') return at(lon, lat);
  const c = clips.find(c => lon >= c.origin[0] && lon < c.origin[0] + c.width * c.resolution[0] && lat <= c.origin[1] && lat > c.origin[1] + c.height * c.resolution[1]);
  if (!c) return null;
  const x = (lon - c.origin[0]) / c.resolution[0] - 0.5, y = (lat - c.origin[1]) / c.resolution[1] - 0.5, ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
  let result = 0;
  for (const [col, row, weight] of [[ix, iy, (1 - dx) * (1 - dy)], [ix + 1, iy, dx * (1 - dy)], [ix, iy + 1, (1 - dx) * dy], [ix + 1, iy + 1, dx * dy]]) {
    if (weight < 1e-12) continue;
    const value = at(c.origin[0] + (col + 0.5) * c.resolution[0], c.origin[1] + (row + 0.5) * c.resolution[1]);
    if (value === null) return null;
    result += weight * value;
  }
  return result;
}
export function geoTiles(bounds: Bounds, step: number) {
  const [w, s, e, n] = bounds;
  if (![w, s, e, n].every(Number.isFinite) || w > e || s > n || w < -180 || e > 180 || s < -90 || n > 90) throw new Error('数据范围无效');
  const tiles: [number, number][] = [];
  for (let lat = Math.floor(s / step) * step; lat <= Math.floor(n / step) * step; lat += step) for (let lon = Math.floor(w / step) * step; lon <= Math.floor(e / step) * step; lon += step) { tiles.push([lat, lon]); if (tiles.length > 16) throw new Error('数据瓦片超过本地限制 16；请裁剪轨迹'); }
  return tiles;
}
