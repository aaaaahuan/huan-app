import proj4 from 'proj4';
import { join } from 'node:path';
import type { Bounds } from '../pipeline/tracks';
import type { HeightGrid } from '../geometry/terrain';
import { sampleRaster, type RasterClip } from './raster';
import { writeJson, writeBytes } from '../pipeline/state';

export async function targetGrid(job: string, bounds: Bounds, zone: number, south: boolean, dem: RasterClip[], worldcover: RasterClip[]): Promise<HeightGrid> {
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const extent = [bounds[2] - bounds[0], bounds[3] - bounds[1]], scale = 200 / Math.max(...extent);
  const size: [number, number] = [extent[0] * scale, extent[1] * scale];
  const width = Math.ceil(size[0] / 0.32) + 1, height = Math.ceil(size[1] / 0.32) + 1;
  const elevations = new Float32Array(width * height), classes = new Uint8Array(width * height);
  let low = Infinity, high = -Infinity, missingClasses = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [lon, lat] = projection.inverse([bounds[0] + extent[0] * x / (width - 1), bounds[1] + extent[1] * y / (height - 1)]);
    const h = sampleRaster(dem, lon, lat, 'bilinear'), c = sampleRaster(worldcover, lon, lat, 'nearest');
    if (h === null) throw new Error('DEM 未完整覆盖目标网格；无法构建真实地形');
    const i = y * width + x; elevations[i] = h; classes[i] = c ?? 0;
    if (c === null) missingClasses++;
    low = Math.min(low, elevations[i]); high = Math.max(high, elevations[i]);
  }
  const exaggeration = Math.max(1, Math.min(2, 72 / Math.max((high - low) * scale, 0.01)));
  const grid = { width, height, size, elevations, classes, scale, base: 4, exaggeration };
  // 固定小端序和南→北行序，持久目标网格可独立重载，不依赖内存 TIFF 句柄。
  const bytes = Buffer.alloc(elevations.length * 4);
  elevations.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  await writeBytes(join(job, 'data/elevation.f32'), bytes);
  await writeBytes(join(job, 'data/worldcover.u8'), classes);
  await writeJson(join(job, 'data/grid.json'), { ...grid, elevations: 'elevation.f32', classes: 'worldcover.u8', bounds_projected: bounds, zone, south, row_order: 'south-to-north', byte_order: 'little-endian', missing_worldcover_cells: missingClasses, sampling: 'vertex-centered inverse UTM; strict bilinear DEM, nearest WorldCover; not GDAL area-weighted reprojection', elevation_range_m: [low, high] });
  return grid;
}
