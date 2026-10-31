import { z } from 'zod';
import type { EnglishStudyAPI } from './english-study';
import type { ExecutionMetrics } from './ai-execution';

export const translationRequestSchema = z.object({
  requestId: z.uuid(),
  direction: z.enum(['en-zh', 'zh-en']),
  text: z.string().refine(value => value.trim().length > 0, '请输入需要翻译的文字。')
}).strict();
export const lookupRequestSchema = translationRequestSchema.extend({
  text: translationRequestSchema.shape.text.max(2000)
});
export type LookupRequest = z.infer<typeof lookupRequestSchema>;
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
  metrics?: ExecutionMetrics;
}
export interface TranslationAPI extends EnglishStudyAPI {
  getStatus(): Promise<TranslationStatus>;
  lookup(request: LookupRequest): Promise<TranslationResult>;
  speak(request: SpeechRequest): Promise<SpeechResult>;
  stopSpeech(requestId: string): Promise<void>;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  stop(requestId: string): Promise<void>;
  copy(text: string): Promise<void>;
  onStatus(listener: (status: TranslationStatus) => void): () => void;
}

export const speechRequestSchema = z.object({
  requestId: z.uuid(), text: z.string().trim().min(1).max(12000)
}).strict();
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export interface SpeechResult { status: 'complete' | 'stopped' | 'failed'; error?: string }
