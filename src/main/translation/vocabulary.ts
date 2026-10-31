import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, open, rename, unlink } from 'node:fs/promises';
import type { VocabularyEntry, VocabularyCard } from '@shared/contracts/english-study';

const path = join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/huan-space/生词本.md');
export const vocabularyKey = (word: string) => word.normalize('NFKC').replace(/[’']/g, "'").trim().toLowerCase().replace(/\s+/g, ' ');
export function parseVocabulary(content: string): VocabularyCard[] {
  // 只认三级词条标题；前言、YAML 和分隔线不成为卡片。
  return [...content.matchAll(/^###\s+(.+?)\s*\r?\n([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/gm)]
    .map(match => ({ word: match[1].trim(), content: match[2].replace(/\n---\s*$/, '').trim() }));
}
async function read() {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('生词本必须是普通 Markdown 文件。');
  if (stat.size > 8 * 1024 * 1024) throw new Error('生词本超过 8 MB，暂时无法读取。');
  // 严格解码并保留 BOM，避免非法字节被替换后随追加写回而丢失。
  const bytes = await readFile(path);
  return { content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), stat };
}
export async function readVocabulary() {
  const { content } = await read();
  return { cards: parseVocabulary(content), path };
}
let queue: Promise<unknown> = Promise.resolve();
export function saveVocabulary(entry: VocabularyEntry, source: string, signal?: AbortSignal): Promise<'added' | 'exists'> {
  const save = async (): Promise<'added' | 'exists'> => {
    signal?.throwIfAborted();
    const original = await read();
    if (parseVocabulary(original.content).some(card => vocabularyKey(card.word) === vocabularyKey(entry.word))) return 'exists';
    // 模型仅生成字段，Markdown 结构由程序固定，避免新增字段破坏原词条。
    const line = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').trim();
    const date = new Date().toLocaleDateString('sv-SE');
    const block = `\n\n---\n\n### ${line(entry.word)}\n` + [
      ['音标', entry.phonetic], ['词性', entry.partOfSpeech], ['记录日期', date], ['中文释义', entry.meaning],
      ['英文例句', entry.example], ['中文翻译', entry.translation], ['同义词', entry.synonyms],
      ['记忆提示', entry.memory], ['来源', `huan-app · 长句翻译；${source.slice(0, 1000)}`]
    ].map(([label, value]) => `- **${label}**: ${line(value)}`).join('\n') + '\n';
    const temporary = join(dirname(path), `.huan-vocabulary-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', original.stat.mode & 0o777);
      try { await file.writeFile(original.content + block, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      const latest = await read();
      if (latest.content !== original.content || latest.stat.ino !== original.stat.ino || latest.stat.mtimeMs !== original.stat.mtimeMs)
        throw new Error('生词本刚被其他应用修改，请重试加入，已有内容已保留。');
      signal?.throwIfAborted();
      await rename(temporary, path);
      return 'added';
    } finally { await unlink(temporary).catch(() => undefined); }
  };
  const result = queue.then(save);
  queue = result.catch(() => undefined);
  return result;
}
