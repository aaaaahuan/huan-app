import { app } from 'electron';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { LookupRequest, TranslationResult } from '@shared/contracts/translation';
let queue: Promise<void> = Promise.resolve();
/** 独立学习日志：每次查询均记一条，避免依赖模型执行日志反推学习行为。 */
export function recordTranslation(request: LookupRequest, result: TranslationResult) {
  const entry = { version: 1, at: new Date().toISOString(), requestId: request.requestId, direction: request.direction,
    text: request.text, normalized: request.text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '),
    source: request.source ?? { module: 'translation', trigger: 'manual' }, status: result.status,
    translation: result.text, phonetic: result.phonetic, error: result.error, metrics: result.metrics };
  const pending = queue.then(async () => {
    const directory = join(app.getPath('userData'), 'translation');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = await open(join(directory, 'queries.jsonl'), 'a', 0o600);
    try { await file.writeFile(JSON.stringify(entry) + '\n'); await file.sync(); } finally { await file.close(); }
  });
  queue = pending.catch(() => undefined);
  return pending;
}
