import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, truncate, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileError, FileSystem, JsonValue, Result } from '@earendil-works/pi-agent-core';
import type {
  ExecutionFailure, ExecutionMetrics, ExecutionResult, ModelIdentity, TokenUsage
} from '@shared/contracts/ai-execution';

type PiRuntime = Pick<typeof import('@earendil-works/pi-agent-core'),
  'BACKGROUND_CONTEXT' | 'FileError' | 'err' | 'ok'> & {
  NodeExecutionEnv: typeof import('@earendil-works/pi-agent-core/harness/env/nodejs').NodeExecutionEnv;
};

type RunStatus = ExecutionResult['status'];
type ToolState = 'returned' | 'not_started' | 'failed_or_unknown';

export interface JournalBase {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  agentKey: string;
  sessionId: string;
  seq: number;
  at: number;
}

export type ExecutionJournalEntry = JournalBase & (
  | { type: 'run.started'; data: { piVersion: string } }
  | { type: 'model.selected'; data: { model: ModelIdentity } }
  | { type: 'run.accepted'; data: { nativeOperationId: string; nativeSessionPath: string } }
  | { type: 'model.request_prepared'; data: { requestSeq: number; model: ModelIdentity; body: JsonValue } }
  | { type: 'tool.invoked'; data: {
    invocationId: string; attemptId: string; toolCallId: string; name: string; params: JsonValue;
  } }
  | { type: 'approval.decided'; data: {
    invocationId: string; attemptId: string; decision: 'approved' | 'declined';
    scope: 'tool' | 'preflight';
  } }
  | { type: 'tool.settled'; data: {
    invocationId: string; attemptId: string; state: ToolState;
    details?: JsonValue; failure?: ExecutionFailure;
  } }
  | { type: 'run.settled'; data: {
    status: RunStatus; failure?: ExecutionFailure; warning?: string; metrics?: ExecutionMetrics;
  } }
);

type JournalType = ExecutionJournalEntry['type'];
type JournalData<T extends JournalType> = Extract<ExecutionJournalEntry, { type: T }>['data'];

export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  agentKey: string;
  sessionId: string;
  nativeOperationId?: string;
  nativeSessionPath?: string;
  piVersion: string;
  startedAt: number;
  endedAt?: number;
  state: 'preparing' | 'running' | RunStatus;
  model?: ModelIdentity;
  failure?: ExecutionFailure;
  metrics?: ExecutionMetrics;
  recordState: 'complete' | 'partial';
  lastEventSeq: number;
  lastRequestSeq: number;
}

export interface PendingToolOutcome {
  invocationId: string;
  attemptId: string;
  state: ToolState;
  details?: JsonValue;
  failure?: ExecutionFailure;
}

export interface RunRecorder {
  readonly runId: string;
  readonly agentKey: string;
  readonly sessionId: string;
  readonly modelRequests: number;
  recordModelSelected(model: ModelIdentity): Promise<void>;
  recordRunAccepted(input: { nativeOperationId: string; nativeSessionPath: string }): Promise<void>;
  recordModelRequestPrepared(input: { model: ModelIdentity; body: JsonValue }): Promise<void>;
  recordToolInvocation(input: {
    invocationId: string; toolCallId: string; name: string; params: JsonValue;
  }): Promise<{ attemptId: string }>;
  recordApprovalDecision(input: {
    invocationId: string; decision: 'approved' | 'declined'; scope?: 'tool' | 'preflight';
  }): Promise<void>;
  recordToolResult(input: PendingToolOutcome): Promise<void>;
  recordRunSettled(input: {
    status: RunStatus; failure?: ExecutionFailure; warning?: string; metrics?: ExecutionMetrics;
  }): Promise<void>;
  pendingToolOutcomes(): readonly PendingToolOutcome[];
  close(): Promise<void>;
}

export interface BeginRunInput {
  runId: string;
  agentKey: string;
  sessionId: string;
  piVersion: string;
  onWriteFailure(error: unknown): void;
}

