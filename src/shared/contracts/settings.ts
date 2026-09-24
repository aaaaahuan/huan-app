// 设置的共享结构与接口；不在此处执行文件读写或依赖 Electron。
import { z } from 'zod';

// 顺序同时用于设置展示与跨平台收藏拼接；不改变各来源内部的行顺序。
export const PLATFORMS = ['x', 'reddit', 'youtube'] as const;
export const PLATFORM_NAMES = { x: 'X', reddit: 'Reddit', youtube: 'YouTube' };
const sourceSchema = z.object({ enabled: z.boolean(), path: z.string().max(4096) }).strict();
export const sessionModeSchema = z.enum(['memory', 'persistent']);
export const sessionModesSchema = z.object({ x: sessionModeSchema, reddit: sessionModeSchema, youtube: sessionModeSchema }).strict();
export type SessionModes = z.infer<typeof sessionModesSchema>;
export type SessionMode = z.infer<typeof sessionModeSchema>;
export const defaultSessionModes = (): SessionModes => ({ x: 'memory', reddit: 'memory', youtube: 'memory' });
export const settingsSchema = z.object({
  version: z.literal(1),
  sources: z.object({ x: sourceSchema, reddit: sourceSchema, youtube: sourceSchema }).strict(),
  // 兼容 A1-A4 的配置；缺少会话设置时沿用内存模式，不自动持久化登录态。
  sessions: sessionModesSchema.default(defaultSessionModes)
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export type Platform = typeof PLATFORMS[number];
// 每次返回新对象，首次启动不猜测用户路径，也不自动启用未配置的来源。
export function defaultSettings(): Settings {
  return { version: 1, sources: {
    x: { enabled: false, path: '' }, reddit: { enabled: false, path: '' },
    youtube: { enabled: false, path: '' }
  }, sessions: defaultSessionModes() };
}
// revision 为磁盘内容摘要；null 表示尚无配置文件，不是配置读取失败。
export type SettingsResult =
  | { ok: true; settings: Settings; revision: string | null }
  | { ok: false; message: string; fields?: Partial<Record<Platform, string>> };
export interface SettingsAPI {
  load(): Promise<SettingsResult>;
  save(settings: Settings, revision: string | null): Promise<SettingsResult>;
  chooseFile(): Promise<{ ok: true; path: string | null } | { ok: false; message: string }>;
}
