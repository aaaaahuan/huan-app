import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { NoteWrite } from '@shared/contracts/ai';

export type NoteProposal = NoteWrite & { root: string; content: string };
const MAX_BYTES = 64 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

// 复用 Pi 的参数、分段读取和精确编辑；只替换其文件 I/O，集中约束笔记目录。
export async function createNoteTools(directory: string,
  approve: (proposal: NoteProposal, signal?: AbortSignal) => Promise<boolean>,
  onWritten: (write: NoteWrite) => void): Promise<AgentTool[]> {
  const { createReadTool, createWriteTool, createEditTool } = await import('@earendil-works/pi-coding-agent');
  const root = await realpath(directory);
  if (!(await lstat(root)).isDirectory()) throw new Error('笔记库目录不存在。');

  async function checked(path: string): Promise<string> {
    if (await realpath(root) !== root) throw new Error('笔记根目录已变化，请重新配置。');
    const target = resolve(path);
    const local = relative(root, target);
    const parts = local.split(sep);
    if (!local || isAbsolute(local) || parts.some(part => part === '..' || part.startsWith('.')) ||
      !['.md', '.markdown'].includes(extname(target).toLowerCase())) throw new Error('只允许访问笔记库内非隐藏的 Markdown 文件。');
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (current !== target && !info.isDirectory())) throw new Error('笔记路径不允许符号链接或非目录父节点。');
      } catch (error) { if (!missing(error)) throw error; }
    }
    return target;
  }

  async function read(path: string) {
    const target = await checked(path);
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('只支持不超过 64 KB 的 Markdown 笔记。');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_BYTES) throw new Error('笔记超过 64 KB。');
      const bytes = buffer.subarray(0, length);
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes;
    } finally { await file.close(); }
  }

  async function commit(path: string, content: string, original: Buffer | undefined,
    operation: NoteWrite['operation'], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const target = await checked(path);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('单次笔记写入不能超过 64 KB。');
    const assertUnchanged = async () => {
      if (original) {
        if (!(await read(target)).equals(original)) throw new Error('笔记已被其他操作修改，请重新读取后再编辑。');
      } else {
        try { await lstat(target); }
        catch (error) { if (missing(error)) return; throw error; }
        throw new Error('文件已存在，请先 read 再用 edit 修改，不允许 write 覆盖。');
      }
    };
    await assertUnchanged();
    if (!await approve({ root, path: relative(root, target), content, operation }, signal)) throw new Error('用户取消了保存，文件未写入。');
    signal?.throwIfAborted();
    await checked(target);
    await mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.huan-note-${randomUUID()}.tmp`);
    try {
      const mode = original ? (await lstat(target)).mode & 0o777 : 0o600;
      const file = await open(temporary, 'wx', mode);
      try { await file.writeFile(content, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await checked(target);
      await assertUnchanged();
      signal?.throwIfAborted();
      // 新建用 link 防止覆盖同时出现的同名文件；更新用原子替换，保留乐观冲突检查。
      if (original) await rename(temporary, target);
      else await link(temporary, target);
      // 提交后即使模型停止，也必须先发回执，不能声称已撤销文件写入。
      onWritten({ path: target, operation });
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  const readTool = createReadTool(root, { operations: { readFile: read,
    access: async path => { await checked(path); }, detectImageMimeType: async () => null } });
  const writeTool = createWriteTool(root);
  const editTool = createEditTool(root);
  const guardedWrite: typeof writeTool = {
    ...writeTool, description: '在笔记库内新建 Markdown 文件，不覆盖已有文件。保存前需用户确认。',
    execute(id, input, signal, update) {
      return createWriteTool(root, { operations: {
        // 目录创建也延后到用户确认之后。
        mkdir: async () => {},
        writeFile: (path, content) => commit(path, content, undefined, 'write', signal)
      } }).execute(id, input, signal, update);
    }
  };
  const guardedEdit: typeof editTool = {
    ...editTool, description: editTool.description + ' 仅允许笔记库内 Markdown，保存前需用户确认。',
    execute(id, input, signal, update) {
      let original: Buffer | undefined;
      return createEditTool(root, { operations: {
        access: async path => { await checked(path); },
        readFile: async path => { original = await read(path); return original; },
        writeFile: (path, content) => commit(path, content, original, 'edit', signal)
      } }).execute(id, input, signal, update);
    }
  };
  return [readTool, guardedWrite, guardedEdit];
}