export interface ExecutionRecordStore {
  readonly fileSystem: FileSystem;
  beginRun(input: BeginRunInput): Promise<RunRecorder>;
  inspectRun(runId: string): Promise<RunRecord>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly RunStatus[] = ['completed', 'declined', 'aborted', 'failed', 'interrupted'];
const TOOL_STATES: readonly ToolState[] = ['returned', 'not_started', 'failed_or_unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ` + field);
}

function requireJson(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Circular JSON value');
    seen.add(value);
    for (const item of value) requireJson(item, seen);
    seen.delete(value);
    return;
  }
  if (isRecord(value)) {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid JSON object');
    if (seen.has(value)) throw new Error('Circular JSON value');
    seen.add(value);
    for (const item of Object.values(value)) requireJson(item, seen);
    seen.delete(value);
    return;
  }
  throw new Error('Invalid JSON value');
}

function requireModel(value: unknown): asserts value is ModelIdentity {
  if (!isRecord(value) || (value.mode !== 'online' && value.mode !== 'offline'))
    throw new Error('Invalid model identity');
  requireText(value.provider, 'model provider');
  requireText(value.modelId, 'model id');
}

function requireFailure(value: unknown): asserts value is ExecutionFailure {
  if (!isRecord(value) || !['network', 'http', 'timeout', 'model', 'tool', 'record', 'unknown'].includes(String(value.kind)))
    throw new Error('Invalid execution failure');
  requireText(value.code, 'failure code');
  if (value.httpStatus !== undefined && (!Number.isInteger(value.httpStatus) || Number(value.httpStatus) < 100))
    throw new Error('Invalid HTTP status');
}

function requireUsage(value: unknown): asserts value is TokenUsage {
  if (!isRecord(value)) throw new Error('Invalid token usage');
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0)
      throw new Error('Invalid token usage ' + field);
  }
  if (value.reasoning !== undefined &&
      (!Number.isSafeInteger(value.reasoning) || Number(value.reasoning) < 0))
    throw new Error('Invalid reasoning token usage');
}

function requireMetrics(value: unknown): asserts value is ExecutionMetrics {
  if (!isRecord(value) || !Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 0 ||
      !Number.isSafeInteger(value.modelRequests) || Number(value.modelRequests) < 0)
    throw new Error('Invalid execution metrics');
  if (value.usageStatus === 'unavailable') {
    if (value.usage !== undefined) throw new Error('Unavailable metrics contain token usage');
  } else if (value.usageStatus === 'complete' || value.usageStatus === 'partial') {
    requireUsage(value.usage);
  } else {
    throw new Error('Invalid execution usage status');
  }
}

function requireJournal(value: unknown): asserts value is ExecutionJournalEntry {
  if (!isRecord(value) || value.schemaVersion !== 1 || !UUID.test(String(value.eventId)) ||
      !UUID.test(String(value.runId)) || !Number.isSafeInteger(value.seq) || Number(value.seq) < 1 ||
      !Number.isSafeInteger(value.at) || Number(value.at) < 0 || !isRecord(value.data))
    throw new Error('Invalid execution journal entry');
  requireText(value.agentKey, 'agent key');
  requireText(value.sessionId, 'session id');
  const data = value.data;
  switch (value.type) {
    case 'run.started':
      requireText(data.piVersion, 'Pi version');
      break;
    case 'model.selected':
      requireModel(data.model);
      break;
    case 'run.accepted':
      requireText(data.nativeOperationId, 'native operation id');
      requireText(data.nativeSessionPath, 'native session path');
      break;
    case 'model.request_prepared':
      if (!Number.isSafeInteger(data.requestSeq) || Number(data.requestSeq) < 1)
        throw new Error('Invalid request sequence');
      requireModel(data.model);
      requireJson(data.body);
      break;
    case 'tool.invoked':
      requireText(data.invocationId, 'invocation id');
      requireText(data.attemptId, 'attempt id');
      requireText(data.toolCallId, 'tool call id');
      requireText(data.name, 'tool name');
      requireJson(data.params);
      break;
    case 'approval.decided':
      requireText(data.invocationId, 'invocation id');
      requireText(data.attemptId, 'attempt id');
      if (data.decision !== 'approved' && data.decision !== 'declined') throw new Error('Invalid approval decision');
      if (data.scope !== 'tool' && data.scope !== 'preflight') throw new Error('Invalid approval scope');
      break;
    case 'tool.settled':
      requireText(data.invocationId, 'invocation id');
      requireText(data.attemptId, 'attempt id');
      if (!TOOL_STATES.includes(data.state as ToolState)) throw new Error('Invalid tool state');
      if (data.details !== undefined) requireJson(data.details);
      if (data.failure !== undefined) requireFailure(data.failure);
      break;
    case 'run.settled':
      if (!STATUSES.includes(data.status as RunStatus)) throw new Error('Invalid run status');
      if (data.failure !== undefined) requireFailure(data.failure);
      if (data.warning !== undefined && typeof data.warning !== 'string') throw new Error('Invalid run warning');
      if (data.metrics !== undefined) requireMetrics(data.metrics);
      break;
    default:
      throw new Error('Unknown execution journal event');
  }
}

