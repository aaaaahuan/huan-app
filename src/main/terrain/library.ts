import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { terrainJobSummarySchema, terrainMetadataSchema, terrainPhotoHousesSchema, type TerrainJobList } from '@shared/contracts/terrain';
import { readJobStatus, resolveJobFile } from './assets';

async function optionalJson<T>(root: string, id: string, parts: string[], schema: z.ZodType<T>): Promise<T | undefined> {
  try { return schema.parse(JSON.parse(await readFile(await resolveJobFile(root, id, parts), 'utf8'))); }
  catch (error) {
    // 可选旧数据缺失、损坏或不符合结构时使用 summary 默认值；访问权限等错误须反馈。
    if (error instanceof SyntaxError || error instanceof z.ZodError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) return undefined;
    throw error;
  }
}

export async function getJob(dataRoot: string, id: string) {
  const status = await readJobStatus(dataRoot, id);
  const meta = await optionalJson(dataRoot, id, ['web', 'metadata.json'], terrainMetadataSchema);
  const houses = await optionalJson(dataRoot, id, ['data', 'photo_houses.json'], terrainPhotoHousesSchema);
  return terrainJobSummarySchema.parse({
    ...status,
    name: status.name || meta?.route_info?.name || status.filename,
    date: meta?.route_info?.date ?? '',
    photo_count: meta?.photos?.total ?? 0,
    house_count: meta?.houses?.placed_points?.length ?? 0,
    uncertain_houses: houses?.points?.filter(point => point.has_house === 'uncertain').length ?? 0,
    ...(houses && Object.keys(houses).length > 0 ? { house_method: houses.method ?? null } : {})
  });
}

export async function listJobs(dataRoot: string): Promise<TerrainJobList> {
  let entries;
  try { entries = await readdir(join(dataRoot, 'jobs'), { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { jobs: [], diagnostics: [] };
    throw error;
  }
  const result: TerrainJobList = { jobs: [], diagnostics: [] };
  for (const entry of entries.sort((a, b) => a.name < b.name ? 1 : a.name > b.name ? -1 : 0)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try { result.jobs.push(await getJob(dataRoot, entry.name)); }
    catch (error) { result.diagnostics.push({ id: entry.name, message: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
