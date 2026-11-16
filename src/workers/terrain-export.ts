import { parentPort, workerData } from 'node:worker_threads';
import { terrainExportModelSchema } from '../shared/contracts/terrain';
import { exportModel } from '../main/terrain/export-model';

if (!parentPort) throw new Error('模型导出只能在线程中运行');
const port = parentPort;
const { root, input }: { root: string; input: unknown } = workerData;
void exportModel(root, terrainExportModelSchema.parse(input)).then(content => port.postMessage({ ok: true, content })).catch(error => {
  port.postMessage({ ok: false, message: error instanceof Error ? error.message : '模型导出失败' });
});
