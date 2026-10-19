import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentHarnessTool, AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@earendil-works/pi-ai';
import type { NoteWrite } from '@shared/contracts/ai';
import type { ReaderToolContext } from './reading-agent';

export type NoteProposal = NoteWrite & { root: string; content: string };
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

function nativeTool<P extends TSchema, D>(tool: AgentTool<P, D>): AgentHarnessTool<ReaderToolContext, P, D> {
  return {
    ...tool,
    async execute(callId, params, onUpdate, _scope, _invocation, context) {
      const signal = context.abortSignal;
      signal?.throwIfAborted();
      let abort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => reject(signal?.reason ?? new Error('笔记读取已取消。'));
          signal?.addEventListener('abort', abort, { once: true });
        });
        return await Promise.race([tool.execute(callId, params, signal, onUpdate), cancelled]);
      } finally {
        if (abort) signal?.removeEventListener('abort', abort);
      }
    }
  };
}

export async function createReaderNoteTools(scope: ReaderToolContext): Promise<AgentHarnessTool<ReaderToolContext>[]> {
  const { createReadTool, createWriteTool, createEditTool, truncateHead } = await import('@earendil-works/pi-coding-agent');
  const root = await realpath(scope.notesPath);
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

  async function read(path: string, signal?: AbortSignal) {
    const target = await checked(path);
    signal?.throwIfAborted();
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error('笔记路径不是普通文件。');
      const bytes = await file.readFile({ signal });
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes;
    } finally { await file.close(); }
  }

  async function commit(path: string, content: string, original: Buffer | undefined,
    operation: NoteWrite['operation'], invocationId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const target = await checked(path);
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
    if (!await scope.approveNoteWrite({ root, path: relative(root, target), content, operation }, invocationId, signal))
      throw new Error('用户取消了保存，文件未写入。');
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
      if (original) await rename(temporary, target);
      else await link(temporary, target);
      const write = { path: target, operation };
      scope.onNoteWritten(write);
      return write;
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  const readTool = createReadTool(root, { operations: { readFile: read,
    access: async path => { await checked(path); }, detectImageMimeType: async () => null } });
  const readLimits = { maxBytes: 100 * 1024, maxLines: 10000 };
  readTool.description = '读取笔记库内 Markdown 文件。每次最多返回 100 KB 或 10000 行（先到者为准），按完整行截断；offset 为从 1 开始的行号，limit 为读取行数，超限后按提示继续读取。';
  // Pi 的 read 没有截断配置入口；只替换文本回执，继续使用上方的安全读取。
  readTool.execute = async (_callId, { path, offset = 1, limit }, signal) => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 1 || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)))
      throw new Error('offset 和 limit 必须为正整数。');
    const bytes = await read(resolve(root, path), signal);
    signal?.throwIfAborted();
    const lines = bytes.toString('utf8').split('\n');
    const start = offset - 1;
    if (start >= lines.length) throw new Error(`读取起始行 ${offset} 超出文件范围（共 ${lines.length} 行）。`);
    const end = limit === undefined ? lines.length : Math.min(start + limit, lines.length);
    const truncation = truncateHead(lines.slice(start, end).join('\n'), readLimits);
    let text = truncation.content;
    if (truncation.firstLineExceedsLimit) {
      text = `[第 ${offset} 行超过 100 KB，无法按完整行返回；offset / limit 不能拆分单行。]`;
    } else if (truncation.truncated || end < lines.length) {
      const nextOffset = truncation.truncated ? offset + truncation.outputLines : end + 1;
      text += `\n\n[已返回第 ${offset}-${nextOffset - 1} 行，共 ${lines.length} 行；使用 offset=${nextOffset} 继续读取。]`;
    }
    return { content: [{ type: 'text', text }], details: truncation.truncated ? { truncation } : undefined };
  };
  const writeTool = createWriteTool(root);
  const editTool = createEditTool(root);
  const guardedWrite: AgentHarnessTool<ReaderToolContext, typeof writeTool.parameters> = {
    ...writeTool,
    description: '在笔记库内新建 Markdown 文件，不覆盖已有文件。保存前需用户确认。',
    async execute(callId, params, onUpdate, _context, invocation, execution) {
      const signal = execution.abortSignal;
      let write: NoteWrite | undefined;
      const result = await createWriteTool(root, { operations: {
        mkdir: async () => {},
        writeFile: async (path, content) => { write = await commit(path, content, undefined, 'write', invocation.invocationId, signal); }
      } }).execute(callId, params, signal, onUpdate);
      return { ...result, details: { write } };
    }
  };
  const guardedEdit: AgentHarnessTool<ReaderToolContext, typeof editTool.parameters> = {
    ...editTool,
    description: editTool.description + ' 仅允许笔记库内 Markdown，保存前需用户确认。',
    async execute(callId, params, onUpdate, _context, invocation, execution) {
      const signal = execution.abortSignal;
      let original: Buffer | undefined;
      let write: NoteWrite | undefined;
      const result = await createEditTool(root, { operations: {
        access: async path => { await checked(path); },
        readFile: async path => { original = await read(path); return original; },
        writeFile: async (path, content) => { write = await commit(path, content, original, 'edit', invocation.invocationId, signal); }
      } }).execute(callId, params, signal, onUpdate);
      return { ...result, details: { result: result.details ?? null, write } };
    }
  };
  return [nativeTool(readTool), guardedWrite, guardedEdit];
}