function project(previous: RunRecord | undefined, entry: ExecutionJournalEntry): RunRecord {
  if (entry.type === 'run.started') {
    if (previous) throw new Error('Duplicate run.started');
    return {
      schemaVersion: 1, runId: entry.runId, agentKey: entry.agentKey, sessionId: entry.sessionId,
      piVersion: entry.data.piVersion, startedAt: entry.at, state: 'preparing',
      recordState: 'complete', lastEventSeq: entry.seq, lastRequestSeq: 0
    };
  }
  if (!previous || previous.runId !== entry.runId || previous.agentKey !== entry.agentKey ||
      previous.sessionId !== entry.sessionId || entry.seq !== previous.lastEventSeq + 1 ||
      previous.endedAt !== undefined)
    throw new Error('Invalid run event order');
  const next = { ...previous, lastEventSeq: entry.seq };
  switch (entry.type) {
    case 'model.selected':
      next.model = entry.data.model;
      break;
    case 'run.accepted':
      next.nativeOperationId = entry.data.nativeOperationId;
      next.nativeSessionPath = entry.data.nativeSessionPath;
      next.state = 'running';
      break;
    case 'model.request_prepared':
      if (entry.data.requestSeq !== previous.lastRequestSeq + 1) throw new Error('Invalid request sequence');
      next.lastRequestSeq = entry.data.requestSeq;
      break;
    case 'run.settled':
      next.state = entry.data.status;
      next.endedAt = entry.at;
      next.failure = entry.data.failure;
      if (entry.data.metrics !== undefined) next.metrics = structuredClone(entry.data.metrics);
      break;
  }
  return next;
}

