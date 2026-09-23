// 只解析约定的收藏表格，不是通用 Markdown 渲染器，也不执行 HTML。
import { createHash } from 'node:crypto';
import type { Bookmark } from '@shared/contracts/bookmarks';
import type { Platform } from '@shared/contracts/settings';

const COLUMNS = ['采集日期', '标题/列表文字', '来源', '帖子链接'];
// 平台与原 URL 共同确定身份；标题或所在行变化不改变 ID，也不归一化查询参数。
export const bookmarkId = (platform: Platform, url: string) =>
  createHash('sha256').update(JSON.stringify([platform, url])).digest('hex');

// 拆分单行表格，保留转义管道符；不能直接 split('|')，否则会误切单元格内容。
function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const result: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && (text[i + 1] === '|' || text[i + 1] === '\\')) cell += text[++i];
    else if (text[i] === '|') { result.push(cell.trim()); cell = ''; }
    else cell += text[i];
  }
  result.push(cell.trim());
  return result;
}

// 将约定的换行和实体还原为纯文本；最终仍由 React 以文本节点显示。
function plain(text: string): string {
  return text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, code: string) => {
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? match;
    const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : match;
  });
}

// 仅接受不携带用户名/密码的 HTTP(S) 链接，拒绝脚本协议与控制字符。
export function validBookmarkUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text) || /[\s<>]/.test(text) || Array.from(text).some((character) => character.charCodeAt(0) < 32)) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

// 解包普通 URL、尖括号 URL 和 Markdown 链接，不进行网络请求。
function link(text: string): string {
  let url = text.trim();
  if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
  else {
    const markdown = /^\[[^\]]*\]\((.*)\)$/.exec(url);
    if (markdown) url = markdown[1];
    if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
  }
  url = plain(url);
  if (!validBookmarkUrl(url)) throw new Error('帖子链接必须为有效的 HTTP/HTTPS URL（不含账号密码）。');
  return url;
}

export function parseBookmarks(markdown: string, platform: Platform): { items: Bookmark[]; duplicates: number } {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const items: Bookmark[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let tables = 0;
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    // 忽略围栏代码块里的示例表格，避免把笔记中的代码示例当作真实收藏。
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (fence) continue;
    // 通过列名定位，允许调整列顺序；日期只是元数据，不用于排序。
    const header = cells(lines[i]).map((value) => value.replace(/\s/g, ''));
    if (header.length !== 4 || !COLUMNS.every((name) => header.includes(name))) continue;
    const separator = cells(lines[i + 1] ?? '');
    if (separator.length !== 4 || !separator.every((value) => /^:?-{3,}:?$/.test(value)))
      throw new Error(`第 ${i + 2} 行：收藏表格分隔行无效。`);
    tables++;
    i += 2;
    for (; i < lines.length && lines[i].trim(); i++) {
      // 新 Markdown 块结束表格；中间出现畸形行时不能把后续记录静默丢弃。
      if (/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i])) { i--; break; }
      if (!lines[i].includes('|')) {
        for (let next = i + 1; next < lines.length && lines[next].trim(); next++) {
          if (/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[next])) break;
          if (lines[next].includes('|')) throw new Error(`第 ${i + 1} 行：表格中出现不完整的行，本轮未更新。`);
        }
        i--; break;
      }
      const row = cells(lines[i]);
      if (row.length !== 4) throw new Error(`第 ${i + 1} 行：需要四列，请将单元格内的 | 写成 &#124;。`);
      const get = (name: string) => row[header.indexOf(name)];
      let url: string;
      try { url = link(get('帖子链接')); }
      catch (error) { throw new Error(`第 ${i + 1} 行：${(error as Error).message}`, { cause: error }); }
      const id = bookmarkId(platform, url);
      // 按遇到的顺序追加，重复项保留第一次出现的位置和内容。
      if (seen.has(id)) { duplicates++; continue; }
      seen.add(id);
      items.push({ id, platform, url, title: plain(get('标题/列表文字')) || url,
        collectedAt: plain(get('采集日期')), source: plain(get('来源')) });
    }
  }
  // 没找到表格属于失败；找到合法空表则是成功，后者应清空该来源旧收藏。
  if (!tables) throw new Error('未找到约定的四列表格：采集日期、标题 / 列表文字、来源、帖子链接。');
  return { items, duplicates };
}
