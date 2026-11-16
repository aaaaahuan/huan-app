import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { TerrainAssetResult, TerrainExportModel } from '@shared/contracts/terrain';

export function exportModelWorker(root: string, input: TerrainExportModel): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'terrain-export-worker.js'), { workerData: { root, input } });
    let result: TerrainAssetResult | undefined, failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error('模型导出超时，请重试'); void worker.terminate(); }, 60_000);
    worker.once('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'ok' in value) {
        if (value.ok === true && 'content' in value && value.content instanceof Uint8Array) result = { ok: true, content: value.content };
        else if (value.ok === false && 'message' in value && typeof value.message === 'string') result = { ok: false, message: value.message };
      }
    });
    worker.once('error', error => { failure = error; });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (failure || code !== 0 || !result) reject(failure ?? new Error('模型导出线程异常退出'));
      else if (!result.ok) reject(new Error(result.message));
      else resolve(result.content);
    });
  });
}
