import { join } from 'node:path';
import type { Bounds } from '../pipeline/tracks';
import { writeJson } from '../pipeline/state';
import { prepareDem } from './dem';
import { prepareWorldcover } from './worldcover';
import { overpass } from './overpass';
import { fetchFile, type FetchFile } from './network';
export async function prepareFeatures(root: string, job: string, bounds: Bounds, warnings: string[], fetch: FetchFile = fetchFile()) {
  const result = { dem: false, worldcover: false, osm: false };
  for (const [key, label, prepare] of [
    ['dem', 'DEM', () => prepareDem(root, job, bounds, fetch)],
    ['worldcover', 'WorldCover', () => prepareWorldcover(root, job, bounds, fetch)],
    ['osm', 'OSM', async () => {
      const { doc, source } = await overpass(root, bounds, 'natural', fetch);
      await writeJson(join(job, 'data/osm_features_raw.json'), doc);
      await writeJson(join(job, 'data/osm_source.json'), { ...source, available: true, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', license_url: 'https://www.openstreetmap.org/copyright' });
    }]
  ] as const) {
    try { await prepare(); result[key] = true; }
    catch (error) {
      const message = `${label} 获取失败：${error instanceof Error ? error.message : '未知错误'}`; warnings.push(message);
      const provenance = key === 'dem'
        ? { dataset: 'Copernicus DEM GLO-30', license: 'Copernicus DEM terms', attribution: '© DLR e.V. / Airbus Defence and Space; provided under COPERNICUS' }
        : key === 'worldcover'
          ? { dataset: 'ESA WorldCover 10 m 2021 v200', license: 'CC BY 4.0', attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)' }
          : { dataset: 'OpenStreetMap', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' };
      await writeJson(join(job, `data/${key}_source.json`), { ...provenance, available: false, error: message });
      if (key === 'osm') await writeJson(join(job, 'data/osm_features_raw.json'), { elements: [] });
    }
  }
  await writeJson(join(job, 'data/datasets.json'), { ...result, warnings, raster_output: '缓存 TIFF 与内存裁剪已实现；任务 TIFF mosaic / GDAL 重投影 parity 待实现' });
  return result;
}
