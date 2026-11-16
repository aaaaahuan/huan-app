import { getSummary, getPrintParams, savePrintParams, deleteJob } from './details';
import { terrainSavePrintParamsSchema } from '@shared/contracts/terrain';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolveJobAsset } from './assets';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { terrainAssetRequestSchema, terrainJobRequestSchema, terrainUploadSchema, type TerrainWriteResult, type TerrainGetResult, type TerrainListResult } from '@shared/contracts/terrain';
import { createJob, retryJob, cancelJob, stopJobs, recoverJobs, assertJobProgress } from './pipeline';
import { getJob, listJobs } from './library';
import { defaultTerrainDataDir, resolveTerrainDataDir } from './root';
import { terrainExportModelSchema, type TerrainAssetResult } from '@shared/contracts/terrain';
import { exportModelWorker } from './export-worker';

export function registerTerrain(assertTrusted: (event: IpcMainInvokeEvent) => void, loadDataDir: () => Promise<string>) {
  // 首次访问按当前目录恢复中断的原生任务；目录切换与写操作共用串行生命周期。
  const dataRoot = async () => resolveTerrainDataDir(await loadDataDir(), defaultTerrainDataDir(app.getAppPath(), app.isPackaged, app.getPath('userData'), __dirname));
  let currentRoot: string | undefined;
  let lifecycle = Promise.resolve();
  let closing = false;
  const withRoot = <T>(action: (root: string) => Promise<T>) => {
    const next = lifecycle.then(async () => {
      if (closing) throw new Error('地形服务正在退出');
      const root = await dataRoot();
      if (root !== currentRoot) {
        if (currentRoot) await stopJobs(currentRoot, '作品目录已切换，任务已中断，可重试');
        await recoverJobs(root); currentRoot = root;
      }
      return action(root);
    });
    lifecycle = next.then(() => undefined, () => undefined);
    return next;
  };
  const readyRoot = () => withRoot(async root => root);
  ipcMain.handle(IPC_CHANNELS.terrain.delete, async (event, input: unknown) => {
    assertTrusted(event);
    try { await withRoot(root => deleteJob(root, terrainJobRequestSchema.parse(input).id)); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '删除失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getSummary, async (event, input: unknown) => {
    assertTrusted(event);
    try { return { ok: true, summary: await withRoot(root => getSummary(root, terrainJobRequestSchema.parse(input).id)) }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '读取摘要失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getPrintParams, async (event, input: unknown) => {
    assertTrusted(event);
    try { return { ok: true, ...await withRoot(root => getPrintParams(root, terrainJobRequestSchema.parse(input).id)) }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '读取参数失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.savePrintParams, async (event, input: unknown) => {
    assertTrusted(event);
    try { const { id, params } = terrainSavePrintParamsSchema.parse(input); await withRoot(root => savePrintParams(root, id, params)); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '保存参数失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.cancel, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await withRoot(root => cancelJob(root, terrainJobRequestSchema.parse(input).id)) }; }
    catch (error) { return { ok: false, message: `取消失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.listJobs, async (event): Promise<TerrainListResult> => {
    assertTrusted(event);
    try { return { ok: true, ...await listJobs(await readyRoot()) }; }
    catch (error) { return { ok: false, message: `无法读取作品库：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getJob, async (event, input: unknown): Promise<TerrainGetResult> => {
    assertTrusted(event);
    try {
      const { id } = terrainJobRequestSchema.parse(input);
      const root = await readyRoot();
      await assertJobProgress(root, id);
      return { ok: true, job: await getJob(root, id) };
    } catch (error) { return { ok: false, message: `无法读取作品：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.upload, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await withRoot(root => createJob(root, terrainUploadSchema.parse(input))) }; }
    catch (error) { return { ok: false, message: `上传失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.regenerate, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await withRoot(root => retryJob(root, terrainJobRequestSchema.parse(input).id, true)) }; }
    catch (error) { return { ok: false, message: `重新生成失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.retry, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await withRoot(root => retryJob(root, terrainJobRequestSchema.parse(input).id)) }; }
    catch (error) { return { ok: false, message: `重试失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.exportModel, async (event, input: unknown): Promise<TerrainAssetResult> => {
    assertTrusted(event);
    try {
      const request = terrainExportModelSchema.parse(input);
      // 导出持有作品目录生命周期，避免过程中切换目录或删除同一作品。
      return { ok: true, content: await withRoot(root => exportModelWorker(root, request)) };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '模型导出失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.readAsset, async (event, input: unknown) => {
    assertTrusted(event);
    try {
      const { id, area, path } = terrainAssetRequestSchema.parse(input);
      if (!['.bin', '.json', '.glb', '.stl', '.3mf', '.jpg', '.png'].includes(extname(path).toLowerCase())) throw new Error('不支持的预览资源');
      const file = await resolveJobAsset(await readyRoot(), id, area, path);
      if ((await stat(file)).size > 150_000_000) throw new Error('预览资源超过 150 MB');
      return { ok: true, content: new Uint8Array(await readFile(file)) };
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      return { ok: false, message: missing ? '资源文件不存在。' : error instanceof Error ? error.message : '资源读取失败' };
    }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.autoRoot, event => { assertTrusted(event); return readyRoot(); });
  return {
    async configure(_configured: string) { void _configured; await readyRoot(); },
    async close() { closing = true; await lifecycle; await stopJobs(); }
  };
}