function fileError(error: unknown, runtime: PiRuntime, path?: string): FileError {
  if (error instanceof runtime.FileError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const nodeCode = 'code' in cause ? String(cause.code) : '';
  const code = nodeCode === 'ENOENT' ? 'not_found'
    : nodeCode === 'EACCES' || nodeCode === 'EPERM' ? 'permission_denied'
    : nodeCode === 'ENOTDIR' ? 'not_directory'
    : nodeCode === 'EISDIR' ? 'is_directory'
    : nodeCode === 'EINVAL' ? 'invalid'
    : 'unknown';
  return new runtime.FileError(code, cause.message, path, cause);
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..` + sep) && !isAbsolute(path));
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}

async function writeSummary(path: string, record: RunRecord): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp';
  let staged = false;
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    staged = true;
    try {
      await file.writeFile(JSON.stringify(record) + '\n', 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    staged = false;
    await syncDirectory(dirname(path));
  } finally {
    if (staged) await unlink(temporary).catch(() => undefined);
  }
}

async function summaryMatches(path: string, record: RunRecord): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    return await readFile(path, 'utf8') === JSON.stringify(record) + '\n';
  } catch {
    return false;
  }
}

function createNativeFileSystem(root: string, runtime: PiRuntime): FileSystem {
  const { FileError, err, ok, NodeExecutionEnv } = runtime;
  const base = new NodeExecutionEnv({ cwd: root });

  async function checked(path: string): Promise<string> {
    const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
    if (!inside(root, target)) throw new FileError('permission_denied', 'Path is outside native Session storage', path);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new FileError('permission_denied', 'Native Session root is not a directory', root);
    let cursor = root;
    for (const part of relative(root, target).split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new FileError('permission_denied', 'Symlink in native Session path', cursor);
      } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') break;
        throw error;
      }
    }
    return target;
  }

  async function guarded<T>(
    paths: string[], operation: (...resolved: string[]) => Promise<Result<T, FileError>>
  ): Promise<Result<T, FileError>> {
    try { return await operation(...await Promise.all(paths.map(checked))); }
    catch (error) { return err(fileError(error, runtime, paths[0])); }
  }

  async function durableWrite(
    path: string, content: string | Uint8Array, append: boolean, signal?: AbortSignal
  ): Promise<Result<void, FileError>> {
    return guarded([path], async target => {
      if (signal?.aborted) return err(new FileError('aborted', 'aborted', target));
      try {
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await checked(target);
        if (signal?.aborted) return err(new FileError('aborted', 'aborted', target));
        const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW |
          (append ? constants.O_APPEND : constants.O_TRUNC);
        const file = await open(target, flags, 0o600);
        try {
          await file.writeFile(content);
          await file.sync();
        } finally {
          await file.close();
        }
        return ok(undefined);
      } catch (error) {
        return err(fileError(error, runtime, target));
      }
    });
  }

  function safeAffix(value: string): boolean {
    return /^[a-zA-Z0-9._-]{0,80}$/.test(value) && value !== '..';
  }

  return {
    cwd: root,
    async absolutePath(path) {
      return guarded([path], async value => ok(value));
    },
    async joinPath(parts) {
      try { return await guarded([join(...parts)], async value => ok(value)); }
      catch (error) { return err(fileError(error, runtime)); }
    },
    async readTextFile(path, context) {
      return guarded([path], value => base.readTextFile(value, context));
    },
    async openTextLineReader(path, context) {
      return guarded([path], value => base.openTextLineReader(value, context));
    },
    async readTextLines(path, options, context) {
      return guarded([path], value => base.readTextLines(value, options, context));
    },
    async readBinaryFile(path, context) {
      return guarded([path], value => base.readBinaryFile(value, context));
    },
    async writeFile(path, content, context) {
      return durableWrite(path, content, false, context.abortSignal);
    },
    async appendFile(path, content, context) {
      return durableWrite(path, content, true, context.abortSignal);
    },
    async renameFile(sourcePath, destinationPath, context) {
      return guarded([sourcePath, destinationPath], async (source, destination) => {
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', destination));
        try {
          await rename(source, destination);
          await syncDirectory(dirname(destination));
          return ok(undefined);
        } catch (error) {
          return err(fileError(error, runtime, destination));
        }
      });
    },
    async fileInfo(path, context) {
      return guarded([path], value => base.fileInfo(value, context));
    },
    async listDir(path, context) {
      return guarded([path], value => base.listDir(value, context));
    },
    async canonicalPath(path, context) {
      return guarded([path], value => base.canonicalPath(value, context));
    },
    async exists(path, context) {
      return guarded([path], value => base.exists(value, context));
    },
    async createDir(path, options, context) {
      return guarded([path], value => base.createDir(value, options, context));
    },
    async remove(path, options, context) {
      return guarded([path], value => value === root
        ? Promise.resolve(err(new FileError('permission_denied', 'Cannot remove native Session root', value)))
        : base.remove(value, options, context));
    },
    async createTempDir(prefix, context) {
      const name = prefix || 'tmp-';
      if (!safeAffix(name) || name === '.')
        return err(new FileError('invalid', 'Invalid temporary directory prefix'));
      return guarded([root], async value => {
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted'));
        try { return ok(await mkdtemp(join(value, name))); }
        catch (error) { return err(fileError(error, runtime, value)); }
      });
    },
    async createTempFile(options, context) {
      const prefix = options?.prefix ?? '';
      const suffix = options?.suffix ?? '';
      if (!safeAffix(prefix) || !safeAffix(suffix))
        return err(new FileError('invalid', 'Invalid temporary file name'));
      return guarded([root], async value => {
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted'));
        const path = join(value, prefix + randomUUID() + suffix);
        try {
          const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await file.sync(); }
          finally { await file.close(); }
          return ok(path);
        } catch (error) {
          return err(fileError(error, runtime, path));
        }
      });
    },
    async cleanup() {
      // Operations open and close their own handles.
    }
  };
}

class Writer implements RunRecorder {
  readonly runId: string;
  readonly agentKey: string;
  readonly sessionId: string;
  readonly activeAttempts = new Map<string, string>();
  readonly pending = new Map<string, PendingToolOutcome>();
  readonly committed = new Set<string>();
  record: RunRecord | undefined;
  private tail: Promise<void> = Promise.resolve();
  private unhealthy: unknown;
  private closing?: Promise<void>;

  constructor(
    readonly file: FileHandle,
    readonly summaryPath: string,
    readonly nativeRoot: string,
    readonly input: BeginRunInput,
    readonly release: () => void
  ) {
    this.runId = input.runId;
    this.agentKey = input.agentKey;
    this.sessionId = input.sessionId;
  }

  get modelRequests(): number {
    return this.record?.lastRequestSeq ?? 0;
  }

  private fail(error: unknown): void {
    if (this.unhealthy !== undefined) return;
    this.unhealthy = error;
    if (this.record) this.record = { ...this.record, recordState: 'partial' };
    try { this.input.onWriteFailure(error); }
    catch { /* The recorder still rejects the original persistence error. */ }
  }

  private queue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Run recorder is closed'));
    const result = this.tail.then(action);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async appendLocked<T extends JournalType>(type: T, data: JournalData<T>, eventId: string): Promise<void> {
    if (this.unhealthy !== undefined) throw this.unhealthy;
    if (this.committed.has(eventId)) return;
    try {
      const entry = {
        schemaVersion: 1, eventId, runId: this.runId, agentKey: this.agentKey,
        sessionId: this.sessionId, seq: (this.record?.lastEventSeq ?? 0) + 1,
        at: Date.now(), type, data
      };
      requireJournal(entry);
      const next = project(this.record, entry);
      await this.file.writeFile(JSON.stringify(entry) + '\n', 'utf8');
      await this.file.sync();
      this.record = next;
      this.committed.add(eventId);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private append<T extends JournalType>(type: T, data: JournalData<T>): Promise<void> {
    const eventId = randomUUID();
    return this.queue(() => this.appendLocked(type, data, eventId));
  }

  start(piVersion: string): Promise<void> {
    return this.append('run.started', { piVersion });
  }

  recordModelSelected(model: ModelIdentity): Promise<void> {
    return this.append('model.selected', { model });
  }

  recordRunAccepted(input: { nativeOperationId: string; nativeSessionPath: string }): Promise<void> {
    const eventId = randomUUID();
    return this.queue(async () => {
      if (input.nativeOperationId !== this.runId ||
          !inside(this.nativeRoot, resolve(input.nativeSessionPath))) {
        const error = new Error('Invalid native operation identity');
        this.fail(error);
        throw error;
      }
      await this.appendLocked('run.accepted', input, eventId);
    });
  }

  recordModelRequestPrepared(input: { model: ModelIdentity; body: JsonValue }): Promise<void> {
    const eventId = randomUUID();
    return this.queue(() => this.appendLocked('model.request_prepared', {
      ...input, requestSeq: (this.record?.lastRequestSeq ?? 0) + 1
    }, eventId));
  }

  recordToolInvocation(input: {
    invocationId: string; toolCallId: string; name: string; params: JsonValue;
  }): Promise<{ attemptId: string }> {
    const eventId = randomUUID();
    const attemptId = randomUUID();
    return this.queue(async () => {
      if (this.activeAttempts.has(input.invocationId)) {
        const error = new Error('TOOL_ATTEMPT_ALREADY_ACTIVE');
        this.fail(error);
        throw error;
      }
      await this.appendLocked('tool.invoked', { ...input, attemptId }, eventId);
      this.activeAttempts.set(input.invocationId, attemptId);
      return { attemptId };
    });
  }

  recordApprovalDecision(input: {
    invocationId: string; decision: 'approved' | 'declined'; scope?: 'tool' | 'preflight';
  }): Promise<void> {
    const eventId = randomUUID();
    return this.queue(async () => {
      const attemptId = input.scope === 'preflight'
        ? randomUUID() : this.activeAttempts.get(input.invocationId);
      if (!attemptId) {
        const error = new Error('TOOL_ATTEMPT_MISSING');
        this.fail(error);
        throw error;
      }
      await this.appendLocked('approval.decided', {
        invocationId: input.invocationId, decision: input.decision,
        scope: input.scope === 'preflight' ? 'preflight' : 'tool', attemptId
      }, eventId);
    });
  }

  recordToolResult(input: PendingToolOutcome): Promise<void> {
    this.pending.set(input.attemptId, input);
    const eventId = randomUUID();
    return this.queue(async () => {
      if (this.activeAttempts.get(input.invocationId) !== input.attemptId) {
        const error = new Error('TOOL_ATTEMPT_MISMATCH');
        this.fail(error);
        throw error;
      }
      await this.appendLocked('tool.settled', input, eventId);
      this.pending.delete(input.attemptId);
      this.activeAttempts.delete(input.invocationId);
    });
  }

  recordRunSettled(input: {
    status: RunStatus; failure?: ExecutionFailure; warning?: string; metrics?: ExecutionMetrics;
  }): Promise<void> {
    const eventId = randomUUID();
    return this.queue(async () => {
      if (this.record?.endedAt === undefined) await this.appendLocked('run.settled', input, eventId);
      else if (this.record.state !== input.status) {
        const error = new Error('Run was already settled with another status');
        this.fail(error);
        throw error;
      }
      if (!this.record) throw new Error('Missing run record');
      try { await writeSummary(this.summaryPath, this.record); }
      catch (error) { this.fail(error); throw error; }
    });
  }

  pendingToolOutcomes(): readonly PendingToolOutcome[] {
    return [...this.pending.values()];
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.unhealthy !== undefined) throw this.unhealthy;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      await this.tail;
      try { await this.file.close(); }
      catch (error) { this.fail(error); throw error; }
      finally { this.release(); }
      if (this.unhealthy !== undefined) throw this.unhealthy;
    })();
    return this.closing;
  }
}

class RecordStore implements ExecutionRecordStore {
  readonly fileSystem: FileSystem;
  private readonly runsRoot: string;
  private readonly nativeRoot: string;
  private readonly active = new Map<string, Writer>();
  private readonly recovered = new Map<string, RunRecord>();
  private readonly recoveryErrors = new Map<string, Error>();
  private ready?: Promise<void>;
  private closed = false;

  constructor(root: string, private readonly runtime: PiRuntime) {
    this.runsRoot = join(root, 'runs');
    this.nativeRoot = join(root, 'native');
    this.fileSystem = createNativeFileSystem(this.nativeRoot, runtime);
  }

  private ensureReady(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Execution record store is closed'));
    if (!this.ready) {
      this.ready = this.initialize().catch(error => {
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.runsRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.nativeRoot, { recursive: true, mode: 0o700 });
    for (const path of [this.runsRoot, this.nativeRoot]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid execution record directory');
    }
    const files = await readdir(this.runsRoot);
    for (const file of files.filter(name => name.endsWith('.events.jsonl')).sort()) {
      const runId = file.slice(0, -'.events.jsonl'.length);
      if (!UUID.test(runId)) continue;
      try {
        const record = await this.recover(runId);
        this.recovered.set(runId, record);
        const summaryPath = join(this.runsRoot, runId + '.summary.json');
        if (!await summaryMatches(summaryPath, record)) await writeSummary(summaryPath, record);
      } catch (error) {
        this.recoveryErrors.set(runId, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async recover(runId: string): Promise<RunRecord> {
    const path = join(this.runsRoot, runId + '.events.jsonl');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid run journal file');
    const content = await readFile(path);
    const newline = content.lastIndexOf(10);
    const completeLength = newline + 1;
    let partial = completeLength !== content.length;
    if (partial) {
      await truncate(path, completeLength);
      const handle = await open(path, 'r+');
      try { await handle.sync(); }
      finally { await handle.close(); }
    }
    const lines = content.subarray(0, completeLength).toString('utf8').split('\n').filter(Boolean);
    let record: RunRecord | undefined;
    const eventIds = new Set<string>();
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      requireJournal(parsed);
      if (parsed.runId !== runId || eventIds.has(parsed.eventId)) throw new Error('Invalid run journal identity');
      if (parsed.seq !== (record?.lastEventSeq ?? 0) + 1) throw new Error('Invalid run journal sequence');
      eventIds.add(parsed.eventId);
      record = project(record, parsed);
    }
    if (!record) throw new Error('Run journal contains no committed start event');
    let native: Awaited<ReturnType<RecordStore['nativeOutcome']>>;
    try { native = await this.nativeOutcome(record); }
    catch { partial = true; }
    if (native) {
      if (record.endedAt === undefined) {
        record.state = native.status;
        record.endedAt = native.endedAt;
        record.failure = native.failure;
        partial = true;
      } else if (native.status !== record.state) {
        record.state = native.status;
        record.failure = native.failure;
        partial = true;
      }
    } else if (record.nativeOperationId) {
      partial = true;
    }
    if (record.endedAt === undefined) {
      record.state = 'interrupted';
      record.endedAt = Date.now();
      partial = true;
    }
    record.recordState = partial ? 'partial' : 'complete';
    return record;
  }

  private async nativeOutcome(record: RunRecord): Promise<{
    status: RunStatus; endedAt: number; failure?: ExecutionFailure;
  } | undefined> {
    if (!record.nativeOperationId || !record.nativeSessionPath ||
        !inside(this.nativeRoot, resolve(record.nativeSessionPath))) return undefined;
    const loaded = await this.fileSystem.readTextFile(record.nativeSessionPath, this.runtime.BACKGROUND_CONTEXT);
    if (!loaded.ok) return undefined;
    const content = loaded.value;
    const complete = content.slice(0, content.lastIndexOf('\n') + 1);
    let result: { status: RunStatus; endedAt: number; failure?: ExecutionFailure } | undefined;
    for (const line of complete.split('\n')) {
      if (!line) continue;
      const parsed: unknown = JSON.parse(line);
      for (const write of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!isRecord(write) || write.kind !== 'value' || write.op !== 'set' ||
            write.namespace !== 'pi.result' || write.key !== record.nativeOperationId ||
            !isRecord(write.value) || !STATUSES.includes(write.value.status as RunStatus)) continue;
        const nativeError = write.value.error;
        const code = isRecord(nativeError) && typeof nativeError.code === 'string' &&
          /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(nativeError.code)
          ? nativeError.code : 'NATIVE_OPERATION_FAILED';
        result = {
          status: write.value.status as RunStatus,
          endedAt: typeof write.value.endedAt === 'number' ? write.value.endedAt : Date.now(),
          ...(write.value.status === 'failed' ? { failure: { kind: 'unknown' as const, code } } : {})
        };
      }
    }
    return result;
  }

  async beginRun(input: BeginRunInput): Promise<RunRecorder> {
    await this.ensureReady();
    if (!UUID.test(input.runId)) throw new Error('runId must be a UUID');
    requireText(input.agentKey, 'agent key');
    requireText(input.sessionId, 'session id');
    requireText(input.piVersion, 'Pi version');
    if (this.active.has(input.runId) || this.recovered.has(input.runId) || this.recoveryErrors.has(input.runId))
      throw new Error('Run id already exists');
    const path = join(this.runsRoot, input.runId + '.events.jsonl');
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try { await syncDirectory(this.runsRoot); }
    catch (error) {
      await file.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    }
    const writer = new Writer(file, join(this.runsRoot, input.runId + '.summary.json'), this.nativeRoot, input, () => {
      this.active.delete(input.runId);
      if (writer.record) this.recovered.set(input.runId, writer.record);
    });
    this.active.set(input.runId, writer);
    try {
      await writer.start(input.piVersion);
      return writer;
    } catch (error) {
      this.active.delete(input.runId);
      await writer.close().catch(() => undefined);
      throw error;
    }
  }

  async inspectRun(runId: string): Promise<RunRecord> {
    await this.ensureReady();
    if (!UUID.test(runId)) throw new Error('Invalid run id');
    const error = this.recoveryErrors.get(runId);
    if (error) throw new Error('Run journal recovery failed', { cause: error });
    const record = this.active.get(runId)?.record ?? this.recovered.get(runId);
    if (!record) throw new Error('Run record not found');
    return structuredClone(record);
  }

  async flush(): Promise<void> {
    await this.ensureReady();
    const results = await Promise.allSettled([...this.active.values()].map(writer => writer.flush()));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.ready) await this.ready;
    const results = await Promise.allSettled([...this.active.values()].map(writer => writer.close()));
    this.closed = true;
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

export async function createExecutionRecordStore(options: { root: string }): Promise<ExecutionRecordStore> {
  if (!isAbsolute(options.root)) throw new Error('Execution record root must be absolute');
  const [pi, node] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    import('@earendil-works/pi-agent-core/harness/env/nodejs')
  ]);
  return new RecordStore(resolve(options.root), {
    BACKGROUND_CONTEXT: pi.BACKGROUND_CONTEXT,
    FileError: pi.FileError,
    err: pi.err,
    ok: pi.ok,
    NodeExecutionEnv: node.NodeExecutionEnv
  });
}
