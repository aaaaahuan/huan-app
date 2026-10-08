import { z } from 'zod';

export interface AlgorithmProblem {
  id: string;
  category: string;
  title: string;
  url: string;
  completed: boolean;
}
export interface AlgorithmLibrary {
  path: string;
  state: 'ready' | 'error';
  message: string;
  items: AlgorithmProblem[];
}

export const algorithmIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const setCompletedSchema = z.object({
  id: algorithmIdSchema, completed: z.boolean(), expectedCompleted: z.boolean()
}).strict();
export type SetCompletedInput = z.infer<typeof setCompletedSchema>;
export type SetCompletedResult = { ok: true; library: AlgorithmLibrary } |
  { ok: false; message: string; library: AlgorithmLibrary };
export type OpenAlgorithmResult = { ok: true } | { ok: false; message: string };
export interface AlgorithmsAPI {
  get(): Promise<AlgorithmLibrary>;
  refresh(): Promise<AlgorithmLibrary>;
  setCompleted(input: SetCompletedInput): Promise<SetCompletedResult>;
  open(id: string): Promise<OpenAlgorithmResult>;
}
