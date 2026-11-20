import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import type { TerrainJobSummary, TerrainUpload } from '@shared/contracts/terrain';
import { terrainJobIdSchema } from '@shared/contracts/terrain';
import { getJob } from './library';
import { pathModelDirectory } from '@main/model-library';
import { readJobStatus } from './assets';
import { directory, pendingStages, writeBytes, writeJson } from './pipeline/state';

export interface TerrainRecord { id: string; name: string; date: string; track: string; model: string; line: number }
const project = process.env.HUAN_TERRAIN_NOTES_DIR || join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/huan-space/project/huan-project/huan-path');
export const terrainNotePath = join(project, '轨迹作品记录.md');
const header = '| 名称 | 时间（YYYY-MM-DD） | 地形轨迹文件 | 建模文件 |\n| --- | --- | --- | --- |';
function validRecordDate(value: string) {
  // 旧轨迹可能只知道年份，清单按原有精度显示，不补造月日。
  if (/^[1-9]\d{3}$/.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function link(path: string, label: string) { return path ? `[${label}](${encodeURI(path).replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('#', '%23').replaceAll('?', '%3F')})` : '—'; }
function uri(cell: string, extensions: string[]) {
  const matches = [...cell.matchAll(/\]\(([^)]+)\)/g)];
  for (const match of matches) {
    const path = decodeURIComponent(match[1]);
    if (extensions.includes(extname(path).toLowerCase())) return path;
  }
  const plain = cell.trim();
  return extensions.includes(extname(plain).toLowerCase()) ? plain : '';
}
function line(record: TerrainRecord) {
  return `| ${record.name.replaceAll('|', '&#124;').replaceAll('\n', ' ')} | ${record.date} | ${link(record.track, '轨迹 '+extname(record.track).slice(1).toUpperCase())} | ${link(record.model, '模型 '+extname(record.model).slice(1).toUpperCase())} |`;
}
export async function readCatalog() {
  // 笔记库不可用时明确报错，不退回扫描本地缓存形成另一份作品列表。
  await stat(project);
  let text: string;
  try { text = await readFile(terrainNotePath, 'utf8'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; text = '# 轨迹作品记录\n\n'+header+'\n'; }
  const records: TerrainRecord[] = [], diagnostics: { id: string; message: string }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const cells = lines[i].split('|').slice(1, -1).map(s => s.trim());
    if (!cells.length || cells[0] === '名称' || /^[-: ]+$/.test(cells[0])) continue;
    try {
      const [name, date, trackCell, modelCell = ''] = cells;
      const track = uri(trackCell ?? '', ['.kml', '.kmz']);
      const model = uri(modelCell, ['.3mf', '.stl']) || uri(trackCell ?? '', ['.3mf', '.stl']);
      if (!name || !validRecordDate(date ?? '') || !track) throw new Error('名称、日期或轨迹路径无效');
      const found = track.split('/').find(part => terrainJobIdSchema.safeParse(part).success);
      const id = found || `${date.replaceAll('-', '').padEnd(8, '0')}-000000-${createHash('sha256').update(track).digest('hex').slice(0, 10)}`;
      if (records.some(r => r.id === id)) throw new Error('作品 ID 重复');
      records.push({ id, name: name.replaceAll('&#124;', '|'), date, track, model, line: i });
    } catch (error) { diagnostics.push({ id: `第 ${i+1} 行`, message: error instanceof Error ? error.message : '作品记录无效' }); }
  }
  return { text, lines, records, diagnostics };
}
async function saveCatalog(before: Awaited<ReturnType<typeof readCatalog>>, lines: string[]) {
  let current: string;
  try { current = await readFile(terrainNotePath, 'utf8'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; current = before.text; }
  if (current !== before.text) throw new Error('Obsidian 记录已发生变化，请刷新后重试');
  // 保留表格以外的正文；三列表格在第一次写入时升级为独立模型路径列。
  for (let i=0; i<lines.length; i++) {
    if (lines[i].startsWith('| 名称 |')) { lines[i] = header.split('\n')[0]; if (lines[i+1]?.startsWith('| ---')) lines[i+1] = header.split('\n')[1]; }
  }
  await writeBytes(terrainNotePath, lines.join('\n'));
}
export async function findRecord(id: string) {
  const record = (await readCatalog()).records.find(r => r.id === id);
  if (!record) throw new Error('Obsidian 中不存在这条作品记录');
  return record;
}
export function recordPath(path: string) {
  if (path.includes('\0') || /^[a-z]+:\/\//i.test(path)) throw new Error('只支持本机文件路径');
  // 笔记中显式关联的绝对路径允许指向外部模型，普通相对路径只在本项目笔记目录内解析。
  const target = resolve(project, path);
  if (!isAbsolute(path) && (relative(project, target) === '..' || relative(project, target).startsWith('../'))) throw new Error('笔记附件相对路径不能越界');
  return target;
}
export async function existingModel(record: TerrainRecord) {
  if (!record.model) return undefined;
  const path = recordPath(record.model);
  if (!['.3mf', '.stl'].includes(extname(path).toLowerCase())) throw new Error('关联模型仅支持 3MF / STL');
  try { const info = await stat(path); if (!info.isFile() || !info.size || info.size > 150_000_000) throw new Error('模型文件无效或超过 150 MB'); return path; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
}
// 构建线程完成回调与界面新增/删除共用写队列，避免两个任务回写时丢失清单行。
let mutation = Promise.resolve();
function mutate<T>(action: () => Promise<T>) {
  const next = mutation.then(action);
  mutation = next.then(() => undefined, () => undefined);
  return next;
}
export const createRecord = (input: TerrainUpload) => mutate(() => createRecordUnlocked(input));
export const removeRecord = (id: string) => mutate(() => removeRecordUnlocked(id));
export const publishModel = (root: string, id: string, expectedModel?: string) => mutate(() => publishModelUnlocked(root,id,expectedModel));
async function createRecordUnlocked(input: TerrainUpload) {
  const before = await readCatalog();
  if (before.diagnostics.length) throw new Error('请先修复 Obsidian 表格中的无效记录');
  const now = new Date(), stamp = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/[-: ]/g, '');
  const id = `${stamp.slice(0,8)}-${stamp.slice(8,14)}-${randomBytes(5).toString('hex')}`;
  const folder = join(project, 'assets/轨迹作品', id); await mkdir(folder, { recursive: true });
  const track = relative(project, join(folder, 'input'+extname(input.filename).toLowerCase()));
  const record = { id, name: input.name ?? basename(input.filename, extname(input.filename)), date: input.date ?? now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), track, model: input.modelPath?.trim() ?? '', line: before.lines.length };
  if (record.model) await existingModel(record);
  await writeBytes(recordPath(track), input.content);
  const lines = before.lines.slice();
  for (const old of before.records) lines[old.line] = line(old);
  const insertion = before.records.length ? before.records.at(-1)!.line+1 : lines.findIndex(l => l.startsWith('| ---'))+1;
  lines.splice(insertion, 0, line(record));
  await saveCatalog(before, lines);
  return record;
}
async function removeRecordUnlocked(id: string) {
  const before = await readCatalog(), record = before.records.find(r => r.id === id);
  if (!record) throw new Error('作品记录已不存在');
  // 只移除清单记录，保留原轨迹与模型附件供恢复，不删除笔记关联的外部文件。
  const lines = before.lines.slice();
  for (const old of before.records) lines[old.line] = line(old);
  lines.splice(record.line, 1); await saveCatalog(before, lines);
}
export async function hydrateRecord(root: string, record: TerrainRecord) {
  try { return await readJobStatus(root, record.id); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const model = await existingModel(record), folder = join(root, 'jobs', record.id);
  const input = extname(record.track).toLowerCase() === '.kmz' ? 'input.kmz' : 'input.kml';
  let content: Buffer;
  try { content = await readFile(recordPath(record.track)); } catch (error) { if (!model || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; content = Buffer.from(''); }
  if ((!content.length && !model) || content.length > 150_000_000) throw new Error('轨迹文件为空或超过 150 MB');
  await directory(join(root,'jobs'));
  await directory(folder);
  await directory(join(folder,'data'));
  await writeBytes(join(folder, input), content);
  const state = { id: record.id, name: record.name, filename: basename(record.track), input_file: input, status: model ? 'completed' as const : 'queued' as const, origin: 'native', started_at: Date.now()/1000, stages: pendingStages(), preview_url: `/jobs/${record.id}/web/`, error: null };
  await writeJson(join(folder, 'status.json'), state);
  return state;
}
const comparisons = new Map<string, { signature: string; equal: boolean }>();
export async function usesCachedPreview(root: string, record: TerrainRecord, model: string) {
  const local = join(root, 'jobs', record.id, 'models/terrain'+extname(model).toLowerCase());
  try {
    const metadataPath = join(root, 'jobs', record.id, 'web/metadata.json');
    const metadataInfo = await stat(metadataPath);
    const [a,b] = await Promise.all([stat(model),stat(local)]);
    const signature = `${model}:${a.size}:${a.mtimeMs}:${b.size}:${b.mtimeMs}:${metadataInfo.mtimeMs}:${metadataInfo.size}`;
    if (comparisons.get(local)?.signature === signature) return comparisons.get(local)!.equal;
    const metadata: unknown = JSON.parse(await readFile(metadataPath,'utf8'));
    if (!metadata || typeof metadata !== 'object' || (!('preview_layers' in metadata) && !('native_core_only' in metadata))) return false;
    const equal = a.size === b.size && createHash('sha256').update(await readFile(model)).digest('hex') === createHash('sha256').update(await readFile(local)).digest('hex');
    comparisons.set(local,{ signature, equal });
    return equal;
  } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}
export async function recordSummary(root: string, record: TerrainRecord): Promise<TerrainJobSummary> {
  let state;
  try { state = await getJob(root, record.id); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    state = { id: record.id, filename: basename(record.track), input_file: extname(record.track) === '.kmz' ? 'input.kmz' as const : 'input.kml' as const, status: 'queued' as const, started_at: 0, stages: pendingStages(), preview_url: `/jobs/${record.id}/web/`, error: null, name: record.name, date: record.date, photo_count: 0, house_count: 0, uncertain_houses: 0 };
  }
  const model = await existingModel(record);
  return { ...state, name: record.name, date: record.date, model_path: record.model, track_path: record.track,
    ...(model && (!['running','queued'].includes(state.status) || state.started_at === 0) ? { status: 'completed' as const } : {}),
    ...(model ? { model_revision: String((await stat(model)).mtimeMs), model_format: extname(model).slice(1).toLowerCase() as 'stl' | '3mf' } : {}) };
}
async function publishModelUnlocked(root: string, id: string, expectedModel?: string) {
  const before = await readCatalog(), record = before.records.find(r => r.id === id);
  if (!record) return;
  if (expectedModel !== undefined && record.model !== expectedModel) throw new Error('建模期间关联模型已被修改，生成文件保留在缓存中，请刷新后确认');
  const folder = join(pathModelDirectory(), id); await mkdir(folder, { recursive: true });
  // 生成物另存为版本文件，最后才切换笔记引用；失败不损坏旧关联模型。
  const target = join(folder, `terrain-${Date.now()}.3mf`), temp = target+'.tmp';
  await copyFile(join(root, 'jobs', id, 'models/terrain.3mf'), temp);
  await writeBytes(target, await readFile(temp));
  const { unlink } = await import('node:fs/promises'); await unlink(temp);
  record.model = target;
  const lines = before.lines.slice(); for (const item of before.records) lines[item.line] = line(item);
  await saveCatalog(before, lines);
}
export async function readLinkedModel(record: TerrainRecord) {
  const path = await existingModel(record);
  if (!path) throw new Error('关联模型不存在');
  // realpath 仅用于读取模型，不以模型中嵌入的链接请求外部文件。
  return new Uint8Array(await readFile(await realpath(path)));
}
