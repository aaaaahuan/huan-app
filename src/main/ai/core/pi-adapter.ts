import { join } from 'node:path';
import type {
  AgentHarness, AgentHarnessTool, AgentLane, AgentMessage, Entry,
  JsonlSessionMetadata, OperationResultRecord, Session
} from '@earendil-works/pi-agent-core';
import type { ModelTarget } from '@shared/contracts/models';
import type {
  ExecutionEvent, ExecutionFailure, ExecutionResult, TokenUsage
} from '@shared/contracts/ai-execution';
import type { AgentConfig, PiHistoryReader, PreparedInput } from '../agent/agent';
import type { ExecutionRecordStore, RunRecorder } from './records';
import { createHarnessModels } from './providers';

export interface AdapterExecution<C extends object> {
  agentKey: string;
  sessionId: string;
  runId: string;
  session: { kind: 'new' } | { kind: 'existing'; metadata: JsonlSessionMetadata };
  config: AgentConfig<C>;
  input: PreparedInput<C>;
  target: ModelTarget;
  recorder: RunRecorder;
}

export type PiRunResult = Omit<ExecutionResult, 'record' | 'metrics'> & {
  metadata?: JsonlSessionMetadata;
  observedUsage?: { responses: number; usage?: TokenUsage };
};

export interface PiAdapter {
  execute<C extends object>(
    input: AdapterExecution<C>,
    options: { signal: AbortSignal; onEvent?: (event: ExecutionEvent) => void }
  ): Promise<PiRunResult>;
  inspectSession(input: { agentKey: string; sessionId: string; runId: string }): Promise<{
    sessionId: string;
    entries: Entry[];
    outcomes: OperationResultRecord[];
  }>;
  close(): Promise<void>;
}

type ActiveSession = {
  agentKey: string;
  runId: string;
  session: Session<JsonlSessionMetadata>;
  lane: AgentLane;
};

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function safeFailure(error: unknown): ExecutionFailure {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message : 'MODEL_EXECUTION_FAILED';
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return { kind: 'timeout', code: 'TIMEOUT' };
  if (code === 'ENDPOINT_REJECTED' || code === 'MODEL_UNAVAILABLE')
    return { kind: 'model', code };
  return { kind: 'model', code };
}

function recordTool<C extends object>(
  tool: AgentHarnessTool<C>, runId: string, recorder: RunRecorder
): AgentHarnessTool<C> {
  return {
    ...tool,
    async execute(callId, params, onUpdate, scope, invocation, context) {
      if (invocation.operationId !== runId) throw new Error('RUN_MISMATCH');
      context.abortSignal?.throwIfAborted();
      const { attemptId } = await recorder.recordToolInvocation({
        invocationId: invocation.invocationId,
        toolCallId: callId,
        name: tool.name,
        params: safeJson(params)
      });
      let started = false;
      let failed = false;
      let failure: unknown;
      let result: Awaited<ReturnType<typeof tool.execute>> | undefined;
      try {
        context.abortSignal?.throwIfAborted();
        started = true;
        result = await tool.execute(callId, params, onUpdate, scope, invocation, context);
      } catch (error) {
        failed = true;
        failure = error;
      }
      await recorder.recordToolResult({
        invocationId: invocation.invocationId,
        attemptId,
        state: failed ? (started ? 'failed_or_unknown' : 'not_started') : 'returned',
        details: result ? safeJson(result.details ?? null) : undefined,
        failure: failed ? safeFailure(failure) : undefined
      });
      if (failed) throw failure;
      return result!;
    }
  };
}

