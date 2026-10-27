import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { terrainUploadSchema, type TerrainJobStatus, type TerrainUpload } from '@shared/contracts/terrain';
import { readJobStatus, resolveJobFile, resolveJobPath } from '../assets';
import { directory, pendingStages, Progress, writeJson } from './state';
import { PIPELINE_PENDING } from './tracks';
import { runTerrainWorker } from './worker';

interface Task { root: string; job: string; state: TerrainJobStatus; controller: AbortController; done?: Promise<void> }
const active = new Map<string, Task>();
const queue: Task[] = [];
const preparing = new Set<string>();
const failures = new Map<string, Error>();
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const task = queue.shift()!;
    running++;
    task.done = runTerrainWorker(task.root, task.job, task.state, task.controller.signal)
      .then(() => undefined).catch(error => {
        const failure = error instanceof Error ? error : new Error(String(error));
        failures.set(task.job, failure); throw failure;
      })
      .finally(() => { active.delete(task.job); running--; pump(); });
    void task.done.catch(error => { console.error('地形任务状态保存失败', error); });
  }
}
function enqueue(root: string, job: string, state: TerrainJobStatus) {
  const task = { root, job, state, controller: new AbortController() };
  failures.delete(job); active.set(job, task); queue.push(task); pump();
}
// 后台落盘失败不能仅记日志而让 getJob 永远显示 running。
export async function assertJobProgress(root: string, id: string) {
  const failure = failures.get(await resolveJobPath(root, id));
  if (failure) throw new Error(`任务状态保存失败：${failure.message}`);
}
export async function cancelJob(root: string, id: string, reason = '任务已取消，可重试') {
  const job = await resolveJobPath(root, id), task = active.get(job);
  if (!task) throw new Error('任务当前未在队列中');
  if (task.done) { task.controller.abort(reason); await task.done; }
  else {
    const i = queue.indexOf(task);
    if (i >= 0) queue.splice(i, 1);
    try { await new Progress(job, task.state).fail(reason); } finally { active.delete(job); }
  }
  return readJobStatus(root, id);
}
export async function stopJobs(root?: string, reason = '应用退出，任务已中断，可重试') {
  // 先移除所有排队任务，防止线程结束时 pump 启动待中止的任务。
  const tasks = [...active.values()].filter(task => !root || task.root === root);
  for (const task of tasks) {
    if (task.done) continue;
    const i = queue.indexOf(task);
    if (i >= 0) queue.splice(i, 1);
  }
  await Promise.all(tasks.map(async task => {
    if (task.done) { task.controller.abort(reason); await task.done; }
    else { try { await new Progress(task.job, task.state).fail(reason); } finally { active.delete(task.job); } }
  }));
}
export async function recoverJobs(root: string) {
  let entries;
  try { entries = await readdir(join(root, 'jobs'), { withFileTypes: true }); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const job = await resolveJobPath(root, entry.name);
      const state = await readJobStatus(root, entry.name);
      if (state.origin === 'native' && ['queued', 'running'].includes(state.status) && !active.has(job) && !preparing.has(job))
        await new Progress(job, state).fail('上次运行中断，请重试');
    } catch (error) { console.error('地形任务恢复失败', entry.name, error); }
  }
}
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
    enqueue(root, job, state);
    return state;
  } catch (error) { await rm(job, { recursive: true, force: true }); throw error; }
}
export async function retryJob(root: string, id: string): Promise<TerrainJobStatus> {
  await directory(join(root, 'jobs'));
  const job = await resolveJobPath(root, id);
  if (active.has(job) || preparing.has(job)) throw new Error('任务尚在运行');
  // 在第一次异步读取之前持有同 job 锁。
  preparing.add(job);
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
    enqueue(root, job, state);
    return state;
  } finally { preparing.delete(job); }
}
