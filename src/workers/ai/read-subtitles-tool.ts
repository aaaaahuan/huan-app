import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { PageContext, PageSource } from '@shared/contracts/page-context';
import { z } from 'zod';

const inputSchema = z.object({ offset: z.number().int().min(0).default(0) }).strict();
export function createReadSubtitlesTool(Type: typeof import('@earendil-works/pi-ai').Type,
  getContext: () => PageContext | undefined, onRead: (source: PageSource) => void): AgentTool & { release(): void } {
  let cachedTranscript: NonNullable<PageContext['subtitles']>['transcript'];
  let formatted = '';
  return {
    name: 'read_subtitles', label: '读取视频字幕',
    description: '只读本轮提问时冻结的视频完整字幕；每次最多 12000 字符，用 nextOffset 继续。返回时间起点与原文，播放位置不是持续更新的。',
    parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    release() { cachedTranscript = undefined; formatted = ''; },
    async execute(_callId: string, input: unknown, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const { offset } = inputSchema.parse(input);
      const snapshot = getContext()?.subtitles;
      if (!snapshot?.transcript) throw new Error('本轮字幕材料不可用；不能用网页壳文本代替字幕');
      const transcript = snapshot.transcript;
      if (cachedTranscript !== transcript) {
        cachedTranscript = transcript;
        formatted = transcript.segments.map(segment => `[${segment.time}] ${segment.text}`).join('\n');
      }
      const text = formatted;
      if (offset > text.length) throw new Error('读取位置超出字幕范围');
      const end = Math.min(offset + 12000, text.length);
      onRead({ id: snapshot.transcriptId ?? snapshot.videoId, title: snapshot.title ?? '视频字幕', url: snapshot.url,
        capturedAt: snapshot.sentAt, truncated: false, kind: 'subtitles', language: transcript.language, subtitleSource: transcript.source });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ videoId: snapshot.videoId, url: snapshot.url,
        language: transcript.language, source: transcript.source, quality_warning: transcript.quality_warning,
        quality_issues: transcript.quality_issues, playback: snapshot.playback, sentAt: snapshot.sentAt,
        text: text.slice(offset, end), offset, totalChars: text.length, nextOffset: end < text.length ? end : null }) }],
        details: { videoId: snapshot.videoId, offset, end } };
    }
  };
}
