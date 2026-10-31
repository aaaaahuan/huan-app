import { z } from 'zod';
import type { ExecutionMetrics } from './ai-execution';

const text = z.string().trim().min(1).max(12000);
export const vocabularyWordSchema = z.string().trim().regex(/^[a-zA-Z][a-zA-Z’' -]{0,99}$/)
  .refine(value => value.split(/\s+/).length <= 8, '请选择英语单词或短语（最多 8 个词）。');
export const studyRequestSchema = z.object({
  requestId: z.uuid(), task: z.enum(['lesson', 'grade', 'vocabulary']),
  source: text, answer: z.string().max(12000).optional(), context: z.string().max(12000).optional()
}).strict().superRefine((value, ctx) => {
  if (value.task === 'grade' && !value.answer?.trim()) ctx.addIssue({ code: 'custom', message: '请输入你的译文。', path: ['answer'] });
  if (value.task === 'vocabulary' && !vocabularyWordSchema.safeParse(value.source).success)
    ctx.addIssue({ code: 'custom', message: '请选择英语单词或短语（最多 8 个词）。', path: ['source'] });
});
export type StudyRequest = z.infer<typeof studyRequestSchema>;
export const lessonSchema = z.object({ reference: text, explanation: text });
export type StudyLesson = z.infer<typeof lessonSchema>;
export const gradeSchema = z.object({
  score: z.number().int().min(0).max(100).optional(), meaning: z.number().int().min(0).max(60),
  grammar: z.number().int().min(0).max(25), expression: z.number().int().min(0).max(15),
  feedback: text, corrected: text
}).transform(value => ({ ...value, score: value.meaning + value.grammar + value.expression }));
export type StudyGrade = z.infer<typeof gradeSchema>;
export const vocabularySchema = z.object({
  word: vocabularyWordSchema, phonetic: text, partOfSpeech: text,
  meaning: text, example: text, translation: text, synonyms: z.string().trim().max(12000), memory: z.string().trim().max(12000)
});
export type VocabularyEntry = z.infer<typeof vocabularySchema>;
export interface VocabularyCard { word: string; content: string }
export interface StudyResult {
  status: 'complete' | 'failed' | 'stopped'; error?: string; metrics?: ExecutionMetrics;
  lesson?: StudyLesson; grade?: StudyGrade; saved?: 'added' | 'exists';
}
export interface EnglishStudyAPI {
  study(request: StudyRequest): Promise<StudyResult>;
  vocabulary(): Promise<{ cards: VocabularyCard[]; path: string }>;
}
