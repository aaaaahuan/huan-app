// 只识别笔记中的约定表格，不渲染 Markdown 或执行其中的 HTML。
import { createHash } from 'node:crypto';
import type { AlgorithmProblem } from '@shared/contracts/algorithms';
import { cells, link, plain, replaceCell } from '@main/bookmarks/markdown';

const COLUMNS = ['分类', '题目', '帖子链接', '是否已完成'];
type SourceRow = { line: number; column: number; id: string };

// 分类和原链接共同确定身份；改标题、移动行不会影响完成状态的定位。
function problemId(category: string, url: string) {
  return createHash('sha256').update(JSON.stringify([category, url])).digest('hex');
}

function scan(markdown: string) {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const items: AlgorithmProblem[] = [];
  const seen = new Map<string, AlgorithmProblem>();
  const rows: SourceRow[] = [];
  let tables = 0;
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (marker) {
      // closing fence 不能带 info string，否则代码块里的示例可能被错误写回。
      if (!fence && (marker[1][0] !== '`' || !marker[2].includes('`'))) fence = marker[1];
      else if (fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = '';
      continue;
    }
    if (fence || /^(?: {4}| {0,3}\t)/.test(lines[i])) continue;
    const header = cells(lines[i]).map(value => value.replace(/\s/g, ''));
    if (!COLUMNS.every(name => header.includes(name))) continue;
    if (header.length !== COLUMNS.length || new Set(header).size !== COLUMNS.length)
      throw new Error(`第 ${i + 1} 行：题目表格只支持分类、题目、帖子链接、是否已完成四列。`);
    const separator = cells(lines[i + 1] ?? '');
    if (separator.length !== header.length || !separator.every(value => /^:?-{3,}:?$/.test(value)))
      throw new Error(`第 ${i + 2} 行：题目表格分隔行无效。`);
    tables++;
    i += 2;
    for (; i < lines.length && lines[i].trim(); i++) {
      if (/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i])) { i--; break; }
      if (!lines[i].includes('|')) {
        // 表格中间的坏行不能导致后面的题目被静默遗漏。
        for (let next = i + 1; next < lines.length && lines[next].trim(); next++) {
          if (/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[next])) break;
          if (lines[next].includes('|')) throw new Error(`第 ${i + 1} 行：表格中有不完整的行。`);
        }
        i--; break;
      }
      const row = cells(lines[i]);
      if (row.length !== header.length) throw new Error(`第 ${i + 1} 行：列数与表头不一致，内容中的 | 请转义。`);
      const get = (name: string) => row[header.indexOf(name)];
      const category = plain(get('分类'));
      const title = plain(get('题目'));
      const url = link(get('帖子链接'));
      if (!category || !title) throw new Error(`第 ${i + 1} 行：分类和题目不能为空。`);
      if (!url) throw new Error(`第 ${i + 1} 行：帖子链接必须是有效的 HTTP(S) 链接。`);
      const completion = get('是否已完成');
      if (!['是', '否'].includes(completion)) throw new Error(`第 ${i + 1} 行：是否已完成请填写“是”或“否”。`);
      const item = { id: problemId(category, url), category, title, url, completed: completion === '是' };
      rows.push({ line: i, column: header.indexOf('是否已完成'), id: item.id });
      const previous = seen.get(item.id);
      if (previous && previous.completed !== item.completed)
        throw new Error(`第 ${i + 1} 行：同一分类的重复链接完成状态不一致，请先在笔记中统一。`);
      if (previous) continue;
      seen.set(item.id, item);
      items.push(item);
    }
  }
  if (!tables) throw new Error('未找到题目表格：分类、题目、帖子链接、是否已完成。');
  return { items, rows };
}

export function parseAlgorithms(markdown: string): AlgorithmProblem[] {
  return scan(markdown).items;
}

export function updateAlgorithmCompletion(markdown: string, id: string, completed: boolean, expectedCompleted: boolean): string {
  const { items, rows } = scan(markdown);
  const item = items.find(problem => problem.id === id);
  if (!item) throw new Error('题目已移除或分类、链接已改变，请刷新笔记。');
  if (item.completed !== expectedCompleted) throw new Error('笔记中的完成状态已改变，请刷新后重新勾选。');
  // 保留 BOM、混合换行、链接写法和其他单元格；重复记录同步更新，不重排原文。
  const lines = markdown.split(/(\r?\n)/);
  for (const row of rows) if (row.id === id)
    lines[row.line * 2] = replaceCell(lines[row.line * 2], row.column, completed ? '是' : '否');
  return lines.join('');
}
