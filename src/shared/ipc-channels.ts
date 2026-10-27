// 主进程与 preload 共用的通道名称；保持纯常量，避免给沙箱 preload 引入运行时依赖。
// 请求使用 invoke/handle，browser.state 使用 send/on 推送状态；处理函数仍归属各业务模块。
export const IPC_CHANNELS = {
  terrain: {
    readAsset: 'huan-app:terrain:read-asset', ensure: 'huan-app:terrain:ensure', autoRoot: 'huan-app:terrain:auto-root',
    // listJobs/getJob 已接通原生只读实现；其余原生通道仍预留。
    status: 'huan-app:terrain:status', listJobs: 'huan-app:terrain:list-jobs',
    getJob: 'huan-app:terrain:get-job', upload: 'huan-app:terrain:upload', retry: 'huan-app:terrain:retry', cancel: 'huan-app:terrain:cancel',
    getHouses: 'huan-app:terrain:get-houses', saveHouses: 'huan-app:terrain:save-houses',
    importRoads: 'huan-app:terrain:import-roads', openModelsDir: 'huan-app:terrain:open-models-dir',
    exportModel: 'huan-app:terrain:export-model'
  },
  app: { status: 'huan-app:app:status' },
  algorithms: { get: 'huan-app:algorithms:get', refresh: 'huan-app:algorithms:refresh',
    setCompleted: 'huan-app:algorithms:set-completed', open: 'huan-app:algorithms:open',
    getNote: 'huan-app:algorithms:get-note', noteIndex: 'huan-app:algorithms:note-index',
    saveNote: 'huan-app:algorithms:save-note', copyNote: 'huan-app:algorithms:copy-note',
    openNote: 'huan-app:algorithms:open-note', openNoteLink: 'huan-app:algorithms:open-note-link',
    notesChanged: 'huan-app:algorithms:notes-changed' },
  translation: { getStatus: 'huan-app:translation:get-status', translate: 'huan-app:translation:translate',
    stop: 'huan-app:translation:stop', copy: 'huan-app:translation:copy', status: 'huan-app:translation:status' },
  subtitles: { get: 'huan-app:subtitles:get', ensure: 'huan-app:subtitles:ensure',
    seek: 'huan-app:subtitles:seek', state: 'huan-app:subtitles:state' },
  ai: {
    getSelection: 'huan-app:ai:get-selection', selectModel: 'huan-app:ai:select-model',
    get: 'huan-app:ai:get', draft: 'huan-app:ai:draft',
    send: 'huan-app:ai:send', stop: 'huan-app:ai:stop',
    restart: 'huan-app:ai:restart', testKey: 'huan-app:ai:test-key', state: 'huan-app:ai:state'
  },
  // 设置模块
  settings: {
    load: 'huan-app:settings:load',
    save: 'huan-app:settings:save',
    subtitleUsage: 'huan-app:settings:subtitle-usage', openSubtitleAccount: 'huan-app:settings:subtitle-account',
    revealAIKey: 'huan-app:settings:reveal-ai-key',
    revealSubtitleKey: 'huan-app:settings:reveal-subtitle-key',
    chooseDirectory: 'huan-app:settings:choose-directory',
    chooseFile: 'huan-app:settings:choose-file'
  },
  // 收藏帖子模块
  bookmarks: { get: 'huan-app:bookmarks:get', setRead: 'huan-app:bookmarks:set-read' },
  // 浏览器模块
  browser: {
    sessionModes: 'huan-app:browser:session-modes',
    clearSession: 'huan-app:browser:clear-session',
    get: 'huan-app:browser:get',
    select: 'huan-app:browser:select',
    action: 'huan-app:browser:action',
    captureContext: 'huan-app:browser:capture-context',
    clearContext: 'huan-app:browser:clear-context',
    layout: 'huan-app:browser:layout',
    suspend: 'huan-app:browser:suspend',
    state: 'huan-app:browser:state'
  }
} as const;