function installEventProjection<C extends object>(
  harness: AgentHarness<C>, execution: AdapterExecution<C>,
  onEvent: ((event: ExecutionEvent) => void) | undefined
): {
  emit(type: ExecutionEvent['type'], data: ExecutionEvent['data']): void;
  usage(): NonNullable<PiRunResult['observedUsage']>;
  dispose(): void;
} {
  let seq = 0;
  const dispose: Array<() => void> = [];
  const responseIds = new Set<string>();
  const reported = new Map<string, TokenUsage>();
  function emit(type: ExecutionEvent['type'], data: ExecutionEvent['data']) {
    try {
      onEvent?.({
        type, agentKey: execution.agentKey, sessionId: execution.sessionId,
        runId: execution.runId, seq: ++seq, data
      });
    } catch {
      // UI listeners are observational and cannot change a committed Pi operation.
    }
  }
  dispose.push(harness.events.on('message_start', event => {
    if (event.runId === execution.runId && event.message.role === 'assistant')
      emit('message_start', { role: 'assistant' });
  }));
  dispose.push(harness.events.on('message_update', event => {
    if (event.runId === execution.runId && event.event.type === 'text_delta')
      emit('message_delta', { text: event.event.delta });
  }));
  dispose.push(harness.events.on('message_end', event => {
    if (event.runId === execution.runId && event.message.role === 'assistant' && event.entryId)
      responseIds.add(event.entryId);
  }));
  dispose.push(harness.events.on('usage', ({ row }) => {
    // usage 在提交后发出；用本轮 assistant ID 关联，避免累计 Session 历史或重复计算。
    if (!row.entryId || !responseIds.has(row.entryId) || row.adjustment || reported.has(row.id)) return;
    const { input, output, cacheRead, cacheWrite, totalTokens, reasoning } = row.usage;
    const counts = [input, output, cacheRead, cacheWrite, totalTokens];
    if (!counts.every(value => Number.isSafeInteger(value) && value >= 0) ||
        (reasoning !== undefined && (!Number.isSafeInteger(reasoning) || reasoning < 0))) return;
    // 当前固定的 completions 适配器收到 usage 才设置 reasoning，初始化全零不代表零消费。
    if (reasoning === undefined && counts.every(value => value === 0)) return;
    reported.set(row.id, { input, output, cacheRead, cacheWrite, totalTokens,
      ...(reasoning === undefined ? {} : { reasoning }) });
  }));
  dispose.push(harness.events.on('tool_start', event => {
    if (event.runId === execution.runId)
      emit('tool_start', {
        toolCallId: event.toolCallId, toolName: event.toolName, args: event.args
      });
  }));
  dispose.push(harness.events.on('tool_update', event => {
    if (event.runId === execution.runId)
      emit('tool_update', {
        toolCallId: event.toolCallId, toolName: event.toolName,
        partialResult: event.partialResult
      });
  }));
  dispose.push(harness.events.on('tool_end', event => {
    if (event.runId === execution.runId)
      emit('tool_end', {
        toolCallId: event.toolCallId, toolName: event.toolName,
        result: event.result, isError: event.isError, terminate: event.terminate
      });
  }));
  return {
    emit,
    usage() {
      const values = [...reported.values()];
      if (!values.length) return { responses: 0 };
      const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
      for (const value of values) {
        usage.input += value.input;
        usage.output += value.output;
        usage.cacheRead += value.cacheRead;
        usage.cacheWrite += value.cacheWrite;
        usage.totalTokens += value.totalTokens;
      }
      if (values.every(value => value.reasoning !== undefined))
        usage.reasoning = values.reduce((sum, value) => sum + (value.reasoning ?? 0), 0);
      return { responses: values.length, usage };
    },
    dispose: () => { for (const unsubscribe of dispose) unsubscribe(); }
  };
}

async function runMessages(
  lane: AgentLane, outcome: OperationResultRecord,
  context: typeof import('@earendil-works/pi-agent-core').BACKGROUND_CONTEXT
): Promise<AgentMessage[]> {
  if (outcome.tipId === null) return [];
  const entries = await lane.findEntries({
    start: outcome.tipId,
    ...(outcome.fromTipId === null ? {} : { stopAtId: outcome.fromTipId })
  }, context);
  if (outcome.fromTipId !== null && entries.at(-1)?.id === outcome.fromTipId)
    entries.pop();
  return entries.reverse().flatMap(entry => entry.type === 'message' ? [entry.message] : []);
}

