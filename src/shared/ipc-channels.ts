// 主进程与 preload 共用的通道名称；保持纯常量，避免给沙箱 preload 引入运行时依赖。
// 请求使用 invoke/handle，browser.state 使用 send/on 推送状态；处理函数仍归属各业务模块。
export const IPC_CHANNELS = {
  app: { status: 'huan-app:app:status' },
  // 设置模块
  settings: {
    load: 'huan-app:settings:load',
    save: 'huan-app:settings:save',
    chooseFile: 'huan-app:settings:choose-file'
  },
  // 收藏帖子模块
  bookmarks: { get: 'huan-app:bookmarks:get' },
  // 浏览器模块
  browser: {
    sessionModes: 'huan-app:browser:session-modes',
    clearSession: 'huan-app:browser:clear-session',
    get: 'huan-app:browser:get',
    select: 'huan-app:browser:select',
    action: 'huan-app:browser:action',
    layout: 'huan-app:browser:layout',
    suspend: 'huan-app:browser:suspend',
    state: 'huan-app:browser:state'
  }
} as const;
