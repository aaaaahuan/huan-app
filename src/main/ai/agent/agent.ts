import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  AgentHarnessOptions, AgentHarnessTool, AgentMessage, HookHandler, Entry, OperationResultRecord
} from '@earendil-works/pi-agent-core';
import type { ModelTarget } from '@shared/contracts/models';
import type {
  ModelIdentity, ExecutionEvent, ExecutionResult, ExecutionFailure, ExecutionMetrics
} from '@shared/contracts/ai-execution';
import type { ExecutionRecordStore, RunRecorder } from '../core/records';
import type { PiAdapter } from '../core/pi-adapter';

export type RecordApprovalDecision = (input: {
  invocationId: string;
  decision: 'approved' | 'declined';
  scope?: 'tool' | 'preflight';
}) => Promise<void>;

export interface PiHistoryReader {
  inspect(runId: string): Promise<{ entries: Entry[]; outcomes: OperationResultRecord[] }>;
}

export interface AgentConfig<C extends object> {
  key: string;
  history: 'session' | 'isolated';
  systemPrompt: AgentHarnessOptions<C>['systemPrompt'];
  tools?: AgentHarnessTool<C>[];
  transform_context?: HookHandler<'transform_context'>;
  createTransformContext?: (reader: PiHistoryReader) => HookHandler<'transform_context'>;
  thinkingLevel?: AgentHarnessOptions<C>['thinkingLevel'];
  toolExecution?: AgentHarnessOptions<C>['toolExecution'];
  temperature?: number;
  maxOutputTokens?: number;
  resolveModelTarget?: (input: { runId: string; signal: AbortSignal }) => Promise<ModelTarget>;
}

export interface PreparedInput<C extends object> {
  prompt: string | AgentMessage[];
  toolContext: C;
  tools?: AgentHarnessTool<C>[];
  toolError?: string;
}

export type ExecuteRequest<C extends object> = { runId: string; sessionId?: string } & (
  PreparedInput<C> | {
    prepare(input: {
      signal: AbortSignal;
      model: ModelIdentity;
      recordApprovalDecision: RecordApprovalDecision;
    }): Promise<PreparedInput<C>>;
  }
);

