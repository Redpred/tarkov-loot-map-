// Real Electron updater + renderer IPC, isolated cache/profile and local HTTP fixture.
// No installer is executed and every BrowserWindow remains hidden.
import {app, BrowserWindow, session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {SERVER_UPDATE_URL} from '../desktop/update-release.mjs';

const root = path.resolve(import.meta.dirname, '..'), evidenceRoot = path.join(root, 'work/desktop-update-smoke');
await fs.mkdir(evidenceRoot, {recursive: true});
const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'run-'));
const profile = await fs.mkdtemp(path.join(evidence, 'profile-'));
process.env.TARKOV_DESKTOP_TEST_PROFILE = profile;
process.env.TARKOV_DESKTOP_TEST_WINDOW = 'hidden';
process.env.TARKOV_DESKTOP_TEST_UPDATES = '1';
const pkg = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'));
app.getVersion = () => pkg.version;
const semver = createRequire(path.join(root, 'desktop/package.json'))('semver');
const version = semver.inc(pkg.version, semver.prerelease(pkg.version) ? 'prerelease' : 'patch'), name = `TarkovLootMap-${version}-win-x64-setup.exe`;
const baseUrl = `${SERVER_UPDATE_URL}${version}/`;
const bytes = Buffer.alloc(512 * 1024, 29), sha512 = createHash('sha512').update(bytes).digest('base64');
const info = {version, path: name, sha512, files: [{url: name, size: bytes.length, sha512}]};
const requests = [], errors = [];
let badBytes = false, offeredVersion = version;
const server = http.createServer((req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname.slice(1); requests.push(requested);
  if (requested === 'latest.json') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({schemaVersion: 1, kind: 'program', version: offeredVersion,
      installer: {name: `TarkovLootMap-${offeredVersion}-win-x64-setup.exe`, size: bytes.length, sha512}}));
  } else if (requested === 'latest.yml') { res.writeHead(200, {'Content-Type': 'text/yaml'}); res.end(JSON.stringify(info)); }
  else if (requested === name) {
    res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length});
    res.end(badBytes ? Buffer.alloc(bytes.length, 1) : bytes);
  } else { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const networkFetch = globalThis.fetch;
const fixtureOrigin = `http://127.0.0.1:${server.address().port}/`;
globalThis.fetch = (url, init) => {
  if (String(url) === SERVER_UPDATE_URL + 'latest.json') return networkFetch(fixtureOrigin + 'latest.json', init);
  throw Error('Update smoke uses only the loopback update service');
};
app.on('browser-window-created', (_event, win) => { for (const event of ['show', 'focus']) win.on(event, () => errors.push(event)); });
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  contents.on('render-process-gone', (_event, details) => errors.push(details.reason));
});
const archive = process.argv.find(arg => arg.startsWith('--asar='))?.slice('--asar='.length);
const application = archive ? path.resolve(root, archive) : path.join(root, 'work/desktop-stage/app');
assert(application.startsWith(root + path.sep));
const runtime = await import(pathToFileURL(path.join(application, 'desktop/main.mjs')).href);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Update integration timeout'); app.exit(1); }, 90000);
async function waitFor(fn) { for (let attempt = 0; attempt < 300; attempt++) { if (await fn()) return; await sleep(50); } throw Error('Update test condition timeout'); }
async function run() { try {
  await app.whenReady();
  await waitFor(() => runtime.desktopUpdater && BrowserWindow.getAllWindows().length);
  const updater = runtime.desktopUpdater;
  console.log('Updater window ready (hidden).');
  updater.forceDevUpdateConfig = true;
  Object.defineProperty(updater.app, 'baseCachePath', {value: path.join(profile, 'cache')});
  const config = path.join(profile, 'app-update.yml');
  await fs.writeFile(config, `provider: generic\nurl: ${SERVER_UPDATE_URL}\nupdaterCacheDirName: update-test\n`);
  updater.updateConfigPath = config;
  session.fromPartition('electron-updater').webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith(baseUrl)) callback({redirectURL: fixtureOrigin + details.url.slice(baseUrl.length)});
    else if (details.url.startsWith(fixtureOrigin)) callback({});
    else callback({cancel: true});
  });
  let installed = 0;
  updater.quitAndInstall = (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); installed++; };
  const win = BrowserWindow.getAllWindows()[0], js = code => win.webContents.executeJavaScript(code);
  await waitFor(async () => !win.webContents.isLoading() && await js("Boolean(document.querySelector('#desktopAppMenu [data-action=updates]'))"));
  assert.equal((await js("tarkovDesktop.updates('install')")).value.phase, 'idle');
  assert.equal((await js("tarkovDesktop.updates('invalid')")).ok, false);
  await runtime.desktopUpdates.start();
  await waitFor(() => js("document.querySelector('#desktopUpdateDialog').open && document.querySelector('#desktopUpdateDialog [data-update-primary]').textContent === '下载更新'"));
  assert.ok(requests.includes('latest.json') && requests.includes('latest.yml') && !requests.includes(name));
  await js("document.querySelector('#desktopUpdateDialog [data-update-later]').click()");
  await waitFor(async () => !(await js("tarkovDesktop.updates('status')")).value.noticeVersion);
  await win.loadURL('tarkov://app/index.html');
  await waitFor(() => js("Boolean(document.querySelector('.desktop-update-badge:not([hidden])'))"));
  assert.equal(await js("document.querySelector('#desktopUpdateDialog').open"), false);

  await js("document.querySelector('#openHomeSettings').click(); document.querySelector('#settings-tab-updates').click()");
  await waitFor(() => js("document.querySelector('[data-update-preference]').checked && !document.querySelector('[data-update-preference]').disabled"));
  await js("document.querySelector('[data-update-preference]').click()");
  await waitFor(async () => (await js("tarkovDesktop.updates('status')")).value.autoUpdate === false);
  offeredVersion = pkg.version;
  await js("document.querySelector('[data-update-check]').click()");
  await waitFor(() => js("document.querySelector('#settings-updates [data-update-status]').textContent.includes('当前已是最新') && !document.querySelector('[data-update-check]').disabled"));
  offeredVersion = version;
  await js("document.querySelector('[data-update-check]').click()");
  await waitFor(async () => (await js("tarkovDesktop.updates('status')")).value.phase === 'available');
  assert.ok(!requests.includes(name));
  await waitFor(() => js("!document.querySelector('[data-update-details]').hidden"));
  await js("document.querySelector('[data-update-details]').click()");
  await waitFor(() => js("document.querySelector('#desktopUpdateDialog').open"));
  // Use the real SHA-512 rejection path before retrying the same selected update.
  badBytes = true;
  assert.equal((await js("tarkovDesktop.updates('download')")).value.phase, 'error');
  assert.equal(installed, 0);
  badBytes = false;
  await waitFor(() => js("document.querySelector('#desktopUpdateDialog [data-update-primary]').textContent === '重试下载'"));
  await js("document.querySelector('#desktopUpdateDialog [data-update-primary]').click()");
  await waitFor(async () => (await js("tarkovDesktop.updates('status')")).value.phase === 'downloaded');
  assert.equal(installed, 0);
  await waitFor(() => js("document.querySelector('#desktopUpdateDialog [data-update-primary]').textContent === '重启并安装'"));
  assert.equal(updater.autoInstallOnAppQuit, false);
  const installer = updater.downloadedUpdateHelper.file;
  assert.ok(installer.startsWith(profile + path.sep));
  assert.equal(createHash('sha512').update(await fs.readFile(installer)).digest('base64'), sha512);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(evidence, 'update-ready.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(installer, Buffer.alloc(bytes.length, 1));
  assert.equal((await js("tarkovDesktop.updates('install')")).value.phase, 'error');
  assert.equal(installed, 0);
  assert.equal((await js("tarkovDesktop.updates('download')")).value.phase, 'downloaded');
  assert.equal(createHash('sha512').update(await fs.readFile(updater.downloadedUpdateHelper.file)).digest('base64'), sha512);
  // Renderer reload must recover both status and user preference from the main process.
  await win.loadURL('tarkov://app/tasks.html');
  await waitFor(() => js("Boolean(document.querySelector('.desktop-update-badge')) && !document.querySelector('.desktop-update-badge').hidden"));
  await js("document.querySelector('.desktop-update-badge').click()");
  await waitFor(() => js("document.querySelector('#desktopUpdateDialog').open"));
  assert.equal((await js("tarkovDesktop.updates('status')")).value.autoUpdate, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'updates.json'))).autoUpdate, false);
  await js("document.querySelector('#desktopUpdateDialog [data-update-primary]').click()");
  await waitFor(() => installed === 1);
  assert.equal(win.isVisible(), false); assert.deepEqual(errors, []);
  const result = {evidence, startupPopup: true, noDownloadBeforeAction: true, settingsManualCheck: true, sameVersionDisplayed: true,
    realUpdaterDownload: true, corruptDownloadRejected: true, retrySucceeded: true, cachedTamperRejectedAndRecovered: true,
    explicitInstallHandoff: installed, actualInstallerExecuted: false, stateAfterNavigation: true,
    preferenceSaved: true, cacheIsolated: true, requests, errors, hidden: true};
  await fs.writeFile(path.join(evidence, 'integration.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  clearTimeout(timeout); server.close(); server.closeAllConnections(); app.quit();
} catch (error) { console.error(error); clearTimeout(timeout); server.close(); server.closeAllConnections(); app.exit(1); } }
void run();
