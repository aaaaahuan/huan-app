import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { terrainJobRequestSchema, terrainUploadSchema, type TerrainWriteResult, type TerrainGetResult, type TerrainListResult } from '@shared/contracts/terrain';
import { createJob, retryJob } from './pipeline';
import { getJob, listJobs } from './library';
import { defaultTerrainDataDir, resolveTerrainDataDir } from './root';
import { registerTerrain as registerPythonTerrain } from './python-service';

export function registerTerrain(assertTrusted: (event: IpcMainInvokeEvent) => void, loadDataDir: () => Promise<string>) {
  // 只读方法独立解析当前配置，不调用会建目录、恢复任务或启动 Python 的路径。
  const dataRoot = async () => resolveTerrainDataDir(await loadDataDir(), defaultTerrainDataDir(app.getAppPath(), app.isPackaged, app.getPath('userData')));
  ipcMain.handle(IPC_CHANNELS.terrain.listJobs, async (event): Promise<TerrainListResult> => {
    assertTrusted(event);
    try { return { ok: true, ...await listJobs(await dataRoot()) }; }
    catch (error) { return { ok: false, message: `无法读取作品库：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getJob, async (event, input: unknown): Promise<TerrainGetResult> => {
    assertTrusted(event);
    try {
      const { id } = terrainJobRequestSchema.parse(input);
      return { ok: true, job: await getJob(await dataRoot(), id) };
    } catch (error) { return { ok: false, message: `无法读取作品：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.upload, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await createJob(await dataRoot(), terrainUploadSchema.parse(input)) }; }
    catch (error) { return { ok: false, message: `上传失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.retry, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await retryJob(await dataRoot(), terrainJobRequestSchema.parse(input).id) }; }
    catch (error) { return { ok: false, message: `重试失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  return registerPythonTerrain(assertTrusted, loadDataDir);
}
