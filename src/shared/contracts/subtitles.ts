import { z } from 'zod';

export const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const ensureSubtitlesSchema = z.object({ videoId: videoIdSchema, retry: z.boolean().optional() }).strict();
export const seekSubtitlesSchema = z.object({ videoId: videoIdSchema, seconds: z.number().finite().nonnegative() }).strict();

export type TranscriptGuruJob = {
  id: string; video_id: string; status: string; resolution: string;
  transcript_id: string | null; video_title: string | null; actual_credits: number;
  estimated_credits: number; reserved_credits: number;
};
export type TranscriptGuruTranscript = {
  video_id: string; language: string; source: string;
  segments: ReadonlyArray<{ time: string; seconds: number; text: string }>;
  word_count: number; quality_warning: boolean; quality_issues: readonly unknown[];
};
export type SubtitleState = {
  revision: number; videoId: string | null; phase: 'idle' | 'loading' | 'ready' | 'error';
  error?: { code: string; message: string; retryAfter?: number };
  playback?: { observedAt: number; phase: 'content' | 'advertisement' | 'unavailable'; seconds?: number };
  maxReachedSeconds?: number;
};
export type SubtitleResult<T = void> = { ok: true; value: T } | { ok: false; code: string; message: string; retryAfter?: number };
export type SubtitleDocument = { job: TranscriptGuruJob; transcript: TranscriptGuruTranscript };
export interface SubtitlesAPI {
  get(): Promise<SubtitleState>;
  ensure(input: z.infer<typeof ensureSubtitlesSchema>): Promise<SubtitleResult<SubtitleDocument>>;
  seek(input: z.infer<typeof seekSubtitlesSchema>): Promise<SubtitleResult>;
  onState(listener: (state: SubtitleState) => void): () => void;
}

export function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname);
  } catch { return false; }
}
export function youtubeVideoId(value: string): string | null {
  if (!isYouTubeUrl(value)) return null;
  const url = new URL(value);
  const id = url.searchParams.get('v');
  return url.pathname === '/watch' && videoIdSchema.safeParse(id).success ? id : null;
}
export const youtubeVideoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export function upperBound(segments: TranscriptGuruTranscript['segments'], seconds: number): number {
  let low = 0, high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle].seconds <= seconds) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function subtitleTime(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
