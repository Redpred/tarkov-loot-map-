import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createDesktopUpdates} from '../../desktop/updates.mjs';
import {findDesktopRelease, findServerDesktopRelease, selectDesktopRelease, SERVER_UPDATE_URL, UPDATE_RELEASES, validateUpdateInfo} from '../../desktop/update-release.mjs';

const current = '1.4.0-alpha.9', version = '1.4.0-alpha.10';
function release(ver = version, extra = {}) {
  const name = `TarkovLootMap-${ver}-win-x64-setup.exe`, base = `${UPDATE_RELEASES}/download/desktop-v${ver}/`;
  return {tag_name: `desktop-v${ver}`, draft: false, prerelease: ver.includes('-'), assets: [
    {name, size: 128, browser_download_url: base + name}, {name: 'latest.yml', browser_download_url: base + 'latest.yml'},
  ], ...extra};
}
function metadata(selected) {
  const sha512 = createHash('sha512').update(Buffer.alloc(128, 9)).digest('base64');
  return {version: selected.version, path: selected.name, sha512, files: [{url: selected.name, size: selected.size, sha512}]};
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tarkov-update-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const selected = selectDesktopRelease([release()], current), info = metadata(selected), updater = new EventEmitter();
  const calls = [], notifications = [], file = path.join(directory, 'installer.exe');
  updater.setFeedURL = config => calls.push(['feed', config]);
  updater.checkForUpdates = async () => { calls.push(['check']); return {isUpdateAvailable: true, updateInfo: info}; };
  updater.downloadUpdate = async () => { calls.push(['download']); updater.emit('download-progress', {percent: 25, transferred: 32, total: 128}); await fs.writeFile(file, Buffer.alloc(128, 9)); return [file]; };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  let clock = 100000;
  const settingsFile = path.join(directory, 'updates.json');
  const service = createDesktopUpdates({updater, currentVersion: current, settingsFile, canInstall: true,
    findRelease: async () => selected, now: () => clock, notify: state => notifications.push(state), ...options});
  t.after(() => service.dispose());
  return {service, updater, selected, info, calls, notifications, file, settingsFile, directory, advance: () => { clock += 31000; }};
}

test('selects newest desktop version and ignores resource, website, draft and incomplete releases', () => {
  const list = [release('1.4.0-alpha.2'), release(), release('1.4.0-alpha.11', {draft: true}),
    release('1.4.0-alpha.12', {assets: []}), release('9.0.0', {tag_name: 'resources-abc-r1'}), release('8.0.0', {tag_name: 'v8.0.0'})];
  assert.equal(selectDesktopRelease(list, current).version, version);
  assert.equal(selectDesktopRelease([release('1.4.0'), release('1.5.0-beta.1')], '1.4.0').version, '1.4.0');
  assert.equal(selectDesktopRelease([release('1.4.0'), release()], current).version, '1.4.0');
  const wrongSource = release(); wrongSource.assets[0].browser_download_url = 'https://attacker.invalid/setup.exe';
  assert.equal(selectDesktopRelease([wrongSource], current), null);
});

test('anonymous release lookup paginates, handles unpublished repos and rate limits', async () => {
  const requests = [];
  const result = await findDesktopRelease(current, async (url, init) => {
    requests.push(url); assert.equal(init.redirect, 'error'); assert.ok(!init.headers.Authorization);
    return Response.json(requests.length === 1 ? Array.from({length: 100}, () => ({tag_name: 'resources-ignore'})) : [release()]);
  });
  assert.equal(result.version, version); assert.equal(requests.length, 2);
  assert.equal(await findDesktopRelease(current, async () => new Response('', {status: 404})), null);
  await assert.rejects(findDesktopRelease(current, async () => new Response('', {status: 403})), {code: 'RATE_LIMIT'});
  await assert.rejects(findDesktopRelease(current, async () => Response.json({error: true})), {code: 'INVALID_UPDATE'});
});

test('server lookup binds the program update to a version directory and pinned SHA-512', async () => {
  const selected = selectDesktopRelease([release()], current), info = metadata(selected);
  const manifest = {schemaVersion: 1, kind: 'program', version, installer: {name: selected.name, size: selected.size, sha512: info.sha512}};
  const offered = await findServerDesktopRelease(current, async (url, init) => {
    assert.equal(url, SERVER_UPDATE_URL + 'latest.json');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    return Response.json(manifest);
  });
  assert.deepEqual(offered, {...selected, baseUrl: SERVER_UPDATE_URL + version + '/', sha512: info.sha512});
  assert.equal(await findServerDesktopRelease('1.3.0', async () => Response.json(manifest)), null);
  assert.equal(await findServerDesktopRelease(current, async () => new Response(null, {status: 404})), null);
  for (const mutate of [m => { m.kind = 'offline'; }, m => { m.version = '../outside'; },
    m => { m.installer.name = 'https://elsewhere.invalid/setup.exe'; }, m => { m.installer.size = 0; },
    m => { m.installer.sha512 = 'invalid'; }]) {
    const copy = structuredClone(manifest); mutate(copy);
    await assert.rejects(findServerDesktopRelease(current, async () => Response.json(copy)), {code: 'INVALID_UPDATE'});
  }
  await assert.rejects(findServerDesktopRelease(current, async () => new Response(' '.repeat(17000))), {code: 'INVALID_UPDATE'});
  assert.throws(() => validateUpdateInfo(info, {...offered, sha512: createHash('sha512').update('different').digest('base64')}, current),
    {code: 'INVALID_UPDATE'});
});

