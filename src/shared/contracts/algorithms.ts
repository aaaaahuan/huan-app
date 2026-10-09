import { z } from 'zod';

export interface AlgorithmProblem {
  id: string;
  noteKey: string;
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
export interface AlgorithmNote {
  problemKey: string;
  path: string;
  content: string;
  revision: string | null;
  exists: boolean;
}
export type AlgorithmNoteResult = { ok: true; note: AlgorithmNote } | { ok: false; message: string };
export type SaveAlgorithmNoteResult = { ok: true; note: AlgorithmNote } |
  { ok: false; kind: 'conflict'; message: string; note: AlgorithmNote } |
  { ok: false; kind: 'error'; message: string };
export type AlgorithmNoteIndex = { ok: true; keys: string[] } | { ok: false; message: string };
export const saveAlgorithmNoteSchema = z.object({
  id: algorithmIdSchema,
  content: z.string().max(1024 * 1024),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict();
export const copyAlgorithmNoteSchema = saveAlgorithmNoteSchema.pick({ id: true, content: true });
export type SaveAlgorithmNoteInput = z.infer<typeof saveAlgorithmNoteSchema>;
export type CopyAlgorithmNoteInput = z.infer<typeof copyAlgorithmNoteSchema>;
export interface AlgorithmsAPI {
  get(): Promise<AlgorithmLibrary>;
  refresh(): Promise<AlgorithmLibrary>;
  setCompleted(input: SetCompletedInput): Promise<SetCompletedResult>;
  open(id: string): Promise<OpenAlgorithmResult>;
  getNote(id: string): Promise<AlgorithmNoteResult>;
  noteIndex(): Promise<AlgorithmNoteIndex>;
  saveNote(input: SaveAlgorithmNoteInput): Promise<SaveAlgorithmNoteResult>;
  copyNote(input: CopyAlgorithmNoteInput): Promise<{ ok: true; path: string } | { ok: false; message: string }>;
  openNote(id: string): Promise<OpenAlgorithmResult>;
  openNoteLink(url: string): Promise<OpenAlgorithmResult>;
  onNotesChanged(listener: () => void): () => void;
}
