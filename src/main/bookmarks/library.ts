// 收藏数据协调层：源文件为准，本地副本仅在同路径读取失败时兜底。
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { PLATFORMS, type Settings, type SettingsResult } from '@shared/contracts/settings';
import type { BookmarkLibrary, BookmarkSource, SetReadInput, SetReadResult } from '@shared/contracts/bookmarks';
import { bookmarkId, parseBookmarks, updateBookmarkRead, validBookmarkUrl } from './markdown';

// 副本也可能被外部修改；读取时校验结构，不能把本地 JSON 直接当可信数据。
const itemSchema = z.object({
  id: z.string(), platform: z.enum(PLATFORMS), url: z.string().refine(validBookmarkUrl),
  title: z.string(), collectedAt: z.string(), source: z.string(), read: z.boolean().default(false)
});
const snapshotSchema = z.object({
  path: z.string(), readAt: z.string().datetime(), duplicates: z.number().int().nonnegative(), items: z.array(itemSchema)
});
const cacheSchema = z.object({ version: z.literal(1), sources: z.object({
  x: snapshotSchema.optional(), reddit: snapshotSchema.optional(), youtube: snapshotSchema.optional(), wechat: snapshotSchema.optional(), other: snapshotSchema.optional()
}) });
type Cache = z.infer<typeof cacheSchema>;

// 对比前后元信息，避免将编辑中的文件作为完整结果发布。
async function readText(path: string, preserveBOM = false): Promise<string> {
  const file = await open(path, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error('只读取普通文件。');
    const bytes = await file.readFile();
    const after = await file.stat();
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || bytes.length !== before.size)
      throw new Error('读取期间文件发生变化，本轮未更新。');
    // 非法编码直接报错，避免用替换字符生成错误链接或标题。
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: preserveBOM }).decode(bytes);
  } finally { await file.close(); }
}

async function readSource(path: string): Promise<string> {
  if (!isAbsolute(path) || !['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('未配置有效的 Markdown 绝对路径。');
  return readText(path, true);
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
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, cachePath);
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async function apply(settings: Settings) {
    // 源文件读取结果直接发布；副本保存失败仅提示，失败来源仍保留旧记录。
    const next: Cache = { version: 1, sources: { ...cache.sources } };
    let refreshed = false;
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
        refreshed = true;
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
    if (refreshed) {
      cache = next;
      try { await persist(next); cacheWarning = ''; warning = ''; }
      catch (error) {
        console.error('Bookmark snapshot save failed', error);
        cacheWarning = `本地副本保存失败：${error instanceof Error ? error.message : String(error)}`;
        warning = cacheWarning;
      }
    }
    current = settings;
    state = { sources, warning };
    return state;
  }

  async function initialize() {
    try {
      cache = cacheSchema.parse(JSON.parse(await readText(cachePath)));
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
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT')
        cacheWarning = `本地副本无效或不可读：${error instanceof Error ? error.message : String(error)} 将尝试原始文件。`;
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
    },
    setRead(input: SetReadInput): Promise<SetReadResult> {
      const operation = pending.then(async () => {
        const source = state.sources.find(source => source.items.some(item => item.id === input.id));
        if (!source || source.state !== 'ready') throw new Error('仅原始笔记正常读取时可修改已读状态，不能写回缓存副本。');
        const settings = await loadSettings();
        if (!settings.ok) throw new Error(settings.message);
        const config = settings.settings.sources[source.platform];
        if (!config.enabled || config.path !== source.path) throw new Error('收藏来源配置已改变，请重新加载后重试。');
        const before = await lstat(source.path);
        if (!before.isFile()) throw new Error('只允许修改普通 Markdown 文件，不写入目录或符号链接。');
        const original = await readSource(source.path);
        const updated = updateBookmarkRead(original, source.platform, input.id, input.read);
        const parsed = parseBookmarks(updated, source.platform);
        if (updated !== original) {
          const temporary = join(dirname(source.path), `.huan-read-${randomUUID()}.tmp`);
          try {
            const file = await open(temporary, 'wx', before.mode & 0o777);
            try { await file.writeFile(updated, 'utf8'); await file.sync(); }
            finally { await file.close(); }
            // 乐观冲突检查：重读源文件后再原子替换；不把内存旧副本覆盖回 Obsidian。
            const latest = await lstat(source.path);
            if (latest.ino !== before.ino || latest.mtimeMs !== before.mtimeMs || await readSource(source.path) !== original)
              throw new Error('写入前笔记已被其他操作修改，请重试。');
            await rename(temporary, source.path);
          } finally { await unlink(temporary).catch(() => undefined); }
        }
        const snapshot = { path: source.path, readAt: new Date().toISOString(), ...parsed };
        const next: Cache = { version: 1, sources: { ...cache.sources, [source.platform]: snapshot } };
        let warning = '';
        cache = next;
        try { await persist(next); cacheWarning = ''; }
        catch (error) {
          // 原笔记已经提交，副本失败不能谎报“未保存”或把界面回退成旧状态。
          warning = `已读状态已写入 Obsidian，但本地副本更新失败：${error instanceof Error ? error.message : String(error)}`;
          cacheWarning = warning;
        }
        state = { sources: state.sources.map(item => item.platform === source.platform ? { ...source, ...snapshot } : item), warning };
        return state;
      });
      // 状态写入与设置刷新串行；失败不阻塞后续查询或重试。
      pending = operation.catch(() => state);
      return operation.then(library => ({ ok: true, library }), error => ({ ok: false,
        message: error instanceof Error ? error.message : '已读状态保存失败，请重试。' }));
    }
  };
}
