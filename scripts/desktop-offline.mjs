// Build the default-resource installer locally. Never publishes or edits sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {defaultOfflineProfile, verifyOfflineProfile, nativeOfflineReader, assertNoLinks, offlineHash, GITHUB_ASSET_LIMIT} from './lib/desktop-offline-profile.mjs';
import {fileDigest, verifyEmbeddedArchive} from './lib/desktop-offline-artifact.mjs';
import {writeOfflineInstallerConfig} from './lib/desktop-offline-installer.mjs';
import {createClientResourceStore} from '../desktop/local-resources.mjs';
import {createReleaseResources} from '../desktop/release-resources.mjs';
import {ARCHIVE_CHUNK} from './lib/desktop-resource-archive.mjs';
import {boundedBytes} from '../desktop/resources.mjs';

const root = path.resolve(import.meta.dirname, '..');
const {values: args} = parseArgs({options: {'app-output': {type: 'string'}, resources: {type: 'string'}, out: {type: 'string'}, download: {type: 'boolean'}, 'seven-source': {type: 'string'}, help: {type: 'boolean'}}});
if (args.help) {
  console.log('desktop-offline.mjs --app-output=dist/desktop/<app-build> --out=dist/desktop/<new-offline-build> (--resources=<directory>/map-resources | --download) [--seven-source=<7z2409-src.tar.xz>]');
  process.exit(0);
}
assert.equal(process.platform, 'win32', 'NSIS offline builds currently require Windows');
assert(args['app-output'] && args.out && Boolean(args.resources) !== Boolean(args.download), 'Specify --app-output, --out, and exactly one of --resources or --download');
const appOutput = await assertNoLinks(path.resolve(root, args['app-output']));
const output = await assertNoLinks(path.resolve(root, args.out));
assert(output.startsWith(path.join(root, 'dist', 'desktop') + path.sep), 'Output must be a new directory under dist/desktop');
assert(!output.startsWith(appOutput + path.sep) && !appOutput.startsWith(output + path.sep) && output !== appOutput, 'Keep app and offline outputs separate');
await assert.rejects(fs.access(output), {code: 'ENOENT'});
const lock = JSON.parse(await fs.readFile(path.join(root, 'desktop/resources.lock.json'), 'utf8'));
const release = JSON.parse(await fs.readFile(path.join(root, 'desktop/resource-release.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'));
const require = createRequire(path.join(root, 'desktop/package.json'));
const asar = path.join(appOutput, 'win-unpacked/resources/app.asar');
const unpacked = require('@electron/asar');
assert.equal(JSON.parse(unpacked.extractFile(asar, 'package.json')).version, pkg.version, 'Application version mismatch');
assert.deepEqual(JSON.parse(unpacked.extractFile(asar, 'desktop/resources.lock.json')), lock, 'Application resource lock mismatch');
const workspace = path.join(root, 'work/desktop-offline');
await assertNoLinks(workspace); await fs.mkdir(workspace, {recursive: true});
const workRoot = await fs.mkdtemp(path.join(workspace, 'build-'));
const sevenZip = await require('app-builder-lib/out/toolsets/7zip.js').getPath7za();
assert.equal(await fileDigest(sevenZip), '223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3', 'Review the bundled 7-Zip license/source when the tool changes');
async function run(executable, argv, cwd = root) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {cwd, windowsHide: true, stdio: 'inherit'});
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Build tool exited with ${code}`)));
  });
}
try {
  let source, readObject;
  if (args.resources) {
    source = path.resolve(root, args.resources);
    assert.equal(path.basename(source), 'map-resources', 'Use the marked map-resources directory');
    const read = await nativeOfflineReader(source);
    readObject = (_relative, [sha]) => read('objects/' + sha);
  } else {
    source = path.join(workRoot, 'map-resources'); await fs.mkdir(source);
    const store = createClientResourceStore(source);
    assert.equal((await store.status()).available, true);
    const github = createReleaseResources({release, lock, cacheRoot: path.join(workRoot, 'release-cache')});
    readObject = async (relative, [sha, size]) => {
      let bytes = await store.getObject(sha, size);
      if (!bytes) {
        bytes = await github.read(relative, size);
        assert(bytes, 'The pinned GitHub resource Release is not public yet; use --resources for local builds');
        assert.equal(bytes.length, size); await store.putObject(sha, bytes);
      }
      return bytes;
    };
    // No website fallback during release builds. Only the pinned GitHub assets.
    args.github = github; args.store = store;
  }
  console.log('Selecting low geometry, 128 px textures and full scenery for all maps.');
  const profile = await defaultOfflineProfile({lock, readObject});
  if (args.download) {
    const jobs = [...profile.objects.map(object => async () => readObject(object.source, [object.sha256, object.bytes]))];
    for (const model of profile.models) jobs.push(async () => {
      for (let offset = 0; offset < model.bytes; offset += ARCHIVE_CHUNK) {
        const length = Math.min(ARCHIVE_CHUNK, model.bytes - offset);
        const bytes = await args.github.read(model.source + '?' + new URLSearchParams({offset, length, version: model.sha256}), Math.ceil(length / 3) * 4 + 1024);
        assert(bytes, 'The pinned resource Release is unavailable');
        const value = JSON.parse(bytes), data = Buffer.from(value.data || '', 'base64');
        assert(value.offset === offset && value.total === model.bytes && value.encoding === 'base64' && data.length === length && offlineHash(data) === value.sha256, 'Invalid model chunk');
        await args.store.putChunk(model.sha256, offset, data, model.bytes);
      }
    });
    let next = 0, done = 0, failed = false;
    const workers = await Promise.allSettled(Array.from({length: 4}, async () => {
      try { while (!failed && next < jobs.length) { await jobs[next++](); if (++done % 100 === 0) console.log(`Downloaded ${done}/${jobs.length} resource groups`); } }
      catch (error) { failed = true; throw error; }
    }));
    const error = workers.find(result => result.status === 'rejected'); if (error) throw error.reason;
  }
  const inventory = await verifyOfflineProfile(profile, await nativeOfflineReader(source));
  console.log(`Verified ${inventory.files} files, ${inventory.models} complete models, ${inventory.bytes} bytes.`);
  const list = path.join(workRoot, 'resources-list.txt');
  await fs.writeFile(list, inventory.entries.map(entry => entry.path).join('\n') + '\n');
  const archivePath = path.join(workRoot, 'map-resources.7z');
  await run(sevenZip, ['a', '-t7z', archivePath, '@' + list, '-scsUTF-8', '-mx=9', '-m0=LZMA2', '-md=64m', '-ms=on', '-mmt=4', '-mtm=off', '-mta=off', '-mtc=off', '-bsp0', '-bd'], path.dirname(source));
  await run(sevenZip, ['t', archivePath, '-mmt=2', '-bd', '-bsp0']);
  const handle = await fs.open(archivePath, 'r'), header = Buffer.alloc(64);
  try { await handle.read(header, 0, 64, 0); } finally { await handle.close(); }
  const archive = {archive: archivePath, bytes: (await fs.stat(archivePath)).size, sha256: await fileDigest(archivePath), headerHex: header.toString('hex'), sevenZip};
  assert(archive.bytes < GITHUB_ASSET_LIMIT, 'Resources alone exceed the GitHub asset limit');
  const sourceTar = path.join(workRoot, '7z2409-src.tar.xz');
  const sourceBytes = args['seven-source'] ? await fs.readFile(path.resolve(root, args['seven-source'])) : await boundedBytes(await fetch('https://github.com/ip7z/7zip/releases/download/24.09/7z2409-src.tar.xz', {signal: AbortSignal.timeout(120000)}), 1511288);
  assert.equal(sourceBytes.length, 1511288); assert.equal(offlineHash(sourceBytes), '49c05169f49572c1128453579af1632a952409ced028259381dac30726b6133a');
  await fs.writeFile(sourceTar, sourceBytes);
  const config = await writeOfflineInstallerConfig({root, workRoot, output, prepackaged: path.join(appOutput, 'win-unpacked'), inventory, archive, sourceTar});
  await run(process.execPath, [path.join(root, 'desktop/node_modules/electron-builder/cli.js'), '--projectDir', path.join(root, 'desktop'), '--config', config, '--prepackaged', path.join(appOutput, 'win-unpacked'), '--win', '--x64', '--publish', 'never']);
  const installerName = `TarkovLootMap-${pkg.version}-win-x64-setup.exe`, installer = path.join(output, installerName);
  assert((await fs.stat(installer)).size < GITHUB_ASSET_LIMIT, 'Installer exceeds the GitHub single-asset limit');
  const embedded = await verifyEmbeddedArchive(installer, archive);
  await fs.writeFile(path.join(output, 'offline-profile.json'), JSON.stringify(inventory, null, 2) + '\n');
  const result = {schemaVersion: 1, profile: 'default', version: pkg.version, resourceId: inventory.resourceId, quality: inventory.quality, maps: inventory.maps, resourceFiles: inventory.files, resourceBytes: inventory.bytes,
    resourceArchive: {bytes: archive.bytes, sha256: archive.sha256, headerHex: archive.headerHex}, resourceArchiveEmbedded: embedded,
    inventorySha256: await fileDigest(path.join(output, 'offline-profile.json')), asarSha256: await fileDigest(asar), installerName, installerBytes: (await fs.stat(installer)).size, installerSha256: await fileDigest(installer), published: false};
  await fs.writeFile(path.join(output, 'offline-bundle.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  // Delete only the fresh mkdtemp tree, never the supplied resources or app build.
  assert(path.dirname(path.resolve(workRoot)) === workspace && path.basename(workRoot).startsWith('build-'));
  await assertNoLinks(workRoot); await fs.rm(workRoot, {recursive: true, force: true});
}