export interface ExecuteOptions {
  signal?: AbortSignal;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface AgentHandle<C extends object> {
  readonly key: string;
  execute(request: ExecuteRequest<C>, options?: ExecuteOptions): Promise<ExecutionResult>;
  newSession(): Promise<{ sessionId: string }>;
  close(): Promise<void>;
}

export interface AgentDependencies {
  piAdapter: PiAdapter;
  records: ExecutionRecordStore;
  resolveModelTarget: (input: { runId: string; signal: AbortSignal }) => Promise<ModelTarget>;
}

export function publicModelIdentity(target: ModelTarget): ModelIdentity {
  return { mode: target.provider === 'Qwen-3.5-4B-local' ? 'offline' : 'online',
    provider: target.provider, modelId: target.modelId };
}

function failure(error: unknown): ExecutionFailure {
  if (error instanceof DOMException && error.name === 'TimeoutError') return { kind: 'timeout', code: 'TIMEOUT' };
  if (error instanceof Error && error.name === 'AbortError') return { kind: 'unknown', code: 'ABORTED' };
  return { kind: 'unknown', code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'EXECUTION_FAILED' };
}

function partial(error: unknown): ExecutionResult['record'] {
  return { state: 'partial', warning: error instanceof Error ? error.message : '执行记录写入失败。' };
}

export function createAgentHandle<C extends object>(config: AgentConfig<C>, dependencies: AgentDependencies): AgentHandle<C> {
  let closed = false;
  let active: { controller: AbortController; done: Promise<ExecutionResult> } | undefined;
  const sessions = new Map<string, {
    id: string;
    metadata?: Awaited<ReturnType<PiAdapter['execute']>>['metadata'];
  }>();
  let defaultSessionId = randomUUID();

  async function execute(request: ExecuteRequest<C>, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    if (closed) throw new Error('AGENT_CLOSED');
    if (active) throw new Error('AGENT_BUSY');
    const runId = request.runId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))
      throw new Error('INVALID_RUN_ID');
    const started = performance.now();
    const metrics = (modelRequests: number, observed?: NonNullable<Awaited<ReturnType<PiAdapter['execute']>>['observedUsage']>): ExecutionMetrics => ({
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      modelRequests,
      usageStatus: !observed?.usage ? 'unavailable' : observed.responses === modelRequests ? 'complete' : 'partial',
      ...(observed?.usage ? { usage: observed.usage } : {})
    });
    const logicalSessionId = request.sessionId ?? defaultSessionId;
    const savedSession = config.history === 'session' ? sessions.get(logicalSessionId) : undefined;
    const sessionId = config.history === 'isolated' ? randomUUID() : savedSession?.id ?? logicalSessionId;
    const controller = new AbortController();
    const recordAbort = new AbortController();
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, controller.signal, recordAbort.signal]);
    let recordFailure: ExecutionFailure | undefined;
    let lastEventSeq = 0;

    const done = (async (): Promise<ExecutionResult> => {
      let recorder: RunRecorder;
      try {
        recorder = await dependencies.records.beginRun({
          runId, agentKey: config.key, sessionId, piVersion: '0.87.1',
          onWriteFailure(error) {
            recordFailure = { kind: 'record', code: 'RECORD_WRITE_FAILED' };
            recordAbort.abort(error);
          }
        });
      } catch (error) {
        return { runId, sessionId, status: 'failed', messages: [], failure: failure(error),
          metrics: metrics(0), record: partial(error) };
      }

      let native: Awaited<ReturnType<PiAdapter['execute']>>;
      let adapterStarted = false;
      try {
        signal.throwIfAborted();
        const target = await (config.resolveModelTarget ?? dependencies.resolveModelTarget)({ runId, signal });
        const model = publicModelIdentity(target);
        await recorder.recordModelSelected(model);
        const input = 'prepare' in request
          ? await request.prepare({ signal, model, recordApprovalDecision: value => recorder.recordApprovalDecision(value) })
          : request;
        signal.throwIfAborted();
        adapterStarted = true;
        native = await dependencies.piAdapter.execute({
          agentKey: config.key, sessionId, runId,
          session: savedSession?.metadata ? { kind: 'existing', metadata: savedSession.metadata } : { kind: 'new' },
          config, input, target, recorder
        }, { signal, onEvent(event) {
          lastEventSeq = Math.max(lastEventSeq, event.seq);
          options.onEvent?.(event);
        } });
        if (config.history === 'session') {
          if (native.metadata && native.status !== 'interrupted')
            sessions.set(logicalSessionId, { id: sessionId, metadata: native.metadata });
          else {
            sessions.set(logicalSessionId, { id: randomUUID() });
            native.warning = '原生会话中断，后续对话已切换到新会话。';
          }
        }
      } catch (error) {
        const historyReset = adapterStarted && config.history === 'session';
        if (historyReset)
          sessions.set(logicalSessionId, { id: randomUUID() });
        native = { runId, sessionId, status: signal.aborted ? 'aborted' : 'failed',
          messages: [], failure: failure(error),
          warning: historyReset ? '原生会话打开失败，后续对话已切换到新会话。'
            : error instanceof Error ? error.message : undefined };
      }

      let record: ExecutionResult['record'] = { state: 'complete' };
      const measured = metrics(recorder.modelRequests, native.observedUsage);
      measured.requestTimings = [...recorder.requestTimings];
      try {
        await recorder.recordRunSettled({ status: native.status, failure: native.failure,
          warning: native.warning, metrics: measured });
      } catch (error) { record = partial(error); }
      try { await recorder.close(); }
      catch (error) { record = partial(error); }
      if (recordFailure) record = { state: 'partial', warning: '执行记录写入失败。' };
      const result: ExecutionResult = { runId, sessionId, status: native.status, messages: native.messages,
        failure: native.failure, warning: native.warning, metrics: measured, record };
      try {
        options.onEvent?.({ type: 'settled', agentKey: config.key, sessionId, runId,
          seq: lastEventSeq + 1, data: { status: result.status, record: result.record.state } });
      } catch { /* 业务监听器异常不影响已提交的结果。 */ }
      return result;
    })();

    active = { controller, done };
    try { return await done; }
    finally { if (active?.done === done) active = undefined; }
  }

  return {
    key: config.key,
    execute,
    async newSession() {
      if (config.history !== 'session') throw new Error('ISOLATED_AGENT');
      active?.controller.abort('NEW_SESSION');
      await active?.done;
      defaultSessionId = randomUUID();
      return { sessionId: defaultSessionId };
    },
    async close() {
      closed = true;
      active?.controller.abort('AGENT_CLOSED');
      await active?.done;
    }
  };
}
