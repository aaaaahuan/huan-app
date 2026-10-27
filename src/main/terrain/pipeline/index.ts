import { randomBytes } from 'node:crypto';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { terrainUploadSchema, type TerrainJobStatus, type TerrainUpload } from '@shared/contracts/terrain';
import { readJobStatus, resolveJobFile, resolveJobPath } from '../assets';
import { directory, pendingStages, writeJson } from './state';
import { PIPELINE_PENDING } from './tracks';
import { runTerrainWorker } from './worker';

const active = new Set<string>();
function reset(state: TerrainJobStatus): TerrainJobStatus {
  const { finished_at: _finished, total_seconds: _total, updated_at: _updated, worker_pid: _pid, ...rest } = state;
  void _finished; void _total; void _updated; void _pid;
  const stages = pendingStages(); stages[0].detail = PIPELINE_PENDING;
  return { ...rest, status: 'queued', error: null, started_at: Date.now() / 1000, stages };
}
export async function createJob(root: string, input: TerrainUpload): Promise<TerrainJobStatus> {
  const { filename, content } = terrainUploadSchema.parse(input);
  const jobs = await directory(join(root, 'jobs'));
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const id = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${randomBytes(5).toString('hex')}`;
  const job = join(jobs, id);
  const inputFile = filename.toLowerCase().endsWith('.kmz') ? 'input.kmz' : 'input.kml';
  await mkdir(job);
  try {
    await mkdir(join(job, 'data'));
    await writeFile(join(job, inputFile), content, { flag: 'wx' });
    const state = reset({ id, filename: basename(filename.replaceAll('\\', '/')), input_file: inputFile, status: 'queued', started_at: 0, stages: [], preview_url: `/jobs/${id}/web/`, error: null, origin: 'native' });
    await writeJson(join(job, 'status.json'), state);
    active.add(job);
    try { return await runTerrainWorker(root, job, state); } finally { active.delete(job); }
  } catch (error) { await rm(job, { recursive: true, force: true }); throw error; }
}
export async function retryJob(root: string, id: string): Promise<TerrainJobStatus> {
  await directory(join(root, 'jobs'));
  const job = await resolveJobPath(root, id);
  if (active.has(job)) throw new Error('任务尚在运行');
  active.add(job);
  try {
    const old = await readJobStatus(root, id);
    // Python 的 ACTIVE 不与原生共享；遗留任务不在这里重试，避免两个调度器写同一作品。
    if (old.origin !== 'native') throw new Error('旧作品请在原预览中重试，原生流水线尚未迁移');
    await resolveJobFile(root, id, [old.input_file]);
    if ((await lstat(join(root, 'jobs', id))).isSymbolicLink()) throw new Error('不能写入链接作品目录');
    const attempts = await directory(join(job, 'attempts'));
    await writeJson(join(attempts, `${Date.now()}-${randomBytes(5).toString('hex')}.json`), old);
    const state = reset(old);
    await writeJson(join(job, 'status.json'), state);
    return await runTerrainWorker(root, job, state);
  } finally { active.delete(job); }
}
