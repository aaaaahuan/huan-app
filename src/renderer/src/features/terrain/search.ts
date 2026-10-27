import type { TerrainJobSummary } from '@shared/contracts/terrain';

export const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function matchScore(text: string, query: string): number {
  const name = normalize(text), chars = Array.from(normalize(query));
  if (!chars.length) return 0;
  const at = name.indexOf(chars.join(''));
  if (at >= 0) return at ? 1 : 0;
  let index = 0;
  for (const char of name) if (char === chars[index] && ++index === chars.length) return 2;
  return -1;
}

export function filteredRows(rows: TerrainJobSummary[], query: string): TerrainJobSummary[] {
  if (!normalize(query)) return rows;
  return rows.map((row, index) => {
    const scores = [row.name, row.filename].map(text => matchScore(text, query)).filter(score => score >= 0);
    return { row, index, score: scores.length ? Math.min(...scores) : -1 };
  }).filter(item => item.score >= 0).sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.row);
}
