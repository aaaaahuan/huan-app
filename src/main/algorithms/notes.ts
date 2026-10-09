import { createHash, randomUUID } from 'node:crypto';
import { constants, watch, type FSWatcher, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isMap, parseDocument, stringify } from 'yaml';
import type { AlgorithmNote, AlgorithmProblem, SaveAlgorithmNoteResult } from '@shared/contracts/algorithms';

const LIMIT = 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export const noteError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return '无法读写心得，请检查目录权限及 iCloud 下载状态。';
  return error instanceof Error ? error.message : '心得操作失败，请重试。';
};

function frontmatter(content: string) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return undefined;
  if (match[1].length > 16 * 1024) throw new Error('心得的 YAML 属性超过 16 KB。');
  const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error('心得的 YAML 属性格式无效，请在 Obsidian 中修正。');
  return { document, body: content.slice(match[0].length), bom: content.startsWith('\uFEFF') ? '\uFEFF' : '' };
}

function keyOf(content: string): string | undefined {
  const value: unknown = frontmatter(content)?.document.get('problem_key');
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error('problem_key 必须是非空字符串。');
  return value;
}

function safeName(value: string) {
  const printable = Array.from(value.normalize('NFC'), character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '-' : character).join('');
  const name = printable.replace(/[/\\:*?"<>|]/g, '-').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 80);
  return name || '未命名';
}

function fileName(problem: AlgorithmProblem) {
  const numbered = /^(\d+)\.\s*(.+)$/.exec(problem.title);
  return (numbered ? `${numbered[1].padStart(4, '0')}-${safeName(numbered[2])}` : safeName(problem.title)) + '.md';
}

function template(problem: AlgorithmProblem) {
  return `---\n${stringify({ problem_key: problem.noteKey, source: problem.url, tags: ['算法'] })}---\n\n# ${problem.title}\n\n## 我的思路\n\n## 解法与代码\n\n## 时间和空间复杂度\n\n## 卡点与易错点\n\n## 下次遇到如何识别\n\n## 复盘记录\n`;
}

export function createAlgorithmNotes(directory: string, changed: () => void) {
  const vault = resolve(directory);
  const root = join(vault, 'project', 'algorithm-training');
  let watcher: FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
  function invalidate() {
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (!closed) changed(); }, 250);
  }
  function ensureWatch() {
    if (watcher || closed) return;
    try {
      // 监听目录而非文件 inode，覆盖 Obsidian 原子替换、改名和首次创建目录。
      watcher = watch(vault, { recursive: true }, (_event, filename) => {
        const path = filename ? resolve(vault, filename) : root;
        const local = relative(root, path);
        if (!local || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`))) invalidate();
      });
      watcher.on('error', () => { watcher?.close(); watcher = undefined; invalidate(); });
    } catch { /* 监听不可用时仍以窗口聚焦、手动刷新和保存前重读兜底。 */ }
  }

  async function checkParents(target: string, create = false) {
    const local = relative(root, target);
    if (!local || isAbsolute(local) || local.split(sep).some(part => part === '..' || part.startsWith('.')) || extname(target) !== '.md')
      throw new Error('只允许操作算法心得目录内的非隐藏 Markdown 文件。');
    const info = await lstat(vault);
    if (!info.isDirectory() || await realpath(vault) !== vault) throw new Error('笔记库必须是本机普通目录，不支持符号链接。');
    let current = vault;
    for (const part of relative(vault, dirname(target)).split(sep)) {
      current = join(current, part);
      try {
        if (!(await lstat(current)).isDirectory()) throw new Error('心得路径不允许符号链接或非目录父节点。');
      } catch (error) {
        if (!missing(error)) throw error;
        if (!create) break;
        await mkdir(current);
        if (!(await lstat(current)).isDirectory()) throw new Error('心得目录创建期间发生变化。', { cause: error });
      }
    }
  }

  async function readBounded(target: string) {
    await checkParents(target);
    const source = await lstat(target);
    if (!source.isFile() || source.size > LIMIT) throw new Error('只支持不超过 1 MB 的普通 Markdown 心得，不读取符号链接。');
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!sameFile(source, before)) throw new Error('心得读取期间发生变化，请重试。');
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length !== before.size || !sameFile(before, await file.stat()) || !sameFile(before, await lstat(target)))
        throw new Error('心得读取期间发生变化，请重试。');
      return { content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)), stat: before };
    } finally { await file.close(); }
  }

  async function read(target: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([readBounded(target), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('心得读取超时，请确认 iCloud 文件已下载到本机。')), 10_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function scan() {
    await checkParents(join(root, 'check.md'));
    const index = new Map<string, { path: string; content: string; stat: Stats }>();
    let entries = 0;
    let bytes = 0;
    async function visit(directory: string, depth: number) {
      if (depth > 10) throw new Error('心得目录层级超过 10 层。');
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (missing(error)) return; throw error; }
      for (const entry of children) {
        if (entry.name.startsWith('.') || (directory === root && entry.name === '冲突副本')) continue;
        if (++entries > 2000) throw new Error('心得目录超过 2000 个条目，请缩小目录范围。');
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`心得目录不支持符号链接：${relative(root, path)}`);
        if (entry.isDirectory()) {
          await checkParents(join(path, 'check.md'));
          await visit(path, depth + 1);
        } else if (entry.isFile() && extname(entry.name) === '.md') {
          const value = await read(path);
          bytes += value.stat.size;
          if (bytes > 64 * LIMIT) throw new Error('心得目录的 Markdown 总量超过 64 MB，请缩小目录范围。');
          let key;
          try { key = keyOf(value.content); }
          catch (error) { throw new Error(`${relative(root, path)}：${noteError(error)}`, { cause: error }); }
          if (!key) continue;
          if (index.has(key)) throw new Error(`同一道题存在两篇心得：${relative(root, index.get(key)!.path)} 和 ${relative(root, path)}。请保留一篇的 problem_key。`);
          index.set(key, { path, ...value });
        }
      }
    }
    await visit(root, 0);
    ensureWatch();
    return index;
  }

  function snapshot(problem: AlgorithmProblem, index: Awaited<ReturnType<typeof scan>>): AlgorithmNote {
    const found = index.get(problem.noteKey);
    return found ? { problemKey: problem.noteKey, path: found.path, content: found.content, revision: digest(found.content), exists: true } :
      { problemKey: problem.noteKey, path: join(root, safeName(problem.category), fileName(problem)), content: template(problem), revision: null, exists: false };
  }

  async function write(target: string, content: string, original?: { content: string; stat: Stats }) {
    await checkParents(target, true);
    const temporary = join(dirname(target), `.huan-algorithm-note-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', original ? original.stat.mode & 0o777 : 0o600);
      try { await file.writeFile(content, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await checkParents(target);
      if (original) {
        const latest = await read(target);
        if (!sameFile(original.stat, latest.stat) || latest.content !== original.content) throw new Error('写入前心得已变化，请刷新对比后重试。');
        await rename(temporary, target);
      } else {
        // 新建采用不覆盖的 link 提交，不能用 rename 覆盖恰好出现的同名文件。
        await link(temporary, target);
      }
      invalidate();
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  return {
    get: (problem: AlgorithmProblem) => serialize(async () => snapshot(problem, await scan())),
    index: () => serialize(async () => [...(await scan()).keys()]),
    save: (problem: AlgorithmProblem, content: string, expectedRevision: string | null): Promise<SaveAlgorithmNoteResult> => serialize(async () => {
      try {
        if (Buffer.byteLength(content) > LIMIT) throw new Error('单篇心得不能超过 1 MB。');
        if (keyOf(content) !== problem.noteKey) throw new Error('请保留 YAML 中的 problem_key，不要修改或删除题目关联标识。');
        const index = await scan();
        const current = snapshot(problem, index);
        if (current.revision !== expectedRevision) return { ok: false, kind: 'conflict', message: 'Obsidian 或其他操作已修改心得。草稿已保留，请先对比，不会覆盖外部版本。', note: current };
        if (!current.exists || current.content !== content) await write(current.path, content, index.get(problem.noteKey));
        return { ok: true, note: { ...current, content, revision: digest(content), exists: true } };
      } catch (error) { return { ok: false, kind: 'error', message: noteError(error) }; }
    }),
    copy: (problem: AlgorithmProblem, content: string) => serialize(async () => {
      if (Buffer.byteLength(content) > LIMIT) throw new Error('单篇心得不能超过 1 MB。');
      let parts: ReturnType<typeof frontmatter>;
      // 属性写坏时副本仍能救出原文；副本目录不参与正式心得索引。
      try { parts = frontmatter(content); } catch { parts = undefined; }
      if (parts) {
        // 副本不拥有题目身份，避免下一次索引时被识别为第二篇正式心得。
        parts.document.delete('problem_key');
        parts.document.set('conflict_of', problem.noteKey);
        content = `${parts.bom}---\n${parts.document.toString()}---\n${parts.body}`;
      }
      const stem = fileName(problem).slice(0, -3);
      const target = join(root, '冲突副本', `${stem}-${Date.now()}-${randomUUID().slice(0, 8)}.md`);
      await write(target, content);
      return target;
    }),
    close() { closed = true; watcher?.close(); clearTimeout(debounce); }
  };
}
