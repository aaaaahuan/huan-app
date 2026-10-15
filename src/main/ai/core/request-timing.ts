import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ModelRequestTiming } from '@shared/contracts/ai-execution';
import type { RunRecorder } from './records';

type ContentKind = 'text' | 'thinking' | 'tool';

export function createRequestTiming(recorder: RunRecorder) {
  let requestSeq: number | undefined;
  let startedAt: number | null = null;
  let started: number | undefined;
  let httpResponse: number | undefined;
  let httpStatus: number | null = null;
  let firstContent: number | undefined;
  let firstText: number | undefined;
  let lastText: number | undefined;
  let settled: Promise<void> | undefined;
  const textLengths = new Map<number, number>();
  const writes: Promise<void>[] = [];
  const duration = (from: number | undefined, to: number | undefined): number | null =>
    from === undefined || to === undefined ? null : Math.max(0, Math.round(to - from));

  function enqueue(write: Promise<void>): void {
    // Recorder 统一上报写入失败并取消执行；这里附加处理，避免流回调产生未处理的 rejection。
    writes.push(write.catch(() => undefined));
  }

  function progress(stage: 'started' | 'headers' | 'first_content' | 'first_text', now: number,
    contentKind?: ContentKind): void {
    if (requestSeq === undefined || started === undefined) return;
    enqueue(recorder.recordModelRequestProgress({
      requestSeq, stage, at: Date.now(), elapsedMs: duration(started, now) ?? 0,
      ...(stage === 'headers' && httpStatus !== null ? { httpStatus } : {}),
      ...(contentKind === undefined ? {} : { contentKind })
    }));
  }

  function content(kind: ContentKind, now: number): void {
    if (firstContent === undefined) {
      firstContent = now;
      progress('first_content', now, kind);
    }
    if (kind === 'text') {
      if (firstText === undefined) {
        firstText = now;
        progress('first_text', now, kind);
      }
      lastText = now;
    }
  }

  function finalContent(message: AssistantMessage, now: number): void {
    message.content.forEach((block, index) => {
      if (block.type === 'text') {
        if (block.text.length > (textLengths.get(index) ?? 0)) {
          content('text', now);
          textLengths.set(index, block.text.length);
        }
      } else if (block.type === 'thinking') {
        if (block.thinking.length > 0 || (block.redacted && block.thinkingSignature))
          content('thinking', now);
      } else if (block.name.length > 0) {
        content('tool', now);
      }
    });
  }

  return {
    prepared(sequence: number): void { requestSeq = sequence; },
    started(): void {
      if (started !== undefined) return;
      started = performance.now();
      startedAt = Date.now();
      progress('started', started);
    },
    headers(status: number): void {
      if (httpResponse !== undefined) return;
      httpResponse = performance.now();
      httpStatus = status;
      progress('headers', httpResponse);
    },
    observe(event: AssistantMessageEvent): void {
      const now = performance.now();
      if (event.type === 'text_delta' && event.delta.length > 0) {
        content('text', now);
        textLengths.set(event.contentIndex, (textLengths.get(event.contentIndex) ?? 0) + event.delta.length);
      } else if (event.type === 'thinking_delta' && event.delta.length > 0) {
        content('thinking', now);
      } else if (event.type === 'toolcall_delta' && event.delta.length > 0) {
        content('tool', now);
      } else if (event.type === 'toolcall_start') {
        const block = event.partial.content[event.contentIndex];
        if (block?.type === 'toolCall' && block.name.length > 0) content('tool', now);
      } else if (event.type === 'thinking_start') {
        const block = event.partial.content[event.contentIndex];
        if (block?.type === 'thinking' && block.redacted && block.thinkingSignature)
          content('thinking', now);
      } else if (event.type === 'text_end') {
        if (event.content.length > (textLengths.get(event.contentIndex) ?? 0)) {
          content('text', now);
          textLengths.set(event.contentIndex, event.content.length);
        }
      } else if (event.type === 'thinking_end' && event.content.length > 0) {
        content('thinking', now);
      } else if (event.type === 'toolcall_end' && event.toolCall.name.length > 0) {
        content('tool', now);
      } else if (event.type === 'done' || event.type === 'error') {
        // partial 是会继续变动的共享对象，仅在终态使用权威正文补齐未经过 delta 的内容。
        finalContent(event.type === 'done' ? event.message : event.error, now);
      }
    },
    settle(status: ModelRequestTiming['status']): Promise<void> {
      if (settled) return settled;
      const ended = performance.now();
      const timing: ModelRequestTiming | undefined = requestSeq === undefined ? undefined : {
        requestSeq, status, startedAt,
        durationMs: duration(started, ended),
        httpResponseMs: duration(started, httpResponse),
        httpStatus,
        firstContentMs: duration(started, firstContent),
        firstTextMs: duration(started, firstText),
        generationMs: duration(firstText, lastText),
        streamTailMs: duration(lastText, ended)
      };
      settled = (async () => {
        await Promise.all(writes);
        if (timing) await recorder.recordModelRequestSettled(timing).catch(() => undefined);
      })();
      return settled;
    }
  };
}
