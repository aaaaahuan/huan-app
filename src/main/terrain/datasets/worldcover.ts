import { join } from 'node:path';
import type { Bounds } from '../pipeline/tracks';
import { writeJson } from '../pipeline/state';
import { fetchFile } from './network';
import { loadTile } from './dem';
import { geoTiles, type RasterClip } from './raster';
export async function prepareWorldcover(root: string, job: string, bounds: Bounds, fetch = fetchFile()) {
  const clips: RasterClip[] = [], records: { tile: string; url: string; cache_hit: boolean }[] = [];
  for (const [lat, lon] of geoTiles(bounds, 3)) {
    const tile = `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}`;
    const file = `ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`, url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${file}`;
    const result = await loadTile(root, file, url, bounds, 180, fetch);
    if (!result.clip) throw new Error('WorldCover 瓦片未覆盖任务范围');
    if (clips.reduce((sum, c) => sum + c.values.length, 0) + result.clip.values.length > 20_000_000) throw new Error('WorldCover 总裁剪超过 2000 万像元');
    clips.push(result.clip); records.push({ tile, url, cache_hit: result.cache_hit });
  }
  await writeJson(join(job, 'data/worldcover_source.json'), { available: true, dataset: 'ESA WorldCover 10 m 2021 v200', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium', tiles: records, bounds_wgs84: bounds });
  return clips;
}
