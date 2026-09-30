// 收藏与来源状态的传输结构，只携带展示数据，不包含登录凭据或网页正文。
import type { Platform } from './settings';
import { z } from 'zod';

export const setReadSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), read: z.boolean() }).strict();
export type SetReadInput = z.infer<typeof setReadSchema>;
export type SetReadResult = { ok: true; library: BookmarkLibrary } | { ok: false; message: string };

export interface Bookmark {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  // 笔记记录的采集日期，用于列表排序与分组，不代表原平台精确收藏时间。
  collectedAt: string;
  source: string;
  read: boolean;
}
export interface BookmarkSource {
  platform: Platform;
  path: string;
  // 停用、原文件读取成功、使用旧副本、无可用数据，四种状态不能混为“空列表”。
  state: 'disabled' | 'ready' | 'cached' | 'error';
  readAt: string | null;
  message: string;
  duplicates: number;
  items: Bookmark[];
}
export interface BookmarkLibrary {
  sources: BookmarkSource[];
  warning: string;
}
// 查询当前读取结果，不触发新的磁盘扫描。
export interface BookmarksAPI {
  get(): Promise<BookmarkLibrary>;
  setRead(input: SetReadInput): Promise<SetReadResult>;
}