test('metadata binds exact version, installer, size and SHA-512 and disallows web installers', () => {
  const selected = selectDesktopRelease([release()], current), info = metadata(selected);
  assert.equal(validateUpdateInfo(info, selected, current), info);
  for (const mutate of [i => { i.version = '1.0.0'; }, i => { i.files[0].url = 'https://attacker.invalid/a.exe'; },
    i => { i.files[0].url = '../a.exe'; }, i => { i.files[0].size++; }, i => { i.files[0].sha512 = 'bad'; },
    i => { i.files.push(i.files[0]); }, i => { i.packages = {}; }, i => { i.path = 'other.exe'; }]) {
    const copy = structuredClone(info); mutate(copy);
    assert.throws(() => validateUpdateInfo(copy, selected, current), {code: 'INVALID_UPDATE'});
  }
});

test('automatic check offers an update once and download and install each require an explicit action', async t => {
  const f = await fixture(t);
  const offered = await f.service.check({automatic: true});
  assert.equal(offered.phase, 'available'); assert.equal(offered.noticeVersion, version);
  assert.ok(!f.calls.some(call => call[0] === 'download'));
  await f.service.acknowledge(version);
  f.advance();
  assert.equal((await f.service.check({automatic: true})).noticeVersion, '');
  assert.equal((await f.service.download()).phase, 'downloaded');
  assert.ok(f.notifications.some(state => state.phase === 'downloading' && state.percent === 25));
  assert.equal(f.updater.autoInstallOnAppQuit, false); assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.calls.filter(call => call[0] === 'install').length, 0);
  await f.service.install();
  assert.deepEqual(f.calls.at(-1), ['install', true, true]);
  await f.service.install(); assert.equal(f.calls.filter(call => call[0] === 'install').length, 1);
});

test('disabled automatic updates persist and manual check/download still work', async t => {
  const f = await fixture(t);
  await f.service.preference(false);
  await f.service.check({automatic: true}); assert.equal(f.calls.length, 0);
  const offered = await f.service.check();
  assert.equal(offered.phase, 'available'); assert.equal(offered.noticeVersion, '');
  assert.equal((await f.service.download()).phase, 'downloaded');
  const other = createDesktopUpdates({updater: new EventEmitter(), currentVersion: current, settingsFile: f.settingsFile, canInstall: true});
  t.after(() => other.dispose()); assert.equal((await other.status()).autoUpdate, false);
});

test('startup timer checks automatically and a closed service makes no requests', async t => {
  let count = 0;
  const f = await fixture(t, {startupDelay: 5, checkInterval: 100000, findRelease: async () => { count++; return null; }});
  await f.service.start(); await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(count, 1);
  const other = await fixture(t, {startupDelay: 50, findRelease: async () => { count++; return null; }});
  await other.service.start(); other.service.dispose(); await new Promise(resolve => setTimeout(resolve, 65)); assert.equal(count, 1);
});

test('concurrent checks and download requests do not start duplicate downloads', async t => {
  let finish; const waiting = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, {findRelease: async () => { await waiting; return selectDesktopRelease([release()], current); }});
  const first = f.service.check(); await new Promise(resolve => setImmediate(resolve));
  await f.service.check(); await f.service.download(); finish(); await first;
  assert.equal(f.calls.filter(call => call[0] === 'download').length, 0);
  await Promise.all([f.service.download(), f.service.download()]);
  assert.equal(f.calls.filter(call => call[0] === 'download').length, 1);
});

test('unpublished, current and older releases never download or downgrade', async t => {
  for (const selected of [null, selectDesktopRelease([release(current)], current), selectDesktopRelease([release('1.3.0')], current)]) {
    const f = await fixture(t, {findRelease: async () => selected});
    const checked = await f.service.check();
    assert.equal(checked.phase, selected ? 'up-to-date' : 'unpublished'); assert.equal(f.calls.length, 0);
    assert.equal(checked.version, selected?.version || '');
  }
});

test('invalid remote metadata is rejected before fetching executable bytes', async t => {
  const f = await fixture(t); f.info.files[0].url = 'file:///bad.exe';
  assert.equal((await f.service.check()).phase, 'error');
  await f.service.download(); assert.ok(!f.calls.some(call => call[0] === 'download'));
});

test('network failure is recoverable and malformed user settings can be saved again', async t => {
  const f = await fixture(t); let attempt = 0;
  f.updater.downloadUpdate = async () => { if (!attempt++) throw Error('offline'); await fs.writeFile(f.file, Buffer.alloc(128, 9)); return [f.file]; };
  assert.equal((await f.service.check()).phase, 'available');
  assert.equal((await f.service.download()).phase, 'error');
  assert.equal((await f.service.download()).phase, 'downloaded');
  const config = path.join(f.directory, 'bad.json'); await fs.writeFile(config, '{bad');
  const other = createDesktopUpdates({updater: new EventEmitter(), currentVersion: current, settingsFile: config, canInstall: true});
  t.after(() => other.dispose()); assert.match((await other.status()).message, /偏好/);
  await other.preference(false); assert.equal(JSON.parse(await fs.readFile(config)).autoUpdate, false);
});

test('cached installer changed after download is rejected immediately before installation', async t => {
  const f = await fixture(t); await f.service.check(); await f.service.download(); await fs.writeFile(f.file, Buffer.alloc(128, 7));
  const result = await f.service.install(); assert.equal(result.phase, 'error'); assert.match(result.message, /校验失败/);
  assert.ok(!f.calls.some(call => call[0] === 'install'));
});

test('unpacked app can check releases but cannot download or silently install', async t => {
  const f = await fixture(t, {canInstall: false}); assert.equal((await f.service.check()).phase, 'available');
  await f.service.download(); await f.service.install(); assert.ok(!f.calls.some(call => ['download', 'install'].includes(call[0])));
});
