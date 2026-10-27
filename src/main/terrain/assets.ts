import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { terrainJobIdSchema, terrainJobStatusSchema } from '@shared/contracts/terrain';

function assertInside(base: string, target: string): void {
  const path = relative(base, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('资源路径越界。');
}

// 每一级都检查真实路径，避免作品目录、资源目录或文件的符号链接逃逸。
export async function resolveJobPath(dataRoot: string, id: string): Promise<string> {
  terrainJobIdSchema.parse(id);
  const root = await realpath(join(dataRoot, 'jobs'));
  const job = await realpath(join(root, id));
  assertInside(root, job);
  if (job === root || !(await stat(job)).isDirectory()) throw new Error('作品目录无效。');
  return job;
}

export async function resolveJobFile(dataRoot: string, id: string, parts: readonly string[]): Promise<string> {
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\/%\0:]/.test(part))) {
    throw new Error('资源路径无效。');
  }
  const job = await resolveJobPath(dataRoot, id);
  const target = await realpath(join(job, ...parts));
  assertInside(job, target);
  if (!(await stat(target)).isFile()) throw new Error('资源不是文件。');
  return target;
}

export async function readJobStatus(dataRoot: string, id: string) {
  const status = terrainJobStatusSchema.parse(JSON.parse(await readFile(await resolveJobFile(dataRoot, id, ['status.json']), 'utf8')));
  if (status.id !== id) throw new Error('作品编号与目录不一致。');
  return status;
}

const suffixes = new Set(['.html', '.js', '.css', '.bin', '.json', '.glb', '.jpg', '.png', '.stl', '.3mf']);

// 仅解析文件，不向 renderer 暴露任意本机路径或执行旧作品中的脚本。
export async function resolveJobAsset(dataRoot: string, id: string, area: 'web' | 'models', path: string): Promise<string> {
  if (area !== 'web' && area !== 'models') throw new Error('资源目录无效。');
  if ((await readJobStatus(dataRoot, id)).status !== 'completed') throw new Error('作品尚未完成。');
  const parts = (path || 'index.html').split('/');
  const target = await resolveJobFile(dataRoot, id, [area, ...parts]);
  const job = await resolveJobPath(dataRoot, id);
  const base = await realpath(join(job, area));
  assertInside(job, base);
  assertInside(base, target);
  if (!suffixes.has(extname(target).toLowerCase()) || !suffixes.has(extname(parts.at(-1) ?? '').toLowerCase())) throw new Error('不支持的资源类型。');
  return target;
}

export async function readJobAssetJson(dataRoot: string, id: string, path: string): Promise<unknown> {
  if (extname(path).toLowerCase() !== '.json') throw new Error('需要 JSON 资源。');
  return JSON.parse(await readFile(await resolveJobAsset(dataRoot, id, 'web', path), 'utf8'));
}
