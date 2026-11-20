import { getSummary, getPrintParams, savePrintParams } from './details';
import { terrainSavePrintParamsSchema, terrainExportModelSchema, terrainAssetRequestSchema, terrainJobRequestSchema, terrainUploadSchema, type TerrainAssetResult, type TerrainWriteResult, type TerrainGetResult, type TerrainListResult } from '@shared/contracts/terrain';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolveJobAsset } from './assets';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { retryJob, cancelJob, stopJobs, recoverJobs, assertJobProgress, startPreparedJob } from './pipeline';
import { defaultTerrainDataDir, resolveTerrainDataDir } from './root';
import { exportModelWorker } from './export-worker';
import { createRecord, existingModel, findRecord, hydrateRecord, publishModel, readCatalog, readLinkedModel, recordSummary, removeRecord, usesCachedPreview } from './catalog';

export function registerTerrain(assertTrusted: (event: IpcMainInvokeEvent) => void, loadDataDir: () => Promise<string>) {
  const dataRoot = async () => resolveTerrainDataDir(await loadDataDir(), defaultTerrainDataDir(app.getAppPath(), app.isPackaged, app.getPath('userData'), __dirname));
  let currentRoot: string | undefined;
  let lifecycle = Promise.resolve();
  let closing = false;
  const withRoot = <T>(action: (root: string) => Promise<T>) => {
    const next = lifecycle.then(async () => {
      if (closing) throw new Error('地形服务正在退出');
      const root = await dataRoot();
      if (root !== currentRoot) {
        if (currentRoot) await stopJobs(currentRoot, '缓存目录已切换，任务已中断，可重试');
        await recoverJobs(root); currentRoot = root;
      }
      return action(root);
    });
    lifecycle = next.then(() => undefined, () => undefined);
    return next;
  };
  const readyRoot = () => withRoot(async root => root);
  async function prepare(root: string, id: string) {
    const record = await findRecord(id), state = await hydrateRecord(root, record);
    const model = await existingModel(record);
    if (state.status === 'queued') await startPreparedJob(root, id, (root, id) => publishModel(root,id,record.model));
    else if (!model && state.status === 'completed') await retryJob(root, id, false, (root,id) => publishModel(root,id,record.model));
    return record;
  }
  ipcMain.handle(IPC_CHANNELS.terrain.chooseModel, async event => {
    assertTrusted(event);
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('应用窗口已关闭');
      const result = await dialog.showOpenDialog(window, { title:'关联现有地形模型', properties:['openFile'], filters:[{ name:'地形模型', extensions:['3mf','stl'] }] });
      return { ok:true, path:result.canceled ? null : result.filePaths[0] ?? null };
    } catch (error) { return { ok:false, message:error instanceof Error ? error.message : '选择模型失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.delete, async (event, input: unknown) => {
    assertTrusted(event);
    try { await withRoot(async root => {
      const { id } = terrainJobRequestSchema.parse(input), record = await findRecord(id);
      const state = await recordSummary(root, record);
      if (['queued','running'].includes(state.status)) throw new Error('请先取消建模任务再删除');
      await removeRecord(id);
    }); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '删除失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getSummary, async (event, input: unknown) => {
    assertTrusted(event);
    try { return { ok: true, summary: await withRoot(async root => {
      const { id } = terrainJobRequestSchema.parse(input); await prepare(root, id);
      const summary = await getSummary(root, id); summary.job = await recordSummary(root, await findRecord(id)); return summary;
    }) }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '读取摘要失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getPrintParams, async (event, input: unknown) => {
    assertTrusted(event);
    try { return { ok: true, ...await withRoot(async root => { const { id } = terrainJobRequestSchema.parse(input); await prepare(root,id); return getPrintParams(root,id); }) }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '读取参数失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.savePrintParams, async (event, input: unknown) => {
    assertTrusted(event);
    try { const { id, params } = terrainSavePrintParamsSchema.parse(input); await withRoot(async root => { await findRecord(id); await savePrintParams(root,id,params); }); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '保存参数失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.cancel, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return { ok: true, job: await withRoot(async root => { const { id } = terrainJobRequestSchema.parse(input); await findRecord(id); return cancelJob(root,id); }) }; }
    catch (error) { return { ok: false, message: `取消失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.listJobs, async (event): Promise<TerrainListResult> => {
    assertTrusted(event);
    try { return await withRoot(async root => {
      const catalog = await readCatalog(), jobs = [], diagnostics = catalog.diagnostics.slice();
      for (const record of catalog.records) {
        try { jobs.push(await recordSummary(root,record)); }
        catch (error) { diagnostics.push({ id:record.id, message:error instanceof Error ? error.message : '作品读取失败' }); }
      }
      // ISO 日期可直接排序。仅有年份的记录排在同年有明确日期的记录后面。
      jobs.sort((left, right) => right.date.localeCompare(left.date));
      return { ok:true, jobs, diagnostics };
    }); }
    catch (error) { return { ok: false, message: `无法读取 Obsidian 作品库：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.getJob, async (event, input: unknown): Promise<TerrainGetResult> => {
    assertTrusted(event);
    try { return await withRoot(async root => {
      const { id } = terrainJobRequestSchema.parse(input), record = await prepare(root,id);
      await assertJobProgress(root,id);
      return { ok:true, job:await recordSummary(root,record) };
    }); }
    catch (error) { return { ok:false, message:`无法读取作品：${error instanceof Error ? error.message : String(error)}` }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.upload, async (event, input: unknown): Promise<TerrainWriteResult> => {
    assertTrusted(event);
    try { return await withRoot(async root => {
      // 必须先提交 Obsidian 记录与轨迹，再创建本地构建缓存；缓存失败不丢失原作品。
      const record = await createRecord(terrainUploadSchema.parse(input));
      await prepare(root,record.id);
      return { ok:true, job:await recordSummary(root,record) };
    }); }
    catch (error) { return { ok:false, message:`保存作品失败：${error instanceof Error ? error.message : String(error)}` }; }
  });
  for (const [channel, regenerate] of [[IPC_CHANNELS.terrain.regenerate,true],[IPC_CHANNELS.terrain.retry,false]] as const) {
    ipcMain.handle(channel, async (event, input:unknown): Promise<TerrainWriteResult> => {
      assertTrusted(event);
      try { return { ok:true, job:await withRoot(async root => { const { id } = terrainJobRequestSchema.parse(input); const record = await findRecord(id); return retryJob(root,id,regenerate,(root,id) => publishModel(root,id,record.model)); }) }; }
      catch (error) { return { ok:false, message:error instanceof Error ? error.message : '建模失败' }; }
    });
  }
  ipcMain.handle(IPC_CHANNELS.terrain.exportModel, async (event,input:unknown): Promise<TerrainAssetResult> => {
    assertTrusted(event);
    try { return { ok:true, content:await withRoot(async root => {
      const request = terrainExportModelSchema.parse(input), record = await findRecord(request.id), model = await existingModel(record);
      if (!model) throw new Error('模型尚未生成，请等待建模完成');
      const cached = await usesCachedPreview(root,record,model);
      if (request.track && extname(model).slice(1).toLowerCase() === request.format) return readLinkedModel(record);
      if (!cached) throw new Error('关联模型不包含可切换图层，仅支持下载原模型格式');
      return exportModelWorker(root,request);
    }) }; }
    catch (error) { return { ok:false, message:error instanceof Error ? error.message : '模型导出失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.readAsset, async (event,input:unknown): Promise<TerrainAssetResult> => {
    assertTrusted(event);
    try { return { ok:true, content:await withRoot(async root => {
      const { id,area,path } = terrainAssetRequestSchema.parse(input), record = await findRecord(id), model = await existingModel(record);
      if (!model) throw new Error('模型尚未生成');
      if (!await usesCachedPreview(root,record,model)) {
        const format = extname(model).slice(1).toLowerCase();
        if (area === 'web' && path === 'metadata.json') return new TextEncoder().encode(JSON.stringify({ linked_model:format, palette:[] }));
        if (area === 'models' && path === `terrain.${format}`) return readLinkedModel(record);
        throw new Error('关联模型未保存此图层');
      }
      if (!['.bin','.json','.glb','.stl','.3mf','.jpg','.png'].includes(extname(path).toLowerCase())) throw new Error('不支持的预览资源');
      const file = await resolveJobAsset(root,id,area,path);
      if ((await stat(file)).size > 150_000_000) throw new Error('预览资源超过 150 MB');
      return new Uint8Array(await readFile(file));
    }) }; }
    catch (error) { return { ok:false, message:error instanceof Error ? error.message : '资源读取失败' }; }
  });
  ipcMain.handle(IPC_CHANNELS.terrain.autoRoot,event => { assertTrusted(event); return readyRoot(); });
  return { async configure(_configured:string) { void _configured; await readyRoot(); }, async close() { closing=true; await lifecycle; await stopJobs(); } };
}
