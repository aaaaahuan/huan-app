import { z } from 'zod';
export const ideaEntrySchema = z.object({ id: z.string(), text: z.string(), timestamp: z.string() });
export const ideaSnapshotSchema = z.object({ entries: z.array(ideaEntrySchema), path: z.string(), savedID: z.string().optional().nullable() });
export const ideaResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: ideaSnapshotSchema }),
  z.object({ ok: z.literal(false), message: z.string() })
]);
export const ideaInputSchema = z.object({ requestID: z.string().uuid(), text: z.string().trim().min(1).max(100_000) }).strict();
export type IdeaEntry = z.infer<typeof ideaEntrySchema>;
export type IdeaSnapshot = z.infer<typeof ideaSnapshotSchema>;
export type IdeaResult = z.infer<typeof ideaResultSchema>;
export const ideaDraftSchema = z.object({ text: z.string().max(100_000), requestID: z.string().uuid().optional() }).strict();
export type IdeaDraft = z.infer<typeof ideaDraftSchema>;
export type IdeaDraftResult = { ok: true; draft: IdeaDraft } | { ok: false; message: string };
export interface IdeasAPI { getDraft(): Promise<IdeaDraftResult>; saveDraft(draft: IdeaDraft): Promise<{ ok: boolean; message?: string }>; get(): Promise<IdeaResult>; append(input: z.infer<typeof ideaInputSchema>): Promise<IdeaResult> }
