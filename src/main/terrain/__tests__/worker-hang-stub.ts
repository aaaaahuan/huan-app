import type { TerrainJobStatus } from '@shared/contracts/terrain';
import { Progress } from '../pipeline/state';

const waits = new Map<string, { resolve(): void; promise: Promise<void> }>();

export function releaseHang(job: string) {
  waits.get(job)?.resolve();
}

export async function runTerrainWorker(root: string, job: string, state: TerrainJobStatus, signal?: AbortSignal): Promise<TerrainJobStatus> {
  void root;
  let settle!: () => void;
  const promise = new Promise<void>(resolve => { settle = resolve; });
  waits.set(job, { resolve: settle, promise });
  const abort = () => settle();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await promise;
    if (signal?.aborted) throw new Error(String(signal.reason ?? '任务已取消'));
    return state;
  } catch (error) {
    await new Progress(job, state).fail(error instanceof Error ? error.message : String(error));
    return state;
  } finally {
    signal?.removeEventListener('abort', abort);
    waits.delete(job);
  }
}
