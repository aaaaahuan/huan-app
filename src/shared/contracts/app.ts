import { z } from 'zod';

export const STATUS_CHANNEL = 'huan-app:app:status';
export const appStatusSchema = z.object({
  state: z.literal('ready'), appName: z.literal('huan-app'), version: z.string().min(1)
});
export type AppStatus = z.infer<typeof appStatusSchema>;
export interface HuanAppAPI { app: { getStatus(): Promise<AppStatus> } }
