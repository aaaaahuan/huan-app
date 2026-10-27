import { mkdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bounds } from '../pipeline/tracks';
import { writeJson } from '../pipeline/state';
import { fetchFile, type FetchFile } from './network';
import { clipRaster, geoTiles, type RasterClip } from './raster';
export async function loadTile(root: string, file: string, url: string, bounds: Bounds, timeout: number, fetch: FetchFile) {
  const cache = join(root, 'cache'); await mkdir(cache, { recursive: true }); const path = join(cache, file);
  if (!(await lstat(cache)).isDirectory()) throw new Error('缓存目录不能是符号链接');
  let hit = true;
  try { if (!(await lstat(path)).isFile()) throw new Error('缓存必须为普通文件'); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') hit = false; else throw error; }
  if (!hit) await fetch(url, path, timeout);
  try { return { clip: await clipRaster(path, bounds), cache_hit: hit }; }
  catch (error) { await rm(path, { force: true }); throw error; }
}
export async function prepareDem(root: string, job: string, bounds: Bounds, fetch = fetchFile()) {
  const clips: RasterClip[] = [], records: { tile: string; url: string; cache_hit: boolean }[] = [];
  for (const [lat, lon] of geoTiles(bounds, 1)) {
    const name = `Copernicus_DSM_COG_10_${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_00_${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
    const url = `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
    const result = await loadTile(root, `${name}.tif`, url, bounds, 300, fetch);
    if (!result.clip) throw new Error('DEM 瓦片未覆盖任务范围');
    if (clips.reduce((sum, c) => sum + c.values.length, 0) + result.clip.values.length > 20_000_000) throw new Error('DEM 总裁剪超过 2000 万像元');
    clips.push(result.clip); records.push({ tile: name, url, cache_hit: result.cache_hit });
  }
  const source = { dataset: 'Copernicus DEM GLO-30', license: 'Copernicus DEM terms', attribution: '© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018. Provided under COPERNICUS by the European Union and ESA; all rights reserved.', license_url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM', tiles: records, bounds_wgs84: bounds, available: true };
  await writeJson(join(job, 'data/dem_source.json'), source);
  return clips;
}
