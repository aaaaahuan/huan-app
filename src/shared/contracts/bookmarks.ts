// 收藏与来源状态的传输结构，只携带展示数据，不包含登录凭据或网页正文。
import type { Platform } from './settings';

export interface Bookmark {
  id: string;
  platform: Platform;
  url: string;
  title: string;
  // 笔记记录的采集日期，不代表原平台收藏时间，也不用于排序。
  collectedAt: string;
  source: string;
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
export interface BookmarksAPI { get(): Promise<BookmarkLibrary> }
