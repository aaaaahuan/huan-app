// 管理唯一的原页容器；切换收藏销毁旧容器，旧事件不得回填新收藏状态。
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { WebContentsView, type BrowserWindow } from 'electron';
import type { BookmarkLibrary, Bookmark } from '@shared/contracts/bookmarks';
import type { ReaderAction, ReaderLayout, ReaderState } from '@shared/contracts/browser';
import { validBookmarkUrl } from '@main/bookmarks/markdown';
import type { createPlatformSessions } from './sessions';
import type { Platform } from '@shared/contracts/settings';
import { extractReadablePage } from './readability';
import { createPageStore } from './page-store';

/** 创建原页容器的主机对象。 */
export function createPageHost(window: BrowserWindow, getLibrary: () => Promise<BookmarkLibrary>, sessions: ReturnType<typeof createPlatformSessions>) {
  const pages = createPageStore();
  let view: WebContentsView | undefined;
  let bookmark: Bookmark | undefined;
  let selection = 0;
  let navigationEpoch = 0;
  let suspended = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let layout: ReaderLayout = { x: 0, y: 0, width: 0, height: 0, visible: false };
  let state: ReaderState = { revision: 0, bookmarkId: null, phase: 'empty', url: '', title: '',
    message: '', notice: '', canGoBack: false, canGoForward: false, contentStatus: 'empty' };
  const configured = new Set<string>();

  function applyLayout() {
    if (!view || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    // 坐标来自可信 UI，但仍裁剪到窗口内容区域，保留顶部系统操作区。
    const x = Math.max(0, Math.min(width, Math.round(layout.x)));
    const y = Math.max(58, Math.min(height, Math.round(layout.y)));
    const right = Math.min(width, Math.round(layout.x + layout.width));
    const bottom = Math.min(height, Math.round(layout.y + layout.height));
    const bounds = { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
    view.setBounds(bounds);
    view.setVisible(!suspended && layout.visible && window.isVisible() && bounds.width > 0 && bounds.height > 0
      && state.phase !== 'empty' && state.phase !== 'error');
  }

  function publish(change: Partial<ReaderState> = {}) {
    const contents = view?.webContents;
    state = { ...state, ...change, revision: state.revision + 1, contentStatus: pages.current()?.status ?? 'empty',
      canGoBack: !!contents && !contents.isDestroyed() && contents.navigationHistory.canGoBack(),
      canGoForward: !!contents && !contents.isDestroyed() && contents.navigationHistory.canGoForward() };
    applyLayout();
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.browser.state, state);
    return state;
  }

  function clearDeadline() { clearTimeout(deadline); deadline = undefined; }
  function disposeView() {
    pages.clearCurrent();
    navigationEpoch++;
    clearDeadline();
    const old = view;
    view = undefined;
    if (!old) return;
    if (!window.isDestroyed()) window.contentView.removeChildView(old);
    // 切换收藏不能被远程页面的 beforeunload 留住，也不能保留隐藏的媒体进程。
    if (!old.webContents.isDestroyed()) old.webContents.close({ waitForBeforeUnload: false });
  }
  function armDeadline(target: WebContentsView) {
    clearDeadline();
    deadline = setTimeout(() => {
      if (view !== target) return;
      navigationEpoch++;
      const page = pages.current();
      if (page) pages.fail(page.id);
      publish({ phase: 'error', message: '页面加载超过 30 秒，请检查网络后重试。' });
      target.webContents.stop();
    }, 30_000);
  }
  
  function load(target: WebContentsView, url: string) {
    if (view !== target || !validBookmarkUrl(url)) return;
    publish({ phase: 'loading', url, message: '', notice: '' });
    armDeadline(target);
    // 加载失败通过 did-fail-load 展示；这里接住 Promise，避免取消导航产生未处理拒绝。
    void target.webContents.loadURL(url).catch(() => undefined);
  }

  /** 创建新容器，加载收藏链接。 */
  function create(item: Bookmark) {
    const partition = item.platform;
    const remoteSession = sessions.get(item.platform);
    
    if (!configured.has(partition)) {
      configured.add(partition);
      remoteSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      remoteSession.setPermissionCheckHandler(() => false);
      remoteSession.on('will-download', (event, _item, contents) => {
        event.preventDefault();
        if (contents === view?.webContents) publish({ notice: '本阶段不提供下载，下载请求已拦截。' });
      });
    }
    const target = new WebContentsView({ webPreferences: {
      session: remoteSession, sandbox: true, contextIsolation: true,
      // 切到其他窗口后仍允许原页正常调度，避免动态正文因后台节流延迟渲染。
      backgroundThrottling: false,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
      allowRunningInsecureContent: false, navigateOnDragDrop: false
    } });
    view = target;
    target.setVisible(false);
    target.setBackgroundColor('#ffffff');
    window.contentView.addChildView(target);
    const contents = target.webContents;
    const active = () => view === target && !contents.isDestroyed();
    let navigationUrl = '';

    let extractionTimer: ReturnType<typeof setTimeout> | undefined;
    let extractionRequest = 0;
    function cancelExtraction() {
      clearTimeout(extractionTimer);
      extractionRequest++;
    }
    function scheduleExtraction() {
      cancelExtraction();
      const page = pages.current();
      if (!active() || page?.status !== 'loading') return;
      const pageId = page.id;
      const epoch = navigationEpoch;
      const request = extractionRequest;
      const isCurrent = () => active() && navigationEpoch === epoch && extractionRequest === request;
      let attempts = 0;
      async function attempt() {
        if (!isCurrent()) return;
        attempts++;
        try {
          const content = await extractReadablePage(contents);
          if (!isCurrent()) return;
          if (content) { pages.complete(pageId, content); publish(); return; }
          if (attempts < 4) extractionTimer = setTimeout(() => void attempt(), 1500);
          else { pages.fail(pageId); publish(); console.warn('[Readability] 未识别到文章正文，已停止重试'); }
        } catch (error) {
          if (isCurrent()) { pages.fail(pageId); publish(); console.warn('[Readability] 提取失败', error); }
        }
      }
      // load 完成时动态正文可能尚未渲染；延迟首次提取，只对空结果有限重试。
      extractionTimer = setTimeout(() => void attempt(), 1500);
    }
    contents.once('destroyed', cancelExtraction);

    contents.setWindowOpenHandler((details) => {
      if (!active()) return { action: 'deny' };
      // 普通新标签链接转到当前页；表单弹窗不能降级成 GET，以免破坏登录流程。
      if (details.postBody || !validBookmarkUrl(details.url)) publish({ notice: '已拦截独立窗口或非网页链接，本阶段不启动外部应用。' });
      else load(target, details.url);
      return { action: 'deny' };
    });

    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame && !validBookmarkUrl(event.url)) {
        event.preventDefault();
        if (active()) publish({ notice: '仅允许在容器中打开 HTTP/HTTPS 网页。' });
      }
    });
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame && !validBookmarkUrl(event.url)) {
        event.preventDefault();
        if (active()) publish({ notice: '已拦截非网页地址的重定向。' });
      }
    });
    contents.on('did-start-navigation', (event) => {
      if (!active() || !event.isMainFrame) return;
      if (event.isSameDocument && event.url.split('#')[0] === navigationUrl.split('#')[0]) return;
      navigationEpoch++;
      cancelExtraction();
      navigationUrl = event.url;
      pages.begin(event.url);
      publish();
      if (event.isSameDocument) return;
      publish({ phase: 'loading', url: event.url, message: '', notice: '' });
      armDeadline(target);
    });

    contents.on('did-finish-load', () => {
      scheduleExtraction();
    });

    contents.on('did-navigate', (_event, url, responseCode) => {
      if (!active()) return;
      // 重定向后的真实页面拥有独立快照，不沿用重定向前的身份。
      if (navigationUrl !== url) { navigationUrl = url; pages.begin(url); }
      // HTTP 错误页仍展示原站内容，避免隐藏网站自己的登录或验证提示。
      publish({ url, notice: responseCode >= 400 ? `原站返回 HTTP ${responseCode}，正在展示网站响应。` : '' });
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (active() && isMainFrame) {
        clearDeadline();
        publish({ url, phase: 'ready', message: '' });
        scheduleExtraction();
      }
    });
    contents.on('page-title-updated', (_event, title) => { if (active()) publish({ title }); });
    contents.on('did-stop-loading', () => {
      if (!active()) return;
      clearDeadline();
      publish(state.phase === 'loading' ? { phase: 'ready', message: '' } : {});
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!active() || !isMainFrame || code === -3) return;
      clearDeadline();
      const page = pages.current();
      if (page) pages.fail(page.id);
      publish({ phase: 'error', url, message: `页面加载失败（${description} / ${code}），可重试或选择其他收藏。` });
    });
    contents.on('render-process-gone', (_event, details) => {
      if (!active()) return;
      cancelExtraction();
      const page = pages.current();
      if (page) pages.fail(page.id);
      clearDeadline();
      publish({ phase: 'error', message: `页面进程已停止（${details.reason}），请重试。` });
    });
    contents.on('destroyed', () => {
      if (view !== target) return;
      clearDeadline();
      view = undefined;
      pages.clearCurrent();
      if (!window.isDestroyed()) window.contentView.removeChildView(target);
      publish({ phase: 'error', message: '页面已关闭，请重新加载。' });
    });
    // 不让站点自行切换全屏，避免隐藏宿主设置和导航控制。
    contents.on('enter-html-full-screen', () => { if (active()) contents.executeJavaScript('document.exitFullscreen?.()').catch(() => undefined); });
    load(target, item.url);
  }

  async function select(id: string | null) {
    if (id === state.bookmarkId && view) return state;
    const request = ++selection;
    disposeView();
    bookmark = undefined;
    publish({ bookmarkId: id, phase: id ? 'loading' : 'empty', url: '', title: '', message: '', notice: '' });
    if (!id) return state;
    const library = await getLibrary();
    if (request !== selection || window.isDestroyed()) return state;
    const item = library.sources.flatMap((source) => source.items).find((entry) => entry.id === id);
    if (!item || !validBookmarkUrl(item.url)) return publish({ phase: 'error', message: '此收藏已不可用，请重新选择。' });
    bookmark = item;
    try { create(item); }
    catch (error) { console.error('Reader creation failed', error); disposeView(); publish({ phase: 'error', message: '无法创建网页容器，请重试。' }); }
    return state;
  }

  function action(id: string, command: ReaderAction) {
    if (id !== state.bookmarkId || !bookmark) return state;
    if (command === 'reload' && (!view || view.webContents.isDestroyed() || view.webContents.isCrashed())) {
      const url = validBookmarkUrl(state.url) ? state.url : bookmark.url;
      disposeView();
      try { create({ ...bookmark, url }); }
      catch { disposeView(); publish({ phase: 'error', message: '无法创建网页容器，请重试。' }); }
      return state;
    }
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) return state;
    if (command === 'stop') {
      navigationEpoch++;
      const page = pages.current();
      if (page) pages.fail(page.id);
      clearDeadline();
      publish({ phase: 'stopped', message: '已停止加载，可刷新页面继续。' });
      contents.stop();
    } else if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else if (command === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    else if (command === 'reload') {
      // 停止的导航可能尚未提交，reload 会重载旧页甚至空白页；按目标地址重试。
      if (state.phase === 'error' || state.phase === 'stopped') load(view!, validBookmarkUrl(state.url) ? state.url : bookmark.url);
      else contents.reload();
    }
    return state;
  }
  window.on('hide', () => view?.setVisible(false));
  window.on('show', applyLayout);
  // 缩放期间先隐藏旧矩形，等 React 上报新布局，避免暂时覆盖侧栏或标题栏。
  window.on('resize', () => view?.setVisible(false));
  window.on('closed', () => { selection++; disposeView(); pages.clear(); });
  window.webContents.on('render-process-gone', () => { selection++; disposeView(); });
  window.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) { selection++; disposeView(); suspended = false; }
  });

  return {
    get: () => state, select, action,
    snapshot: () => suspended ? { pages: [] } : pages.snapshot(),
    sessionModes: sessions.modes,
    async clearSession(platform: Platform) {
      pages.clear();
      const affected = bookmark?.platform === platform;
      // 先销毁当前网页，避免网页脚本在清理期间重新写入 Cookie 或存储。
      if (affected) {
        selection++;
        disposeView();
        publish({ phase: 'error', message: '正在清除平台会话…' });
      }
      try {
        await sessions.clear(platform);
        if (affected) publish({ phase: 'error', message: '平台会话已清除，点击刷新后按原站流程重新登录。' });
        return { ok: true, cancelled: false } as const;
      } catch (error) {
        console.error('Session clearing failed', error);
        if (affected) publish({ phase: 'error', message: '会话未完全清除，请在设置中重试。' });
        return { ok: false, message: '会话未完全清除，请重试。收藏与笔记未修改。' } as const;
      }
    },
    suspend(value: boolean) { suspended = value; applyLayout(); },
    layout(value: ReaderLayout) { layout = value; applyLayout(); }
  };
}
