import { app, BrowserWindow, ipcMain, Menu, protocol, session } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { STATUS_CHANNEL } from '../../shared/contracts/app';
import { assetPath, developmentOrigin, trustedDocument, UI_URL } from './security';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
app.setName('huan-app');
app.setPath('userData', join(app.getPath('home'), '.huan-app'));
let window: BrowserWindow | undefined;
let quitting = false;

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
    const uiSession = session.fromPartition('huan-app-ui');
    uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    uiSession.setPermissionCheckHandler(() => false);
    await uiSession.protocol.handle('app', async (request) => {
      const path = assetPath(rendererRoot, request.url);
      if (!path || request.method !== 'GET') return new Response(null, { status: 403 });
      try {
        const content = await readFile(path);
        const mime: Record<string, string> = {
          '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
          '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
        };
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
        session: uiSession, preload: join(__dirname, '../preload/index.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true
      }
    });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!trustedDocument(url, devUrl)) event.preventDefault();
    });
    ipcMain.handle(STATUS_CHANNEL, async (event) => {
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
          !trustedDocument(event.senderFrame.url, devUrl)) throw new Error('Untrusted sender');
      return { state: 'ready', appName: 'huan-app', version: app.getVersion() };
    });
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