function outcomeFailure(
  outcome: OperationResultRecord,
  providerFailure: ExecutionFailure | undefined
): ExecutionFailure | undefined {
  if (outcome.status !== 'failed') return undefined;
  if (providerFailure) return providerFailure;
  return { kind: 'model', code: outcome.error?.code ?? 'MODEL_EXECUTION_FAILED' };
}

export async function createPiAdapter(options: {
  records: ExecutionRecordStore;
  recordRoot: string;
}): Promise<PiAdapter> {
  // Keep Pi ESM outside the main process CommonJS bundle's static module graph.
  const pi = await import('@earendil-works/pi-agent-core');
  const nativeRoot = options.records.fileSystem.cwd;
  const repo = new pi.JsonlSessionRepo({
    fileSystem: options.records.fileSystem,
    sessionsRoot: join(nativeRoot, 'pi-sessions')
  });
  const active = new Map<string, ActiveSession>();
  let closed = false;
  const keyOf = (agentKey: string, sessionId: string) => agentKey + '\0' + sessionId;
  async function inspectActive(input: { agentKey: string; sessionId: string; runId: string }) {
    const current = active.get(keyOf(input.agentKey, input.sessionId));
    if (!current || current.runId !== input.runId)
      throw new Error('SESSION_NOT_ACTIVE');
    const entries = await current.lane.findEntries({
      order: 'oldestFirst'
    }, pi.BACKGROUND_CONTEXT);
    const outcomes = await current.session.scanValues(
      pi.operationResult(''), pi.BACKGROUND_CONTEXT
    );
    return {
      sessionId: input.sessionId,
      entries,
      outcomes: outcomes.map(value => value.value)
    };
  }

  return {
    async execute<C extends object>(
      execution: AdapterExecution<C>,
      runOptions: { signal: AbortSignal; onEvent?: (event: ExecutionEvent) => void }
    ): Promise<PiRunResult> {
      if (closed) throw new Error('PI_ADAPTER_CLOSED');
      const { config, input, runId } = execution;
      const commitContext = pi.BACKGROUND_CONTEXT;
      const runContext = pi.withAbortSignal(runOptions.signal, commitContext);
      runOptions.signal.throwIfAborted();
      const session = execution.session.kind === 'new'
        ? await repo.create({ id: execution.sessionId, cwd: nativeRoot }, commitContext)
        : await repo.open(execution.session.metadata, commitContext);
      let harness: AgentHarness<C> | undefined;
      let projection: ReturnType<typeof installEventProjection<C>> | undefined;
      let result: PiRunResult | undefined;
      let thrown: unknown;
      let hasThrown = false;
      let admissionStarted = false;
      let closeError: unknown;
      try {
        const provider = await createHarnessModels(execution.target, {
          recorder: execution.recorder,
          maxOutputTokens: config.maxOutputTokens,
          temperature: config.temperature
        });
        const tools = (input.tools ?? config.tools ?? []).map(tool =>
          recordTool(tool, runId, execution.recorder)
        );
        const created = await pi.AgentHarness.create<C>({
          session, models: provider.models, model: provider.model,
          tools, toolContext: input.toolContext,
          systemPrompt: config.systemPrompt,
          thinkingLevel: config.thinkingLevel,
          toolExecution: config.toolExecution,
          streamOptions: { maxRetries: 0, cacheRetention: 'none' },
          retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
          compaction: { ...pi.DEFAULT_COMPACTION_SETTINGS, enabled: false }
        }, commitContext);
        harness = created.harness;
        if (created.open.length !== 0) {
          result = {
            runId, sessionId: execution.sessionId, status: 'interrupted',
            messages: [], failure: { kind: 'model', code: 'SESSION_HAS_OPEN_OPERATION' }
          };
        } else {
          const reader: PiHistoryReader = {
            inspect: async requestedRunId => inspectActive({
              agentKey: execution.agentKey,
              sessionId: execution.sessionId,
              runId: requestedRunId
            })
          };
          const historyHook = config.createTransformContext?.(reader) ?? config.transform_context;
          if (historyHook)
            harness.hooks.on('transform_context', historyHook);
          projection = installEventProjection(harness, execution, runOptions.onEvent);
          const lane = await harness.lane('main', commitContext);
          await lane.setModel({
            provider: provider.model.provider, modelId: provider.model.id
          }, commitContext);
          await lane.setActiveTools(tools.map(tool => tool.name), commitContext);
          if (config.thinkingLevel)
            await lane.setThinkingLevel(config.thinkingLevel, commitContext);
          active.set(keyOf(execution.agentKey, execution.sessionId), {
            agentKey: execution.agentKey, runId, session, lane
          });
          runOptions.signal.throwIfAborted();
          admissionStarted = true;
          const admission = await lane.accept(
            typeof input.prompt === 'string'
              ? { kind: 'prompt', operationId: runId, prompt: input.prompt }
              : { kind: 'prompt', operationId: runId, prompt: input.prompt },
            commitContext
          );
          if (!admission.ok) {
            result = {
              runId, sessionId: execution.sessionId, status: 'failed',
              messages: [], failure: { kind: 'model', code: 'ADMISSION_FAILED' }
            };
          } else {
            let driveError: unknown;
            let driven: Awaited<ReturnType<AgentLane['drive']>> | undefined;
            try {
              await execution.recorder.recordRunAccepted({
                nativeOperationId: runId,
                nativeSessionPath: session.metadata.path
              });
              projection.emit('accepted', {
                tools: tools.map(tool => tool.name),
                ...(input.toolError ? { toolError: input.toolError } : {})
              });
              driven = await lane.drive({
                operationId: runId, waitForRetry: false, pollDeferred: false
              }, runContext);
            } catch (error) {
              driveError = error;
            }
            let outcome = driven?.ok && driven.value.kind === 'settled'
              ? driven.value.outcome
              : await lane.getResult(runId, commitContext);
            if (!outcome) {
              await lane.requestAbort(runId, commitContext);
              const cancelled = await lane.drive({
                operationId: runId, waitForRetry: false, pollDeferred: false
              }, commitContext);
              outcome = cancelled.ok && cancelled.value.kind === 'settled'
                ? cancelled.value.outcome
                : await lane.getResult(runId, commitContext);
            }
            if (!outcome) {
              result = {
                runId, sessionId: execution.sessionId, status: 'interrupted',
                messages: [], failure: { kind: 'model', code: 'NO_COMMITTED_OUTCOME' },
                metadata: session.metadata
              };
            } else {
              result = {
                runId, sessionId: execution.sessionId, status: outcome.status,
                messages: await runMessages(lane, outcome, commitContext),
                failure: outcomeFailure(outcome, provider.failure()),
                metadata: session.metadata,
                ...(driveError ? { warning: 'Pi drive recovered from an execution error.' } : {})
              };
            }
            if (execution.recorder.pendingToolOutcomes().length) {
              result.warning = '工具执行回执需要核对。';
            }
          }
        }
      } catch (error) {
        thrown = error;
        hasThrown = true;
      } finally {
        active.delete(keyOf(execution.agentKey, execution.sessionId));
        projection?.dispose();
        try {
          if (harness) await harness.close(commitContext);
          else await session.close(commitContext);
        } catch (error) {
          closeError = error;
        }
      }
      if (hasThrown) {
        result = {
          runId, sessionId: execution.sessionId,
          status: admissionStarted ? 'interrupted' : runOptions.signal.aborted ? 'aborted' : 'failed',
          messages: [], failure: safeFailure(thrown), metadata: session.metadata
        };
      }
      if (closeError) {
        if (!result) throw closeError;
        result.warning = 'Pi Session 关闭失败，需要检查原生执行记录。';
      }
      if (!result) throw new Error('PI_RESULT_MISSING');
      result.metadata ??= session.metadata;
      result.observedUsage = projection?.usage();
      return result;
    },
    inspectSession: inspectActive,
    async close() {
      if (closed) return;
      closed = true;
      await repo.close(pi.BACKGROUND_CONTEXT);
    }
  };
}
