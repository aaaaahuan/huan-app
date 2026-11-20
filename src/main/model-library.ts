import { homedir } from 'node:os';
import { join } from 'node:path';

// 地形成果和 3D 收藏使用同一模型库；测试可指向隔离目录。
export function modelLibraryDirectory() {
  return process.env.HUAN_MODEL_LIBRARY_DIR || join(homedir(), 'Desktop/workspace/huan/huan-model/models');
}
export const pathModelDirectory = () => join(modelLibraryDirectory(), 'path-model');
export const studioModelDirectory = () => join(modelLibraryDirectory(), '3d-model');
