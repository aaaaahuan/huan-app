import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function createCredentials(directory: string) {
  const path = (id: string) => join(directory, `key-${id}.bin`);
  return {
    async write(key: string) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，未保存 API Key。');
      const id = randomUUID();
      const encrypted = safeStorage.encryptString(key);
      const file = await open(path(id), 'wx', 0o600);
      try { await file.writeFile(encrypted); await file.sync(); }
      catch (error) { await unlink(path(id)).catch(() => undefined); throw error; }
      finally { await file.close(); }
      return id;
    },
    async read(id: string | null) {
      if (!id) throw new Error('请先在设置中填写 DeepSeek API Key。');
      try { return safeStorage.decryptString(await readFile(path(id))); }
      catch { throw new Error('无法解密 API Key，请在设置中重新填写。'); }
    },
    async remove(id: string) { await unlink(path(id)).catch(() => undefined); }
  };
}
