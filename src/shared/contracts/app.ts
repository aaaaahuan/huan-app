// 应用级通信契约：类型供两端编译使用，Zod 用于实际数据的运行时校验。
import { z } from 'zod';
import type { SettingsAPI } from './settings';
import type { BookmarksAPI } from './bookmarks';
import type { BrowserAPI } from './browser';

export const appStatusSchema = z.object({
  state: z.literal('ready'), appName: z.literal('huan-app'), version: z.string().min(1)
});
export type AppStatus = z.infer<typeof appStatusSchema>;
export interface HuanAppAPI { app: { getStatus(): Promise<AppStatus> }; settings: SettingsAPI; bookmarks: BookmarksAPI; browser: BrowserAPI }
