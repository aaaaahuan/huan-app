export type PageStatus = 'loading' | 'ready' | 'unavailable' | 'unsupported';
export type PageContent = { title: string; text: string; truncated: boolean };
export type PageSnapshot = PageContent & {
  id: string;
  url: string;
  status: PageStatus;
  capturedAt?: number;
};
export type PageContext = { currentPageId?: string; pages: PageSnapshot[]; subtitles?: {
  videoId: string; url: string; title?: string; transcriptId?: string; sentAt: number;
  playback?: SubtitleState['playback']; transcript?: TranscriptGuruTranscript;
} };
export type PageSource = Pick<PageSnapshot, 'id' | 'title' | 'url' | 'capturedAt' | 'truncated'> & {
  kind?: 'page' | 'subtitles'; language?: string; subtitleSource?: string;
};
import type { SubtitleState, TranscriptGuruTranscript } from './subtitles';
