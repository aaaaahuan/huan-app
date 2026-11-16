import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 旧安装仍经兼容链接访问同一份数据，迁移不复制或合并 Chromium 数据库。 */
export function prepareBrowserSessionDirectory(home: string, userData: string): string {
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const root = join(home, '.local', 'share', 'huan', 'browser-sessions', 'electron');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const previous = join(userData, 'Partitions');
  const target = join(root, 'Partitions');
  const previousStat = lstatSync(previous, { throwIfNoEntry: false });
  if (previousStat?.isSymbolicLink()) {
    if (resolve(userData, readlinkSync(previous)) !== target) throw new Error('浏览器登录目录指向其他位置，请先检查现有配置。');
  } else if (previousStat) {
    if (existsSync(target)) throw new Error('新旧登录目录同时存在，已停止迁移以保留两份数据。');
    renameSync(previous, target);
    try { symlinkSync(target, previous, 'dir'); }
    catch (error) { renameSync(target, previous); throw error; }
  } else {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    symlinkSync(target, previous, 'dir');
  }
  // 保留 Chromium 的本机加密元数据，Cookie 私钥仍由原 macOS Keychain 管理。
  const oldState = join(userData, 'Local State');
  const newState = join(root, 'Local State');
  if (existsSync(oldState) && !existsSync(newState)) {
    copyFileSync(oldState, newState);
    chmodSync(newState, 0o600);
  }
  return root;
}
