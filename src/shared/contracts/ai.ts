import { z } from 'zod';
import type { PageContext, PageSource } from './page-context';

export const AI_MODEL_NAME = 'DeepSeek Flash';
export const ownerSchema = z.object({ key: z.string().min(1).max(128), instanceId: z.uuid() }).strict();
export const sendSchema = ownerSchema.extend({ requestId: z.uuid(), text: z.string().trim().min(1).max(8000) });
export type Owner = z.infer<typeof ownerSchema>;
export type SendInput = z.infer<typeof sendSchema>;
export type AIResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };
export interface ChatEntry {
  id: string; question: string; answer: string;
  status: 'generating' | 'complete' | 'stopped' | 'failed' | 'truncated';
  error?: string; sources: PageSource[]; contextNotice?: string;
}
export interface ConversationState extends Owner {
  revision: number; phase: 'idle' | 'preparing' | 'generating' | 'stopping' | 'blocked';
  draft: string; entries: ChatEntry[];
  error: string;
}
export interface AIAPI {
  get(key: string): Promise<AIResult<ConversationState>>;
  draft(owner: Owner, text: string): Promise<AIResult>;
  send(input: SendInput): Promise<AIResult>;
  stop(owner: Owner): Promise<AIResult>;
  restart(owner: Owner): Promise<AIResult<ConversationState>>;
  testKey(key: string): Promise<AIResult<string>>;
  onState(listener: (state: ConversationState) => void): () => void;
}

// Worker 协议不包含窗口句柄、文件路径或任意工具调用。
export type WorkerCommand =
  | { type: 'start'; instanceId: string; requestId: string; key: string; text: string; context?: PageContext }
  | { type: 'cancel'; instanceId: string; requestId: string }
  | { type: 'dispose'; instanceId: string };
export type WorkerEvent = { instanceId: string; requestId: string } & (
  | { type: 'delta'; text: string; reset?: boolean }
  | { type: 'page-read'; source: PageSource }
  | { type: 'accepted' }
  | { type: 'settled'; status: ChatEntry['status']; text: string; error?: string }
);
