import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { terrainPrintParamsSchema } from '@shared/contracts/terrain';
import { estimateTerrainPrint } from '@shared/terrain-print';
import proj4 from 'proj4';
import { join } from 'node:path';
import type { Bounds } from '../pipeline/tracks';
import type { HeightGrid } from '../geometry/terrain';
import { sampleRaster, type RasterClip } from './raster';
import { writeJson, writeBytes } from '../pipeline/state';

export async function targetGrid(job: string, bounds: Bounds, zone: number, south: boolean, dem: RasterClip[], worldcover: RasterClip[], routeElevations: number[] = [], preserved?: { base_mm: number; vertical_exaggeration: number }): Promise<HeightGrid> {
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
  const exaggeration = preserved?.vertical_exaggeration ?? Math.max(1, Math.min(2, 72 / Math.max((high - low) * scale, 0.01)));
  let routeMinimum = Infinity;
  for (const h of routeElevations) routeMinimum = Math.min(routeMinimum, h);
  const base = preserved?.base_mm ?? Math.max(4, 4 + Math.max(0, low - routeMinimum) * scale * exaggeration);
  const grid = { width, height, size, elevations, classes, scale, base, exaggeration };
  // 固定小端序和南→北行序，持久目标网格可独立重载，不依赖内存 TIFF 句柄。
  const bytes = Buffer.alloc(elevations.length * 4);
  elevations.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  await writeBytes(join(job, 'data/elevation.f32'), bytes);
  await writeBytes(join(job, 'data/worldcover.u8'), classes);
  await writeJson(join(job, 'data/grid.json'), { ...grid, elevations: 'elevation.f32', classes: 'worldcover.u8', bounds_projected: bounds, zone, south, row_order: 'south-to-north', byte_order: 'little-endian', missing_worldcover_cells: missingClasses, sampling: 'vertex-centered inverse UTM; strict bilinear DEM, nearest WorldCover; not GDAL area-weighted reprojection', route_minimum_m: Number.isFinite(routeMinimum) ? routeMinimum : null, elevation_range_m: [low, high] });
  return grid;
}

// 重建只改变模型坐标，继续使用已采样的 DEM/WorldCover，不再次请求数据源。
export async function regenerateGrid(job: string, input: unknown): Promise<HeightGrid> {
  const params = terrainPrintParamsSchema.parse(input);
  const meta = z.object({ width: z.number().int().min(2), height: z.number().int().min(2),
    bounds_projected: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    elevation_range_m: z.tuple([z.number(), z.number()]), route_minimum_m: z.number().nullable().optional(),
    base: z.number().positive().optional(), scale: z.number().positive().optional(), exaggeration: z.number().positive().optional()
  }).passthrough().parse(JSON.parse(await readFile(join(job, 'data/grid.json'), 'utf8')));
  const bytes = await readFile(join(job, 'data/elevation.f32'));
  const classes = await readFile(join(job, 'data/worldcover.u8'));
  const count = meta.width * meta.height;
  if (count > 500_000 || bytes.length !== count * 4 || classes.length !== count) throw new Error('缓存网格尺寸无效');
  const elevations = Float32Array.from({ length: count }, (_, i) => bytes.readFloatLE(i * 4));
  const b = meta.bounds_projected;
  const extent: [number, number] = [b[2] - b[0], b[3] - b[1]];
  if (!extent.every(v => Number.isFinite(v) && v > 0)) throw new Error('缓存网格范围无效');
  const estimate = estimateTerrainPrint({ extent, elevationRange: meta.elevation_range_m, routeMinimum: meta.route_minimum_m ?? (meta.base && meta.scale && meta.exaggeration ? meta.elevation_range_m[0] - Math.max(0, meta.base - 4) / (meta.scale * meta.exaggeration) : null), dimensions: [1, 1, 1], volume: 1 }, params);
  if (params.base !== null && params.base < estimate.minimumBase) throw new Error('底座低于最小安全厚度，请使用自动底座');
  const grid: HeightGrid = { width: meta.width, height: meta.height, elevations, classes,
    size: [estimate.x, estimate.y], scale: estimate.scale, base: estimate.base, exaggeration: estimate.exaggeration };
  await writeJson(join(job, 'data/grid.json'), { ...meta, ...grid, elevations: 'elevation.f32', classes: 'worldcover.u8' });
  return grid;
}
