// Run with Electron, against the independently staged app, not the developer site.
import {app, BrowserWindow, session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const integration = process.argv.includes('--integration');
const root = path.resolve(import.meta.dirname, '..'), evidence = path.join(root, integration ? 'work/desktop-integration' : 'work/desktop-smoke');
await fs.mkdir(evidence, {recursive: true});
if (integration) {
  const pointer = path.join(evidence, 'current-profile.json');
  if (process.argv.includes('--restore')) {
    const profile = JSON.parse(await fs.readFile(pointer, 'utf8')).profile;
    assert.match(profile, /^profile-[a-zA-Z0-9]+$/);
    process.env.TARKOV_DESKTOP_TEST_PROFILE = path.join(evidence, profile);
  } else {
    process.env.TARKOV_DESKTOP_TEST_PROFILE = await fs.mkdtemp(path.join(evidence, 'profile-'));
    await fs.writeFile(pointer, JSON.stringify({profile: path.basename(process.env.TARKOV_DESKTOP_TEST_PROFILE)}));
  }
} else process.env.TARKOV_DESKTOP_TEST_PROFILE = path.join(evidence, 'profile');
const hidden = !process.argv.includes('--secondary');
const documents = path.join(process.env.TARKOV_DESKTOP_TEST_PROFILE, 'test-documents');
const screenshots = path.join(documents, 'Escape from Tarkov', 'Screenshots');
await fs.mkdir(screenshots, {recursive: true});
app.setPath('documents', documents);
process.env.TARKOV_DESKTOP_TEST_WINDOW = hidden ? 'hidden' : 'secondary';
const errors = [];
let releaseStats;
if (process.argv.includes('--release')) {
  const {createReleaseFixture} = await import('./tests/helpers/release-server.mjs');
  const {once} = await import('node:events');
  const release = JSON.parse(await fs.readFile(path.join(root,'desktop/resource-release.json'),'utf8'));
  const fixture = createReleaseFixture(path.join(root,'dist',release.tag));
  releaseStats = fixture.stats;
  fixture.server.listen(0,'127.0.0.1'); await once(fixture.server,'listening');
  const networkFetch = globalThis.fetch, prefix=`https://github.com/${release.repository}/releases/download/${release.tag}/`;
  globalThis.fetch = (input,init) => {
    const url=String(input);
    if(url.startsWith(prefix))return networkFetch(`http://127.0.0.1:${fixture.server.address().port}/${url.slice(prefix.length)}`,init);
    if(new URL(url).origin==='https://tarkovlootmap.com')throw Error('Release smoke cannot use website resource bandwidth');
    return networkFetch(input,init);
  };
  app.on('will-quit',()=>{fixture.server.close();fixture.server.closeAllConnections();});
}
// In archive mode the HTTP server has an EMPTY live site: the packaged app must
// retrieve every missing resource from the retained snapshot, never the source.
if (process.argv.includes('--archive')) {
  const {createSiteServer} = await import('./lib/site-server.mjs');
  const {once} = await import('node:events');
  const emptySite = path.join(evidence, 'empty-site'); await fs.mkdir(emptySite, {recursive: true});
  assert.deepEqual(await fs.readdir(emptySite), []);
  const server = createSiteServer(emptySite, {resourceArchive: path.join(root, 'work/desktop-resource-archive')});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const networkFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'github.com' && url.pathname.endsWith('/resources-index.json')) return Promise.resolve(new Response('',{status:404}));
    if (url.origin !== 'https://tarkovlootmap.com') return networkFetch(input, init);
    assert.ok(url.pathname.startsWith('/desktop-resources/'), 'archive smoke cannot fall back to live assets');
    return networkFetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`, init);
  };
  app.on('will-quit', () => { server.close(); server.closeAllConnections(); });
}
app.on('browser-window-created', (_event, win) => {
  if (hidden) for (const event of ['show', 'focus']) win.on(event, () => errors.push(`Hidden test window emitted ${event}`));
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  contents.on('render-process-gone', (_event, details) => errors.push('renderer: ' + details.reason));
});
const packageOutput = process.argv.find(arg => arg.startsWith('--package-output='))?.slice('--package-output='.length);
const entry = packageOutput ? path.resolve(root, packageOutput, 'win-unpacked/resources/app.asar/desktop/main.mjs') : path.join(root, 'work/desktop-stage/app/desktop/main.mjs');
await import(pathToFileURL(entry).href);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(win, name) {
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await sleep(200);
  let shot;
  try { shot = await win.webContents.capturePage(); } catch { await sleep(500); shot = await win.webContents.capturePage(); }
  await fs.writeFile(path.join(evidence, name), shot.toPNG());
}
async function checkFooter(win) {
  const result = await win.webContents.executeJavaScript(`(()=>{const a=document.querySelector('.site-footer a'),r=a.getBoundingClientRect();return {text:a.textContent,href:a.href,visible:r.top>=0&&r.bottom<=innerHeight&&a.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),count:document.querySelectorAll('.site-footer').length};})()`);
  assert.equal(result.text, '冀ICP备2026046921号-1'); assert.equal(result.href, 'https://beian.miit.gov.cn/');
  assert.equal(result.count, 1); assert.equal(result.visible, true);
}
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, integration || process.argv.includes('--map') ? 580000 : 180000);
async function run() { try {
  await app.whenReady();
  let win;
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await sleep(100); }
  assert.ok(win);
  while (win.webContents.isLoading()) await sleep(100);
  for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript('document.querySelectorAll(".map-card").length === 13')) break; await sleep(100); }
  const result = await win.webContents.executeJavaScript(`({cards:document.querySelectorAll('.map-card').length, secure:isSecureContext, picker:typeof showDirectoryPicker, require:typeof require, node:typeof process, origin:location.origin})`);
  assert.equal(result.cards, 13); assert.equal(result.secure, true); assert.equal(result.picker, 'function'); assert.equal(result.require, 'undefined'); assert.equal(result.node, 'undefined');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#desktopTitlebar').length`), 1);
  await checkFooter(win);
  await win.webContents.executeJavaScript(`window.scrollTo(0,document.documentElement.scrollHeight)`); await checkFooter(win);
  await win.webContents.executeJavaScript(`window.scrollTo(0,0)`);
  await win.webContents.executeJavaScript(`document.querySelector('#desktopTitlebar button').click()`);
  assert.equal(await win.webContents.executeJavaScript(`document.getElementById('desktopAppMenu').matches(':popover-open')`), true);
  assert.deepEqual(await win.webContents.executeJavaScript(`[...document.querySelectorAll('#desktopAppMenu button')].map(button=>button.dataset.action)`), ['updates','reload','fullscreen','data','about']);
  await capture(win, 'desktop-menu.png');
  await win.webContents.executeJavaScript(`document.getElementById('desktopAppMenu').hidePopover()`);
  if (!hidden) {
    await win.webContents.executeJavaScript(`tarkovDesktop.action('fullscreen')`); await sleep(350);
    assert.equal(win.isFullScreen(), true);
    assert.equal(await win.webContents.executeJavaScript(`document.documentElement.hasAttribute('data-desktop-fullscreen')`), true);
    await win.loadURL('tarkov://app/index.html'); await sleep(350);
    assert.equal(await win.webContents.executeJavaScript(`document.documentElement.hasAttribute('data-desktop-fullscreen')`), true);
    await win.webContents.executeJavaScript(`tarkovDesktop.action('fullscreen')`); await sleep(350);
    assert.equal(win.isFullScreen(), false);
  } else assert.equal(win.isVisible(), false);
  const stored = await win.webContents.executeJavaScript(`localStorage.getItem('desktop-smoke-persist')`);
  await win.webContents.executeJavaScript(`localStorage.setItem('desktop-smoke-persist','kept'); localStorage.setItem('atlas-resource-mode-v1','online')`);
  await win.loadURL('tarkov://app/tasks.html');
  await sleep(1000); assert.match(await win.webContents.executeJavaScript('document.body.innerText'), /任务/);
  const taskImages = await win.webContents.executeJavaScript(`(async () => {
    const portraits = [...document.querySelectorAll('.trader-portrait img')];
    const cards = [...document.querySelectorAll('img.task-card-image')];
    const images = [...portraits, ...cards];
    for (const image of images) { image.loading = 'eager'; await image.decode(); }
    return {portraits: portraits.length, cards: cards.length, decoded: images.every(image => image.naturalWidth > 0 && !image.hidden)};
  })()`);
  assert(taskImages.portraits > 0 && taskImages.cards > 0 && taskImages.decoded, 'Task portraits and card images must actually decode');
  await checkFooter(win);
  await win.loadURL('tarkov://app/index.html');
  if (integration) {
    const {runDesktopIntegration} = await import('./desktop-integration.mjs');
    const {runClientDirectoryIntegration} = await import('./desktop-client-integration.mjs');
    const results = await (process.argv.includes('--client')?runClientDirectoryIntegration:runDesktopIntegration)(win, {restore: process.argv.includes('--restore'), screenshots});
    await fs.writeFile(path.join(evidence, (process.argv.includes('--client')?'client-':'')+(process.argv.includes('--restore') ? 'integration-restored.json' : 'integration.json')), JSON.stringify(results, null, 2));
  }
  if (process.argv.includes('--map')) {
    console.log('Loading factory using only staged files and pinned remote resources...');
    await win.loadURL('tarkov://app/factory.html');
    async function mapReady() {
      for (let i = 0; i < 2400; i++) {
        const state = await win.webContents.executeJavaScript(`({error:document.getElementById('retryMapLoading')?.parentElement.innerText,ready:performance.getEntriesByName('atlas-ready').length,loading:document.getElementById('loadMessage')?.textContent,hidden:document.getElementById('loading')?.style.display==='none'})`);
        if (state.error) throw Error(state.error);
        if (state.hidden && await win.webContents.executeJavaScript(`Boolean(window.factoryDebug?.state.groups.length) && document.getElementById('streamStatus').hidden`)) return;
        if (i % 100 === 0) console.log(JSON.stringify(state));
        await sleep(100);
      }
      throw Error('Map did not complete');
    }
    await mapReady();
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('main').getBoundingClientRect().bottom <= innerHeight + 1 && document.querySelector('.map-tools').getBoundingClientRect().bottom <= innerHeight + 1`), true);
    await win.webContents.executeJavaScript(`window.atlasLiveMapSession.navigate('tarkov://app/tasks.html')`);
    await sleep(500);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#desktopTitlebar').length===1 && !document.querySelector('#atlasPageFrame').contentDocument.querySelector('#desktopTitlebar')`), true);
    await win.webContents.executeJavaScript(`window.atlasLiveMapSession.navigate('tarkov://app/factory.html')`);
    await capture(win, 'factory-online.png');
    globalThis.fetch = async () => { throw Error('Offline smoke test'); };
    await win.loadURL('tarkov://app/factory.html'); await mapReady();
    await capture(win, 'factory-offline.png');
    await win.loadURL('tarkov://app/index.html');
  }
  // Chromium offline mode does not disable the local custom protocol.
  session.defaultSession.enableNetworkEmulation({offline: true});
  await win.reload(); await sleep(1000);
  assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('desktop-smoke-persist')`), 'kept');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.map-card').length`), 13);
  await checkFooter(win);
  await capture(win, 'home.png');
  assert.deepEqual(BrowserWindow.getAllWindows(),[win]);
  await session.defaultSession.flushStorageData();
  if (hidden) assert.equal(win.isVisible(), false);
  await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({result, windowMode: hidden ? 'hidden' : 'secondary', nativeFullscreenChecked: !hidden, persistedFromPreviousProcess: stored === 'kept', errors}, null, 2));
  assert.deepEqual(errors, []);
  if (releaseStats) await fs.writeFile(path.join(evidence,process.argv.includes('--restore')?'release-restored.json':'release.json'),JSON.stringify(releaseStats,null,2));
  console.log(JSON.stringify({desktopSmoke: 'passed', archiveMode: process.argv.includes('--archive'), releaseMode: Boolean(releaseStats), releaseStats, persistedFromPreviousProcess: stored === 'kept', ...result}));
  clearTimeout(timeout); app.exit(0);
} catch (error) { console.error(error); if (errors.length) console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); } }
void run();
