// 保存策略按启动时的配置固定，避免编辑设置时替换正在登录的页面会话。
import { session } from 'electron';
import type { Platform, SessionMode, SessionModes } from '@shared/contracts/settings';

export function createPlatformSessions(modes: SessionModes) {
  const activeModes = { ...modes };
  const partition = (platform: Platform, mode: SessionMode) =>
    `${mode === 'persistent' ? 'persist:' : ''}huan-app-reader-${platform}`;
  return {
    modes: () => ({ ...activeModes }),
    get: (platform: Platform) => session.fromPartition(partition(platform, activeModes[platform])),
    async clear(platform: Platform) {
      // 同时清除历史持久分区和本轮内存分区，防止切回保存模式时恢复旧账号。
      for (const mode of ['memory', 'persistent'] as const) {
        const target = session.fromPartition(partition(platform, mode));
        await target.closeAllConnections();
        await target.clearData();
        await target.clearAuthCache();
        target.flushStorageData();
        await target.cookies.flushStore();
      }
    }
  };
}
