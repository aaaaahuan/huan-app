import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// 早期版本默认放在 Obsidian 笔记库；保存过该路径的配置视为未设置，回到仓库内默认目录。
const LEGACY_OBSIDIAN_DATA_DIR = 'Library/Mobile Documents/iCloud~md~obsidian/Documents/huan-space/project/huan-project/huan-path';

// electron-vite 将主进程编译到 <repo>/out/main；从该目录上溯两级即仓库根。
export function developmentRepoRoot(mainDirname: string): string {
  return resolve(mainDirname, '../..');
}

// 开发态默认使用仓库内 terrain-data/，随 huan-app 一起纳入 Git；安装版改用 userData。
// 存在 ELECTRON_RENDERER_URL 时强制开发态路径，避免 isPackaged 误判落到 ~/.huan-app/terrain-data。
export function defaultTerrainDataDir(_appPath: string, packaged: boolean, userData: string, mainDirname: string): string {
  if (!packaged || process.env.ELECTRON_RENDERER_URL) return resolve(developmentRepoRoot(mainDirname), 'terrain-data');
  return join(userData, 'terrain-data');
}

export function resolveTerrainDataDir(configured: string, fallback: string): string {
  const value = configured.trim();
  if (!value || resolve(value).replace(/\/+$/, '').endsWith(LEGACY_OBSIDIAN_DATA_DIR)) return fallback;
  return value;
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
