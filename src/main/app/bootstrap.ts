// 桌面应用的组装层：管理窗口、可信页面、IPC 和 macOS 生命周期。
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { assetPath, developmentOrigin, trustedDocument, UI_URL } from './security';
import { registerSettings } from '@main/settings/ipc';
import { createSettingsStore } from '@main/settings/store';
import { createBookmarkLibrary } from '@main/bookmarks/library';
import { createPageHost } from '@main/browser/page-host';
import { registerBrowser } from '@main/browser/ipc';
import { createPlatformSessions } from '@main/browser/sessions';
import { defaultSessionModes } from '@shared/contracts/settings';

// 协议权限必须在 app ready 前声明；生产界面通过 app:// 加载，不依赖开发服务器。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
app.setName('huan-app');
// 用户数据独立于安装包保存，相关的数据存放到.huan-app下面
app.setPath('userData', join(app.getPath('home'), '.huan-app'));
app.setPath('sessionData', app.getPath('userData'));
let window: BrowserWindow | undefined;
let quitting = false;

// 只保留一个应用实例；再次启动时唤起原窗口，避免多个实例同时写配置。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('activate', () => { window?.show(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  void app.whenReady().then(async () => {
    const devUrl = !app.isPackaged ? developmentOrigin(process.env.ELECTRON_RENDERER_URL) : undefined;
    const rendererRoot = join(__dirname, '../renderer');
    // 这是应用自身 UI 的内存会话，不是未来第三方平台的登录会话。
    const uiSession = session.fromPartition('huan-app-ui');
    uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    uiSession.setPermissionCheckHandler(() => false);
    // 只提供界面构建目录内的静态文件，路径越界或非 GET 请求直接拒绝。
    await uiSession.protocol.handle('app', async (request) => {
      const path = assetPath(rendererRoot, request.url);
      if (!path || request.method !== 'GET') return new Response(null, { status: 403 });
      try {
        const content = await readFile(path);
        const mime: Record<string, string> = {
          '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
          '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
        };
        // CSP 限制页面资源来源；不能用它替代下方的 IPC 发送者校验。
        return new Response(content, { headers: {
          'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"
        } });
      } catch { return new Response(null, { status: 404 }); }
    });

    await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
    window = new BrowserWindow({
      title: 'huan-app', width: 1240, height: 820, minWidth: 900, minHeight: 640,
      show: false, backgroundColor: '#f5f7f4', titleBarStyle: 'hiddenInset',
      webPreferences: {
        // React 不直接获得 Node 权限；仅通过隔离的 preload 使用明确开放的能力。
        session: uiSession, preload: join(__dirname, '../preload/index.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true
      }
    });

    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!trustedDocument(url, devUrl)) event.preventDefault();
    });
    // 同时检查所属窗口、主 frame 和页面地址，防止其他页面借用应用接口。
    const assertTrusted = (event: IpcMainInvokeEvent) => {
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !trustedDocument(event.senderFrame.url, devUrl)) throw new Error('Untrusted sender');
    };

    // 注册设置模块和浏览器模块的 IPC 事件处理函数。
    const settings = createSettingsStore(app.getPath('userData'));
    const bookmarks = createBookmarkLibrary(app.getPath('userData'), settings.load);
    const initialSettings = await settings.load();
    // 配置损坏时只使用内存会话，不猜测用户是否同意保存登录态。
    const sessions = createPlatformSessions(initialSettings.ok ? initialSettings.settings.sessions : defaultSessionModes());
    registerBrowser(window, createPageHost(window, bookmarks.get, sessions), assertTrusted);
    registerSettings(window, settings, assertTrusted, bookmarks.update);

    ipcMain.handle(IPC_CHANNELS.bookmarks.get, (event) => {
      assertTrusted(event);
      return bookmarks.get();
    });
    ipcMain.handle(IPC_CHANNELS.app.status, async (event) => {
      assertTrusted(event);
      return { state: 'ready', appName: 'huan-app', version: app.getVersion() };
    });
    
    // 设置页通过 beforeunload 阻止丢失草稿，再由主进程显示原生确认框。
    contents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window!, {
        type: 'question', buttons: ['继续编辑', '放弃并离开'], defaultId: 0, cancelId: 0,
        message: '设置尚未保存', detail: '离开将丢失未保存的修改。正在保存时请继续等待。'
      });
      // 这里取消的是“阻止卸载”，因此 preventDefault 表示允许离开页面。
      if (choice === 1) event.preventDefault();
      else quitting = false;
    });
    // macOS 关闭窗口只隐藏，保留本轮列表与草稿；Cmd+Q 才完全退出。
    window.on('close', (event) => {
      if (!quitting && process.platform === 'darwin') { event.preventDefault(); window?.hide(); }
    });
    window.on('ready-to-show', () => window?.show());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'huan-app', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
    ]));
    await window.loadURL(devUrl ?? UI_URL);
  }).catch((error: unknown) => {
    console.error('Application startup failed', error);
    app.quit();
  });
}
