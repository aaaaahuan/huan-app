import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AlgorithmLibrary, SetCompletedInput, SetCompletedResult } from '@shared/contracts/algorithms';
import { parseAlgorithms, updateAlgorithmCompletion } from './markdown';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function readSource(path: string) {
  const source = await lstat(path);
  if (!source.isFile()) throw new Error('只读取普通 Markdown 文件，不使用目录或符号链接。');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!sameFile(source, before) || !before.isFile()) throw new Error('笔记读取期间发生变化，请刷新后重试。');
    const bytes = await file.readFile();
    if (bytes.length !== before.size || !sameFile(before, await file.stat()) || !sameFile(before, await lstat(path)))
      throw new Error('笔记读取期间发生变化，请刷新后重试。');
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), stat: before };
  } finally { await file.close(); }
}

export function createAlgorithmLibrary(path: string) {
  let initialized = false;
  let state: AlgorithmLibrary = { path, state: 'error', message: '', items: [] };
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
  async function reload() {
    initialized = true;
    try { state = { path, state: 'ready', message: '', items: parseAlgorithms((await readSource(path)).text) }; }
    catch (error) {
      // 最近有效数据只保留在内存中，读取失败时标记只读，不以副本覆盖源文件。
      state = { ...state, state: 'error', message: message(error) };
    }
    return state;
  }
  return {
    get: () => serialize(() => initialized ? Promise.resolve(state) : reload()),
    refresh: () => serialize(reload),
    setCompleted: (input: SetCompletedInput): Promise<SetCompletedResult> => serialize(async () => {
      try {
        if (state.state !== 'ready') throw new Error('笔记尚未正常读取，请先刷新笔记再勾选。');
        const original = await readSource(path);
        const updated = updateAlgorithmCompletion(original.text, input.id, input.completed, input.expectedCompleted);
        const items = parseAlgorithms(updated);
        if (updated !== original.text) {
          const temporary = join(dirname(path), `.huan-algorithm-${randomUUID()}.tmp`);
          try {
            const file = await open(temporary, 'wx', original.stat.mode & 0o777);
            try { await file.writeFile(updated, 'utf8'); await file.sync(); }
            finally { await file.close(); }
            // 乐观冲突检查，不是跨应用文件锁；Obsidian 同时编辑时拒绝覆盖旧快照。
            const latest = await readSource(path);
            if (!sameFile(original.stat, latest.stat) || original.text !== latest.text)
              throw new Error('写入前笔记已被其他操作修改，请刷新后重试。');
            await rename(temporary, path);
          } finally { await unlink(temporary).catch(() => undefined); }
        }
        state = { path, state: 'ready', message: '', items };
        return { ok: true, library: state };
      } catch (error) {
        state = { ...state, state: 'error', message: message(error) };
        return { ok: false, message: state.message, library: state };
      }
    })
  };
}
