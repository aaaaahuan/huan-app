import type {
  AgentMessage, Entry, HookHandler, OperationResultRecord
} from '@earendil-works/pi-agent-core';
import type { NoteWrite } from '@shared/contracts/ai';
import type { PiHistoryReader } from './agent';

export interface ReadingHistorySnapshot {
  entries: Entry[];
  outcomes: OperationResultRecord[];
}

type RunRange = {
  start: number;
  end: number;
  outcome: OperationResultRecord;
};

function contextMessage(entry: Entry): AgentMessage | undefined {
  if (entry.type !== 'message') return undefined;
  const message = entry.message;
  if (message.role === 'assistant' &&
    (message.stopReason === 'error' || message.stopReason === 'aborted' || message.stopReason === 'deferred')) return undefined;
  return message;
}

function committedWrite(message: AgentMessage): NoteWrite | undefined {
  if (message.role !== 'toolResult' || message.isError || !['write', 'edit'].includes(message.toolName)) return undefined;
  const details = message.details;
  if (!details || typeof details !== 'object' || Array.isArray(details) || !('write' in details)) return undefined;
  const write = details.write;
  if (!write || typeof write !== 'object' || Array.isArray(write) ||
    !('path' in write) || typeof write.path !== 'string' ||
    !('operation' in write) || (write.operation !== 'write' && write.operation !== 'edit')) return undefined;
  return { path: write.path, operation: write.operation };
}

function partialAnswer(entries: Entry[]): AgentMessage | undefined {
  const assistant = entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant')
    .at(-1);
  if (assistant?.type !== 'message' || assistant.message.role !== 'assistant') return undefined;
  const text = assistant.message.content.filter(block => block.type === 'text').map(block => block.text).join('');
  if (!text) return undefined;
  return { ...assistant.message,
    content: [{ type: 'text', text: `[上次回答未完成]\n${text}` }],
    stopReason: 'stop', errorMessage: undefined };
}

function projectRun(entries: Entry[], outcome: OperationResultRecord): AgentMessage[] {
  if (outcome.status === 'completed') return entries.flatMap(entry => {
    const message = contextMessage(entry);
    return message ? [message] : [];
  });

  if (outcome.status === 'declined') return [];
  const accepted = entries.find(entry => entry.type === 'message' && entry.message.role === 'user');
  const writes = entries.flatMap(entry => {
    if (entry.type !== 'message') return [];
    const write = committedWrite(entry.message);
    return write ? [write] : [];
  });
  const messages: AgentMessage[] = [];
  if (accepted?.type === 'message') messages.push(accepted.message);
  if (outcome.status === 'aborted') {
    const partial = partialAnswer(entries);
    if (partial) messages.push(partial);
  }
  if (writes.length) messages.push({ role: 'user', timestamp: outcome.endedAt,
    content: `应用执行回执：本轮回答未完成，但以下文件已成功保存，不得当作未执行而重复写入：${JSON.stringify(writes)}` });
  return outcome.status === 'failed' && !writes.length ? [] : messages;
}

function runRanges(snapshot: ReadingHistorySnapshot): RunRange[] {
  const position = new Map(snapshot.entries.map((entry, index) => [entry.id, index]));
  const ranges: RunRange[] = [];
  for (const outcome of snapshot.outcomes) {
    if (outcome.kind !== 'run' || !outcome.tipId) continue;
    const end = position.get(outcome.tipId);
    const from = outcome.fromTipId === null ? -1 : position.get(outcome.fromTipId);
    if (end === undefined || from === undefined || end <= from) continue;
    ranges.push({ start: from + 1, end, outcome });
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function selectReaderHistory(messages: AgentMessage[], snapshot: ReadingHistorySnapshot): AgentMessage[] {
  const ranges = runRanges(snapshot);
  if (!ranges.some(range => range.outcome.status !== 'completed')) return messages;

  const selected: AgentMessage[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    for (const entry of snapshot.entries.slice(cursor, range.start)) {
      const message = contextMessage(entry);
      if (message) selected.push(message);
    }
    selected.push(...projectRun(snapshot.entries.slice(range.start, range.end + 1), range.outcome));
    cursor = range.end + 1;
  }
  for (const entry of snapshot.entries.slice(cursor)) {
    const message = contextMessage(entry);
    if (message) selected.push(message);
  }
  return selected;
}

export function createReadingHistoryHook(reader: PiHistoryReader): HookHandler<'transform_context'> {
  return async (event, context) => {
    context.abortSignal?.throwIfAborted();
    const snapshot = await reader.inspect(event.runId);
    context.abortSignal?.throwIfAborted();
    return { messages: selectReaderHistory(event.messages, snapshot), systemPrompt: event.systemPrompt };
  };
}
