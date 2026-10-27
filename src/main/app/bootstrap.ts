// 桌面应用的组装层：管理窗口、可信页面、IPC 和 macOS 生命周期。
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
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
import { defaultSessionModes, defaultSettings } from '@shared/contracts/settings';
import { registerReading } from '@main/ai/agent/reading-ipc';
import { registerModelControls } from '@main/ai/core/model-controls-ipc';
import { setReadSchema } from '@shared/contracts/bookmarks';
import { createSubtitleService } from '@main/subtitles/service';
import { registerSubtitles } from '@main/subtitles/ipc';
import { createYouTubePlayback } from '@main/browser/youtube-playback';
import { youtubeVideoId } from '@shared/contracts/subtitles';
import { registerTranslation } from '@main/translation';
import { createLocalModelRuntime } from '@main/ai/core/local-model';
import { createExecutionRecordStore } from '@main/ai/core/records';
import { createPiAdapter } from '@main/ai/core/pi-adapter';
import { createAIService } from '@main/ai/core/service';
import { createModelTargetResolver } from '@main/ai/core/model-target';
import { createReadingAgentConfig } from '@main/ai/agent/reading-agent';
import { createTranslateAgentConfig } from '@main/ai/agent/translate-agent';
import { createKeyTestAgentConfig } from '@main/ai/agent/key-test-agent';
import { createAlgorithmLibrary } from '@main/algorithms/library';
import { registerAlgorithms } from '@main/algorithms/ipc';
import { registerTerrain } from '@main/terrain/service';
import { createAlgorithmNotes } from '@main/algorithms/notes';

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
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); }
  });
  app.on('activate', () => {
    if (window && !window.isDestroyed()) window.show();
  });
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
      title: 'huan-app', width: 1240, height: 820, minWidth: 940, minHeight: 640,
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
    // 算法清单只使用约定的本机 Obsidian 文件，renderer 不能指定任意读写路径。
    const algorithmVault = join(app.getPath('home'), 'Library', 'Mobile Documents',
      'iCloud~md~obsidian', 'Documents', 'huan-space');
    const algorithms = createAlgorithmLibrary(join(algorithmVault, 'raw', 'leetcode-raw.md'));
    const algorithmNotes = createAlgorithmNotes(algorithmVault, () => {
      if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.algorithms.notesChanged);
    });
    registerAlgorithms(algorithms, algorithmNotes, assertTrusted);
    const bookmarks = createBookmarkLibrary(app.getPath('userData'), settings.load);
    const initialSettings = await settings.load();
    // 配置损坏时只使用内存会话，不猜测用户是否同意保存登录态。
    const sessions = createPlatformSessions(initialSettings.ok ? initialSettings.settings.sessions : defaultSessionModes());
    const pageHost = createPageHost(window, bookmarks.get, sessions);
    registerBrowser(window, pageHost, assertTrusted);
    let currentVideo = () => youtubeVideoId(pageHost.get().url);
    const subtitles = createSubtitleService(initialSettings.ok ? initialSettings.settings : defaultSettings(),
      () => currentVideo(), settings.getSubtitleKey, state => {
        if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.subtitles.state, state);
      }, async signal => {
        const answer = await dialog.showMessageBox(window!, { type: 'warning', signal, buttons: ['取消', '确认新建'], defaultId: 0, cancelId: 0,
          message: '重新创建字幕任务？', detail: '旧提交可能已受理或属于另一账户。新建可能重复计次或产生费用，本地取消不会取消服务端任务。' });
        return answer.response === 1;
      });
    const playback = createYouTubePlayback(pageHost, subtitles.bind, subtitles.updatePlayback, subtitles.prefetch);
    currentVideo = playback.currentVideo;
    registerSubtitles(subtitles, playback, assertTrusted);
    pageHost.observeSessionClear(platform => { if (platform === 'youtube') subtitles.clear(); });

    const terrain = registerTerrain(assertTrusted, async () => {
      const result = await settings.load();
      if (!result.ok) throw new Error(result.message);
      return result.settings.terrain.dataDir;
    });
    const localModel = createLocalModelRuntime(contents, async () => {
      const result = await settings.load();
      if (!result.ok) throw new Error(result.message);
      return result.settings.localModel;
    });
    const recordRoot = join(app.getPath('userData'), 'ai');
    const records = await createExecutionRecordStore({ root: recordRoot });
    const piAdapter = await createPiAdapter({ records, recordRoot });
    const aiService = createAIService({
      piAdapter, records, resolveModelTarget: createModelTargetResolver({ settings, localModel })
    });
    const keyTestKeys = new Map<string, string>();

    // 创建不同模块专用的agent
    const readingAgent = aiService.createAgent(createReadingAgentConfig());
    const translateAgent = aiService.createAgent(createTranslateAgentConfig());
    const keyTestAgent = aiService.createAgent(createKeyTestAgentConfig(runId => keyTestKeys.get(runId)));

    registerModelControls(window, settings, assertTrusted, keyTestAgent, keyTestKeys);
    const reading = registerReading(window, pageHost, settings, assertTrusted, subtitles.snapshot, readingAgent);
    const translation = registerTranslation(contents, assertTrusted, localModel, translateAgent);
    registerSettings(window, settings, assertTrusted, async value => {
      await terrain.configure(value.terrain.dataDir);
      await subtitles.configure(value);
      await bookmarks.update(value);
    }, subtitles.usage);

    app.on('before-quit', (event) => {
      if ((reading.hasWork() || translation.hasWork()) && dialog.showMessageBoxSync(window!, { type: 'question', buttons: ['继续使用', '退出'],
        defaultId: 0, cancelId: 0, message: 'AI 任务仍在进行，确定退出？', detail: '退出会中断任务，临时聊天不会保存。' }) !== 1) {
        event.preventDefault(); quitting = false;
      }
    });
    let finalizingQuit: Promise<void> | undefined;
    app.on('will-quit', event => {
      event.preventDefault();
      finalizingQuit ??= (async () => {
        await terrain.close().catch(error => console.error('Terrain shutdown failed', error));
        try { translation.close(); }
        catch (error) { console.error('Translation shutdown failed', error); }
        await reading.close().catch(error => console.error('Reading conversations close failed', error));
        await aiService.close().catch(error => console.error('AI service shutdown failed', error));
        await records.flush().catch(error => console.error('AI records flush failed', error));
        await records.close().catch(error => console.error('AI records close failed', error));
        try { algorithmNotes.close(); }
        catch (error) { console.error('Algorithm notes shutdown failed', error); }
        try { localModel.close(); }
        catch (error) { console.error('Local model shutdown failed', error); }
        try { playback.close(); }
        catch (error) { console.error('Playback shutdown failed', error); }
        try { subtitles.clear(); }
        catch (error) { console.error('Subtitles shutdown failed', error); }
      })().finally(() => {
        app.exit(0);
      });
    });

    ipcMain.handle(IPC_CHANNELS.bookmarks.get, (event) => {
      assertTrusted(event);
      return bookmarks.get();
    });
    ipcMain.handle(IPC_CHANNELS.bookmarks.setRead, (event, input: unknown) => {
      assertTrusted(event);
      return bookmarks.setRead(setReadSchema.parse(input));
    });
    ipcMain.handle(IPC_CHANNELS.app.status, async (event) => {
      assertTrusted(event);
      return { state: 'ready', appName: 'huan-app', version: app.getVersion() };
    });
    
    // 设置或心得通过 beforeunload 保护草稿，再由主进程显示原生确认框。
    contents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window!, {
        type: 'question', buttons: ['继续编辑', '放弃并离开'], defaultId: 0, cancelId: 0,
        message: '修改尚未保存', detail: '离开将丢失未保存的设置或心得。正在保存时请继续等待。'
      });
      // 这里取消的是“阻止卸载”，因此 preventDefault 表示允许离开页面。
      if (choice === 1) event.preventDefault();
      else quitting = false;
    });
    // macOS 关闭窗口只隐藏，保留本轮列表与草稿；Cmd+Q 才完全退出。
    window.on('close', (event) => {
      if (!quitting && process.platform === 'darwin') { event.preventDefault(); window?.hide(); }
    });
    window.on('ready-to-show', () => {
      if (window && !window.isDestroyed()) window.show();
    });
    const menuTemplate: MenuItemConstructorOptions[] = [
      { label: 'huan-app', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
    ];
    if (devUrl) menuTemplate.push({
      label: '开发', submenu: [{
        label: '打开开发者工具', accelerator: 'Alt+CommandOrControl+I',
        click: () => { if (!contents.isDestroyed()) contents.openDevTools({ mode: 'detach' }); }
      }]
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
    await window.loadURL(devUrl ?? UI_URL);
    if (devUrl) contents.openDevTools({ mode: 'detach' });
    localModel.warmup();
  }).catch((error: unknown) => {
    console.error('Application startup failed', error);
    app.quit();
  });
}
