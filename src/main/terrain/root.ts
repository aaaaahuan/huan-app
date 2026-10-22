import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function resolveHuanPathRoot(environment: string | undefined, packaged: boolean, appPath: string): string {
  if (environment?.trim()) return resolve(environment.trim());
  if (packaged) throw new Error('安装版请通过 HUAN_PATH_ROOT 环境变量指定 huan-path 代码目录。');
  return resolve(dirname(appPath), 'huan-path');
}

export async function validateHuanPathRoot(root: string): Promise<void> {
  for (const file of ['server.py', '.venv/bin/python']) {
    try { if (!(await stat(join(root, file))).isFile()) throw new Error('Invalid file'); }
    catch { throw new Error(`huan-path 代码目录缺少文件：${join(root, file)}。请检查 HUAN_PATH_ROOT 和 Python 环境。`); }
  }
}

export function resolveTerrainDataDir(configured: string, home: string): string {
  return configured.trim() || join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/huan-space/project/huan-project/huan-path');
}

export async function validateTerrainDataDir(directory: string): Promise<void> {
  if (!isAbsolute(directory) || directory.includes('\0')) throw new Error('地形数据目录必须是绝对路径。');
  try {
    try {
      if (!(await stat(directory)).isDirectory()) throw new Error('所选路径不是目录');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      if (!(await stat(dirname(directory))).isDirectory()) throw new Error('父目录不存在或不是目录', { cause: error });
    }
    await mkdir(join(directory, 'jobs'), { recursive: true });
    await mkdir(join(directory, 'tracks'), { recursive: true });
  } catch (error) { throw new Error(`地形数据目录不可用：${directory}。请确认父目录存在且可写。${error instanceof Error ? error.message : ''}`, { cause: error }); }
}
