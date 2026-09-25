// 原页容器的跨进程契约：只允许选择已有收藏和固定导航动作，不提供任意脚本执行接口。
import { z } from 'zod';
import type { Platform, SessionModes } from './settings';

export const readerStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  bookmarkId: z.string().nullable(),
  phase: z.enum(['empty', 'loading', 'ready', 'stopped', 'error']),
  url: z.string(), title: z.string(), message: z.string(), notice: z.string(),
  canGoBack: z.boolean(), canGoForward: z.boolean(),
  contentStatus: z.enum(['empty', 'loading', 'ready', 'unavailable', 'unsupported'])
});
export type ReaderState = z.infer<typeof readerStateSchema>;
export const readerLayoutSchema = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
  visible: z.boolean()
}).strict();
export type ReaderLayout = z.infer<typeof readerLayoutSchema>;
export const readerActionSchema = z.enum(['back', 'forward', 'reload', 'stop']);
export type ReaderAction = z.infer<typeof readerActionSchema>;
export interface BrowserAPI {
  sessionModes(): Promise<SessionModes>;
  clearSession(platform: Platform): Promise<{ ok: true; cancelled: boolean } | { ok: false; message: string }>;
  select(bookmarkId: string | null): Promise<ReaderState>;
  get(): Promise<ReaderState>;
  action(bookmarkId: string, action: ReaderAction): Promise<ReaderState>;
  layout(layout: ReaderLayout): Promise<void>;
  suspend(value: boolean): Promise<void>;
  onState(listener: (state: ReaderState) => void): () => void;
}
