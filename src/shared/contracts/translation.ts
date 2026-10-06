import { z } from 'zod';

export const TRANSLATION_MODEL = 'Qwen3.5-4B';
export const translationRequestSchema = z.object({
  requestId: z.uuid(),
  direction: z.enum(['en-zh', 'zh-en']),
  text: z.string().refine(value => value.trim().length > 0, '请输入需要翻译的文字。')
}).strict();
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type TranslationDirection = TranslationRequest['direction'];
export interface TranslationStatus {
  revision: number;
  phase: 'unloaded' | 'loading' | 'ready' | 'failed';
  error?: string;
}
export interface TranslationResult {
  status: 'complete' | 'truncated' | 'stopped' | 'failed';
  text: string;
  error?: string;
}
export interface TranslationAPI {
  getStatus(): Promise<TranslationStatus>;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  stop(requestId: string): Promise<void>;
  copy(text: string): Promise<void>;
  onStatus(listener: (status: TranslationStatus) => void): () => void;
}
