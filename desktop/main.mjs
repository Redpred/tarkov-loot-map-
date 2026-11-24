import {app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {appUrl, externalUrl, APP_ORIGIN, RELEASES_URL} from './policy.mjs';
import {createDesktopResources} from './resources.mjs';
import {createScreenshotAccess} from './screenshot-access.mjs';
import updaterPackage from 'electron-updater';
import {createDesktopUpdates} from './updates.mjs';
import {projectNoticeText} from '../site/project-notice.js';

protocol.registerSchemesAsPrivileged([{scheme: 'tarkov', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}}]);
app.setName('TarkovLootMap');
app.setAppUserModelId('com.redpred.tarkovlootmap');
// Stable across versions and installation locations; an explicit test profile is isolated.
const testProfile = process.env.TARKOV_DESKTOP_TEST_PROFILE;
// Test-only modes never change installed application behavior.
const testWindowMode = testProfile && !app.isPackaged ? process.env.TARKOV_DESKTOP_TEST_WINDOW : '';
if (testProfile && !app.isPackaged) app.setPath('userData', path.resolve(testProfile));
else app.setPath('userData', path.join(app.getPath('appData'), 'TarkovLootMap'));
const root = path.resolve(import.meta.dirname, '..');
let mainWindow, downloadWindow, resources, updates;
export let desktopUpdater;
const defaultResourceRoot = testProfile && !app.isPackaged ? path.join(app.getPath('userData'), 'map-resources') : app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'map-resources') : path.join(root, 'work/desktop-local/map-resources');
const resourceSettings = path.join(app.getPath('userData'), 'resource-location.json');
const jobs = new Map();
function openExternal(url) { if (externalUrl(url)) void shell.openExternal(url); }
function focusWindow(win) {
  if (!win || testWindowMode === 'hidden') return;
  if (testWindowMode === 'secondary') { win.showInactive(); return; }
  if (win.isMinimized()) win.restore();
  win.focus();
}
function createWindow(page = 'index.html') {
  let placement = {};
  if (testWindowMode === 'secondary') {
    const display = screen.getAllDisplays().find(item => item.id !== screen.getPrimaryDisplay().id);
    if (!display) throw Error('副屏验证需要连接副屏；不会改用主屏');
    const {x, y, width, height} = display.workArea;
    if (width < 892 || height < 632) throw Error('副屏工作区太小，验证保持隐藏');
    placement = {x: x + 16, y: y + 16, width: Math.min(1440, width - 32), height: Math.min(940, height - 32)};
  }
  const win = new BrowserWindow({width: 1440, height: 940, minWidth: 860, minHeight: 600, ...placement, title: '塔科夫物资地图', backgroundColor: '#11130f', show: false, focusable: testWindowMode !== 'hidden', icon: path.join(root, 'site/app-icon-512.png'), titleBarStyle: 'hidden', titleBarOverlay: {color: '#11130f', symbolColor: '#c7cbb8', height: 40},
    webPreferences: {preload: path.join(import.meta.dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: testWindowMode !== 'hidden'}});
  win.once('ready-to-show', () => { if (testWindowMode === 'hidden') return; if (testWindowMode === 'secondary') win.showInactive(); else win.show(); });
  win.webContents.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'}; });
  win.webContents.on('will-navigate', (event, url) => { if (!appUrl(url)) { event.preventDefault(); openExternal(url); } });
  win.webContents.on('will-frame-navigate', event => { if (!appUrl(event.url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if (input.control && input.key.toLowerCase() === 'r') { event.preventDefault(); win.reload(); }
  });
  for (const name of ['enter-full-screen', 'leave-full-screen']) win.on(name, () => win.webContents.send('desktop:fullscreen', win.isFullScreen()));
  win.webContents.on('did-finish-load', () => win.webContents.send('desktop:fullscreen', win.isFullScreen()));
  const id = win.webContents.id;
  win.on('closed', () => { jobs.get(id)?.abort(); jobs.delete(id); });
  void win.loadURL(`${APP_ORIGIN}/${page}`);
  return win;
}
function checkSender(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !appUrl(event.senderFrame.url) || new URL(event.senderFrame.url).pathname !== '/desktop-downloads.html') throw Error('不允许的资源请求');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
    focusWindow(win);
  });
  app.whenReady().then(async () => {
    const lock = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'resources.lock.json'), 'utf8'));
    const release = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'resource-release.json'), 'utf8'));
    let localRoot = defaultResourceRoot;
    try { const saved = JSON.parse(await fs.readFile(resourceSettings, 'utf8')); if (typeof saved.path === 'string' && path.isAbsolute(saved.path)) localRoot = saved.path; } catch (error) { if (error.code !== 'ENOENT') console.error('无法读取资源位置设置，将使用客户端目录'); }
    await fs.mkdir(path.dirname(localRoot), {recursive: true});
    resources = createDesktopResources({siteRoot: path.join(root, 'site'), cacheRoot: path.join(app.getPath('userData'), 'map-metadata'), localRoot, lock, release, fetcher: (...args) => fetch(...args)});
    protocol.handle('tarkov', request => resources.handle(request));
    const updateTest = Boolean(testProfile && !app.isPackaged && process.env.TARKOV_DESKTOP_TEST_UPDATES === '1');
    const installed = await fs.lstat(path.join(path.dirname(app.getPath('exe')), 'Uninstall 塔科夫物资地图.exe')).then(stat => stat.isFile() && !stat.isSymbolicLink(), () => false);
    desktopUpdater = new updaterPackage.NsisUpdater();
    desktopUpdater.logger = null;
    if (installed) desktopUpdater.installDirectory = path.dirname(app.getPath('exe'));
    updates = createDesktopUpdates({updater: desktopUpdater, currentVersion: app.getVersion(),
      settingsFile: path.join(app.getPath('userData'), 'updates.json'), enabled: app.isPackaged || updateTest,
      canInstall: (app.isPackaged && installed) || updateTest,
      beforeInstall: () => { for (const job of jobs.values()) job.abort(); },
      notify: value => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('desktop:update-state', value); },
    });
    ipcMain.handle('desktop:updates', async (event, action, value) => {
      try {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !appUrl(event.senderFrame.url)) throw Error('不允许的更新请求');
        if (!['status', 'check', 'download', 'install', 'preference'].includes(action)) throw Error('未知更新操作');
        return {ok: true, value: await (action === 'preference' ? updates.preference(value) : updates[action]())};
      } catch (error) { return {ok: false, message: error.message}; }
    });
    const screenshotServices = new Map();
    ipcMain.handle('desktop:screenshots', async (event, action, id) => {
      try {
        const frame = event.senderFrame;
        if (!frame || frame !== event.sender.mainFrame || !appUrl(frame.url) || !['/factory.html', '/streets.html', '/map.html'].includes(new URL(frame.url).pathname)) throw Error('不允许的截图目录请求');
        if (!['info', 'detect', 'choose', 'forget', 'list'].includes(action)) throw Error('未知截图操作');
        const win = BrowserWindow.fromWebContents(event.sender); if (!win) throw Error('地图窗口已关闭');
        if (!screenshotServices.has(event.sender.id)) {
          screenshotServices.set(event.sender.id, createScreenshotAccess({
            documentsPaths: [app.getPath('documents'), path.join(app.getPath('home'), 'Documents')],
            settingsFile: path.join(app.getPath('userData'), 'screenshot-directory.json'),
            selectDirectory: async defaultPath => {
              const result = await dialog.showOpenDialog(win, {title: '选择游戏截图目录', properties: ['openDirectory'], defaultPath});
              return result.canceled ? null : result.filePaths[0];
            },
          }));
          win.once('closed', () => screenshotServices.delete(event.sender.id));
        }
        return {ok: true, value: await screenshotServices.get(event.sender.id)[action](id)};
      } catch (error) { return {ok: false, name: error.name, message: error.message}; }
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => appUrl(origin) && appUrl(contents?.getURL()) && ['fileSystem', 'clipboard-sanitized-write', 'persistent-storage'].includes(permission));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(appUrl(details.requestingUrl || contents?.getURL()) && appUrl(contents?.getURL()) && ['fileSystem', 'clipboard-sanitized-write', 'persistent-storage'].includes(permission)));
    session.defaultSession.on('file-system-access-restricted', (_event, _details, callback) => callback('deny'));
    session.defaultSession.on('will-download', event => event.preventDefault());
    ipcMain.handle('desktop:prepare-map', async (event, mapId, quality) => {
      checkSender(event); const id = event.sender.id;
      if (jobs.has(id)) throw Error('已有地图准备任务');
      const controller = new AbortController(); jobs.set(id, controller);
      try { return await resources.prepare(mapId, quality, controller.signal); } finally { if (jobs.get(id) === controller) jobs.delete(id); }
    });
    ipcMain.handle('desktop:cancel-prepare', event => { checkSender(event); jobs.get(event.sender.id)?.abort(); });
    ipcMain.handle('desktop:action', async (event, action) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !appUrl(event.senderFrame.url)) throw Error('不允许的窗口操作');
      const win = BrowserWindow.fromWebContents(event.sender); if (!win) return;
      switch (action) {
        case 'resource-folder': { const info = await resources.localStatus(); if (!info.available) throw Error(info.error); return shell.openPath(info.path); }
        case 'choose-resources': {
          const result = await dialog.showOpenDialog(win, {title: '选择资源保存位置', properties: ['openDirectory', 'createDirectory'], defaultPath: (await resources.localStatus()).path});
          if (result.canceled) return false;
          const selected = result.filePaths[0], next = path.basename(selected) === 'map-resources' ? selected : path.join(selected, 'map-resources');
          const {createClientResourceStore} = await import('./local-resources.mjs');
          const info = await createClientResourceStore(next).status(); if (!info.available) throw Error(info.error);
          await fs.mkdir(path.dirname(resourceSettings), {recursive: true});
          await fs.writeFile(resourceSettings, JSON.stringify({path: next}) + '\n');
          resources.setLocalRoot(next); return true;
        }
        case 'downloads': if (!downloadWindow || downloadWindow.isDestroyed()) downloadWindow = createWindow('desktop-downloads.html'); else focusWindow(downloadWindow); break;
        case 'updates': openExternal(RELEASES_URL); break;
        case 'data': return shell.openPath(app.getPath('userData'));
        case 'reload': win.reload(); break;
        case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
        case 'about': return dialog.showMessageBox(win, {type: 'info', title: '塔科夫物资地图', message: `塔科夫物资地图 ${app.getVersion()}`, detail: '桌面预览版 · 与网站共用前端界面\n\n默认读取程序旁的 map-resources 文件夹，缺失资源自动下载保存。通过应用菜单的“离线地图”可提前下载完整地图。“检查更新”可下载新版，准备好后由你选择重启安装，地图资源、设置与任务进度保留。\n\n' + projectNoticeText() + '\n\n完整来源与许可见随包 THIRD_PARTY_NOTICES.txt。'});
        default: throw Error('未知窗口操作');
      }
    });
    Menu.setApplicationMenu(null);
    mainWindow = createWindow();
    if (!updateTest) void updates.start();
  }).catch(error => { if (testWindowMode) { console.error(error); app.exit(1); } else { dialog.showErrorBox('地图启动失败', error.message); app.quit(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { updates?.dispose(); for (const job of jobs.values()) job.abort(); });
}
