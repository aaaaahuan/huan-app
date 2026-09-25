// 配置持久化：校验输入、检查修改冲突，完整写入后再原子替换旧文件。
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { defaultSettings, PLATFORMS, settingsSchema, type Platform, type SettingsResult } from '@shared/contracts/settings';
import { createCredentials } from './credentials';

// 文件内容摘要作为修订标识，用于发现读取之后、保存之前已发生的外部修改。
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

export function createSettingsStore(directory: string) {
  const path = join(directory, 'settings.json');
  const credentials = createCredentials(directory);
  let saving = false;
  // 只有文件不存在时返回默认值；损坏或未知版本必须报错，不能自动覆盖。
  async function load(): Promise<SettingsResult> {
    try {
      if ((await stat(path)).size > 64 * 1024) throw new Error('Configuration too large');
      const text = await readFile(path, 'utf8');
      const parsed = settingsSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error('Unsupported configuration');
      return { ok: true, settings: parsed.data, revision: digest(text) };
    } catch (error) {
      if (missing(error)) return { ok: true, settings: defaultSettings(), revision: null };
      console.error('Settings load failed', error);
      return { ok: false, message: '无法读取设置，文件可能损坏、版本不支持或没有读取权限。原文件未修改，请检查 ~/.huan-app/settings.json 后重试。' };
    }
  }
  
  async function save(input: unknown, revision: unknown, keyChange?: unknown, consent = false): Promise<SettingsResult> {
    // IPC 参数在运行时并不可信，不能只依靠 TypeScript 类型声明。
    if (saving) return { ok: false, message: '正在保存设置，请稍后重试。' };
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success || !(revision === null || typeof revision === 'string'))
      return { ok: false, message: '设置格式不正确，请重新打开设置。' };
    if (keyChange !== undefined && keyChange !== null &&
      (typeof keyChange !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(keyChange)))
      return { ok: false, message: 'API Key 格式不正确，请检查是否包含空格或换行。' };
    saving = true;
    let createdKey: string | undefined;
    let committed = false;
    const temporary = join(directory, `.settings-${randomUUID()}.tmp`);
    try {
      const fields: Partial<Record<Platform, string>> = {};
      for (const platform of PLATFORMS) {
        const source = parsed.data.sources[platform];
        if (!source.path && !source.enabled) continue;
        if (!isAbsolute(source.path) || source.path.includes('\0') || !['.md', '.markdown'].includes(extname(source.path).toLowerCase())) {
          fields[platform] = '请选择 Markdown 文件的绝对路径。';
          continue;
        }
        // 停用来源可保留暂时离线的路径，启用时才要求文件当前存在且可读。
        if (!source.enabled) continue;
        try {
          if (!(await stat(source.path)).isFile()) throw new Error('Not a file');
          await access(source.path, constants.R_OK);
        } catch { fields[platform] = '文件不存在或不可读，请重新选择，或停用此来源。'; }
      }
      if (Object.keys(fields).length) return { ok: false, message: '请修正标出的来源后再保存。', fields };
      const current = await load();
      // 这是乐观冲突检查，不是对任意外部编辑器加文件锁。
      if (!current.ok) return current;
      if (current.revision !== revision) return { ok: false, message: '设置文件已被其他操作修改。请取消当前编辑并重新打开设置，避免覆盖新配置。' };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // 凭据先写新文件，再原子切换引用；UI 不能指定其他密钥或伪造授权记录。
      if (typeof keyChange === 'string') createdKey = await credentials.write(keyChange);
      parsed.data.ai = { credentialId: keyChange === null ? null : createdKey ?? current.settings.ai.credentialId,
        consentVersion: consent ? 2 : current.settings.ai.consentVersion };
      const text = JSON.stringify(parsed.data, null, 2) + '\n';
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      // 临时文件完全写入并 sync 后才替换正式文件，写入失败不会发布半份配置。
      await rename(temporary, path);
      committed = true;
      const oldKey = current.settings.ai.credentialId;
      if (oldKey && oldKey !== parsed.data.ai.credentialId) await credentials.remove(oldKey);
      return { ok: true, settings: parsed.data, revision: digest(text) };
    } catch (error) {
      console.error('Settings save failed', error);
      return { ok: false, message: '保存失败，请检查磁盘空间和 ~/.huan-app 的写入权限。原配置保留，可重试。' };
    } finally {
      await unlink(temporary).catch(() => undefined);
      if (createdKey && !committed) await credentials.remove(createdKey);
      saving = false;
    }
  }
  return { load, save,
    async getKey() {
      const result = await load();
      if (!result.ok) throw new Error(result.message);
      return credentials.read(result.settings.ai.credentialId);
    },
    async allowMaterials() {
      const result = await load();
      if (!result.ok) throw new Error(result.message);
      const saved = await save(result.settings, result.revision, undefined, true);
      if (!saved.ok) throw new Error(saved.message);
    }
  };
}
