import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ideaDraftSchema, type IdeaDraft } from '@shared/contracts/ideas';

export function createIdeaDraftStore(path: string) {
  let pending: Promise<unknown> = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation); pending = result.catch(() => undefined); return result;
  }
  return {
    get: () => serialize(async () => {
      try { const value: unknown = JSON.parse(await readFile(path, 'utf8')); return ideaDraftSchema.parse(value); }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { text: '' }; throw error; }
    }),
    save: (draft: IdeaDraft) => serialize(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(`${path}.tmp`, JSON.stringify(draft), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    }),
    flush: () => pending
  };
}
