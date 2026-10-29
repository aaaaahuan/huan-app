import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerrainJobStatus } from '@shared/contracts/terrain';

export const STAGES = [
  ['parse', '解析轨迹'], ['dem', '获取地形数据'], ['terrain', '3D 地形建模'],
  ['features', '生成河流与地表要素'], ['photos', '照片点与房屋'], ['scale', '海拔刻度'],
  ['export', '导出与校验'], ['preview', '生成网页预览']
] as const;
export const pendingStages = (): TerrainJobStatus['stages'] => STAGES.map(([key, name]) => ({ key, name, status: 'pending', elapsed_seconds: null, detail: '' }));
// 写入路径不能沿用只读资源解析对目录内链接的容忍策略。
export async function directory(path: string) {
  await mkdir(path, { recursive: true });
  if (!(await lstat(path)).isDirectory()) throw new Error('写入目录不能是符号链接');
  return realpath(path);
}
export async function writeBytes(path: string, value: Uint8Array | string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, value, { flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export function writeJson(path: string, value: unknown) { return writeBytes(path, JSON.stringify(value, null, 2)); }
const now = () => Date.now() / 1000;
export class Progress {
  constructor(readonly job: string, readonly state: TerrainJobStatus) {}
  save() { return writeJson(join(this.job, 'status.json'), this.state); }
  private close(error?: string) {
    const time = now();
    for (const stage of this.state.stages) if (stage.status === 'running') {
      stage.status = error ? 'failed' : 'done'; stage.finished_at = time;
      stage.elapsed_seconds = Math.round((time - (stage.started_at ?? time)) * 1000) / 1000;
    }
  }
  async stage(key: TerrainJobStatus['stages'][number]['key'], detail = '') {
    const stage = this.state.stages.find(value => value.key === key);
    if (!stage) throw new Error('阶段不存在');
    this.close();
    Object.assign(stage, { status: 'running', started_at: now(), elapsed_seconds: 0, detail });
    Object.assign(this.state, { status: 'running', updated_at: now() });
    await this.save();
  }
  async detail(text: string) {
    for (const stage of this.state.stages) if (stage.status === 'running') stage.detail = text;
    await this.save();
  }
  async finish(error: string | null = null) {
    this.close(error ?? undefined);
    Object.assign(this.state, { status: error ? 'failed' : 'completed', error, finished_at: now(), updated_at: now(), total_seconds: Math.round((now() - this.state.started_at) * 1000) / 1000 });
    await this.save();
  }
  fail(error: string) { return this.finish(error); }
}
