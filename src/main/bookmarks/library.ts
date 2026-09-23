// 收藏数据协调层：源文件为准，本地副本仅在同路径读取失败时兜底。
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { PLATFORMS, type Platform, type Settings, type SettingsResult } from '@shared/contracts/settings';
import type { BookmarkLibrary, BookmarkSource } from '@shared/contracts/bookmarks';
import { bookmarkId, parseBookmarks, validBookmarkUrl } from './markdown';

// 副本也可能被外部修改；读取时校验结构，不能把本地 JSON 直接当可信数据。
const itemSchema = z.object({
  id: z.string(), platform: z.enum(PLATFORMS), url: z.string().refine(validBookmarkUrl),
  title: z.string(), collectedAt: z.string(), source: z.string()
});
const snapshotSchema = z.object({
  path: z.string(), readAt: z.string().datetime(), duplicates: z.number().int().nonnegative(), items: z.array(itemSchema)
});
const cacheSchema = z.object({ version: z.literal(1), sources: z.object({
  x: snapshotSchema.optional(), reddit: snapshotSchema.optional(), youtube: snapshotSchema.optional()
}) });
type Cache = z.infer<typeof cacheSchema>;

// 限制读取大小，并对比前后元信息；尽量避免将编辑中的文件作为完整结果发布。
async function readBounded(path: string, limit: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit) throw new Error(`不是普通文件，或文件超过 ${limit / 1024 / 1024} MB。`);
    // 多读一个字节用于发现文件增长，循环处理底层读取可能只返回部分数据的情况。
    const bytes = Buffer.alloc(Math.min(before.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || length !== before.size)
      throw new Error('读取期间文件发生变化，本轮未更新。');
    // 非法编码直接报错，避免用替换字符生成错误链接或标题。
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await file.close(); }
}

async function readSource(path: string): Promise<string> {
  if (!isAbsolute(path) || !['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('未配置有效的 Markdown 绝对路径。');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // 超时只结束本轮等待，不取消底层 I/O；迟到结果不会再写入列表或副本。
    return await Promise.race([
      readBounded(path, 8 * 1024 * 1024),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('读取超时，请确认 iCloud 文件已下载到本机。')), 10_000); })
    ]);
  } finally { clearTimeout(timeout); }
}

export function createBookmarkLibrary(directory: string, loadSettings: () => Promise<SettingsResult>) {
  const cacheDirectory = join(directory, 'bookmarks');
  const cachePath = join(cacheDirectory, 'last-success.json');
  let cache: Cache = { version: 1, sources: {} };
  // current 用于判断来源配置是否变化；state 是当前可交给 UI 的结果。
  let current: Settings | undefined;
  let state: BookmarkLibrary = { sources: [], warning: '' };
  let cacheWarning = '';

  // 临时文件与正式文件放在同一目录，用 rename 发布完整快照。
  async function persist(next: Cache) {
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    const temporary = join(cacheDirectory, `.last-success-${randomUUID()}.tmp`);
    try {
      const text = JSON.stringify(next);
      if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw new Error('本地副本超过 64 MB。');
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, cachePath);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async function apply(settings: Settings) {
    // 先组装候选结果，成功落盘后才更新有效副本；失败来源仍保留旧记录。
    const next: Cache = { version: 1, sources: { ...cache.sources } };
    const successful = new Set<Platform>();
    const sources: BookmarkSource[] = [];
    for (const platform of PLATFORMS) {
      const config = settings.sources[platform];
      const previous = state.sources.find((source) => source.platform === platform);
      // 保存其他设置不能触发所有来源重读；停用仅隐藏，不删除该来源副本。
      if (current && JSON.stringify(current.sources[platform]) === JSON.stringify(config) && previous) {
        sources.push(previous); continue;
      }
      const base: BookmarkSource = { platform, path: config.path, state: 'disabled', readAt: null, message: '', duplicates: 0, items: [] };
      if (!config.enabled) { sources.push(base); continue; }
      try {
        const parsed = parseBookmarks(await readSource(config.path), platform);
        const snapshot = { path: config.path, readAt: new Date().toISOString(), ...parsed };
        next.sources[platform] = snapshot;
        successful.add(platform);
        sources.push({ ...base, ...snapshot, state: 'ready' });
      } catch (error) {
        const snapshot = cache.sources[platform];
        const message = error instanceof Error ? error.message : '无法读取来源文件。';
        // 路径必须完全一致，不能把旧路径的数据冒充新来源的读取结果。
        sources.push(snapshot?.path === config.path
          ? { ...base, ...snapshot, state: 'cached', message: `${message} 正在使用本地副本。` }
          : { ...base, state: 'error', message: `${message} 无对应路径的有效本地副本。` });
      }
    }
    let warning = cacheWarning;
    if (successful.size) {
      try { await persist(next); cache = next; cacheWarning = ''; warning = ''; }
      catch (error) {
        console.error('Bookmark snapshot save failed', error);
        warning = '本地副本保存失败，本轮成功读取的数据未发布。请检查磁盘空间和 ~/.huan-app/bookmarks 的权限。';
        // 副本无法保存时撤回本轮新数据，避免界面与“最近成功副本”不一致。
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          if (!successful.has(source.platform)) continue;
          const old = cache.sources[source.platform];
          sources[i] = old?.path === source.path
            ? { ...source, ...old, state: 'cached', message: warning }
            : { ...source, items: [], readAt: null, duplicates: 0, state: 'error', message: warning };
        }
      }
    }
    current = settings;
    state = { sources, warning };
    return state;
  }

  async function initialize() {
    try {
      cache = cacheSchema.parse(JSON.parse(await readBounded(cachePath, 64 * 1024 * 1024)));
      // 除结构外，还核对平台、稳定 ID 和重复项，拒绝不一致的缓存身份。
      for (const platform of PLATFORMS) {
        const seen = new Set<string>();
        for (const item of cache.sources[platform]?.items ?? []) {
          if (item.platform !== platform || item.id !== bookmarkId(platform, item.url) || seen.has(item.id)) throw new Error('Invalid cached identity');
          seen.add(item.id);
        }
      }
    } catch (error) {
      cache = { version: 1, sources: {} };
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') cacheWarning = '本地副本无效或不可读；将尝试原始文件，不使用损坏副本。';
    }
    const result = await loadSettings();
    if (!result.ok) { state = { sources: [], warning: result.message }; return state; }
    return apply(result.settings);
  }

  // 启动只读取一次；后续配置更新串行处理，普通 UI 查询只等待现有结果。
  let pending = initialize();
  return {
    get: () => pending,
    update(settings: Settings) {
      pending = pending.then(() => apply(settings));
      return pending;
    }
  };
}
