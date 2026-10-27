import { parentPort, workerData } from 'node:worker_threads';
import { runNative } from '../main/terrain/pipeline/runner';
import type { TerrainJobStatus } from '../shared/contracts/terrain';

const { root, job, state }: { root: string; job: string; state: TerrainJobStatus } = workerData;
if (!parentPort) throw new Error('地形构建只能在线程中运行');
const port = parentPort;
void runNative(root, job, state).then(result => port.postMessage(result));
