import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerrainJobStatus } from '@shared/contracts/terrain';
import { terrainJobStatusSchema } from '@shared/contracts/terrain';
import { Progress } from './state';

// 生产入口与开发构建共用固定产物位置；任务数据不拼接进可执行代码。
export async function runTerrainWorker(root: string, job: string, state: TerrainJobStatus, signal?: AbortSignal): Promise<TerrainJobStatus> {
  try {
    return await new Promise<TerrainJobStatus>((resolve, reject) => {
      const worker = new Worker(join(__dirname, 'terrain-worker.js'), { workerData: { root, job, state } });
      const children = new Set<number>();
      const killChild = (pid: number) => { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) console.error('下载进程停止失败', error); } };
      const abort = () => { for (const pid of children) killChild(pid); void worker.terminate(); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let result: TerrainJobStatus | undefined;
      let failure: Error | undefined;
      worker.on('message', (value: unknown) => {
        if (value && typeof value === 'object' && 'child' in value && 'pid' in value && typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0) {
          if (value.child === 'start') { children.add(value.pid); if (signal?.aborted) killChild(value.pid); }
          else if (value.child === 'end') children.delete(value.pid);
          return;
        }
        const parsed = terrainJobStatusSchema.safeParse(value);
        if (parsed.success && parsed.data.id === state.id) result = parsed.data;
      });
      worker.once('error', error => { failure = error; });
      // 等到线程退出再释放同 job 锁，避免收到结果后线程仍有未完成的写入。
      worker.once('exit', code => {
        signal?.removeEventListener('abort', abort);
        for (const pid of children) killChild(pid);
        if (signal?.aborted) reject(new Error(String(signal.reason ?? '任务已取消')));
        else if (!failure && code === 0 && result) resolve(result);
        else reject(failure ?? new Error(`地形 worker 异常退出（${code}）`));
      });
    });
  } catch (error) {
    // 使用线程最近落盘的阶段，不能用启动时 queued 快照覆盖进度。
    const latest = terrainJobStatusSchema.parse(JSON.parse(await readFile(join(job, 'status.json'), 'utf8')));
    await new Progress(job, latest).fail(error instanceof Error ? error.message : '地形 worker 启动失败');
    return latest;
  }
}
