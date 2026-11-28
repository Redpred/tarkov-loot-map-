import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runtimePackages} from './lib/desktop-runtime-dependencies.mjs';
import {fileDigest, verifyEmbeddedArchive} from './lib/desktop-offline-artifact.mjs';
import {GITHUB_ASSET_LIMIT} from './lib/desktop-offline-profile.mjs';
import {ATLAS_MAPS} from '../site/atlas-maps.js';

const root = path.resolve(import.meta.dirname, '..'), output = path.resolve(root, process.argv[2] || 'dist/desktop');
const appOutput = path.resolve(root, process.argv[3] || output);
const require = createRequire(path.join(root, 'desktop/package.json')), asar = require('@electron/asar');
const archive = path.join(appOutput, 'win-unpacked/resources/app.asar');
const digest = data => createHash('sha256').update(data).digest('hex');
const extract = file => asar.extractFile(archive, path.normalize(file));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'));
const inventory = JSON.parse(extract('build-inventory.json'));
const resourceRelease = JSON.parse(extract('desktop/resource-release.json'));
assert.equal(resourceRelease.resourceLockId, digest(JSON.stringify(JSON.parse(extract('desktop/resources.lock.json')))));
assert.equal(inventory.version, pkg.version);
assert.equal(JSON.parse(extract('package.json')).version, pkg.version);
assert.equal(JSON.parse(extract('package.json')).license, 'MIT');
for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt']) assert.equal(digest(extract(file)), digest(await fs.readFile(path.join(root, file))), `Missing or stale license notice: ${file}`);
const expected = new Set(['package.json', 'build-inventory.json']);
for (const entry of inventory.files) {
  assert.ok(!path.isAbsolute(entry.path) && !entry.path.split('/').some(part => !part || part === '..'));
  assert.ok(!expected.has(entry.path), `Duplicate inventory path: ${entry.path}`);
  expected.add(entry.path);
  const content = extract(entry.path);
  assert.equal(content.length, entry.bytes, entry.path);
  assert.equal(digest(content), entry.sha256, entry.path);
  assert.equal(digest(await fs.readFile(path.join(root, entry.path))), entry.sha256, `Stale build: ${entry.path}`);
}
const actual = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
const runtimeDependencies = await runtimePackages(path.join(root, 'desktop'));
assert.deepEqual(inventory.runtimeDependencies, runtimeDependencies);
// Builder strips development metadata and serializes dependency package.json.
// Independently allow those omissions only; every remaining value must match.
const removedMetadata = new Set(['dist', 'gitHead', 'build', 'jspm', 'ava', 'xo', 'nyc', 'eslintConfig', 'contributors', 'bundleDependencies', 'tags', 'scripts', 'keywords', 'bugs', 'babel']);
let verifiedRuntimeFiles = 0;
for (const file of actual) {
  assert.ok(!/(^|\/)(?:\.local|work|AGENTS\.md|HANDOFF\.md)(\/|$)/i.test(file), `Private or build path: ${file}`);
  const stat = asar.statFile(archive, path.normalize(file));
  if (!stat.files) {
    if (file.startsWith('node_modules/')) {
      const pkg = runtimeDependencies.find(pkg => file.startsWith(pkg.directory + '/') && !file.slice(pkg.directory.length + 1).includes('node_modules/'));
      assert.ok(pkg, `Unexpected runtime package: ${file}`);
      const source = await fs.readFile(path.join(root, 'desktop', file));
      if (file.endsWith('/package.json')) {
        const original = JSON.parse(source), packaged = JSON.parse(extract(file));
        for (const key of Object.keys(original)) if (!(key in packaged)) {
          assert.ok(key.startsWith('_') || removedMetadata.has(key), `Unexpected metadata removal: ${file} ${key}`);
          delete original[key];
        }
        assert.deepEqual(packaged, original, `Runtime metadata mismatch: ${file}`);
      } else assert.equal(digest(extract(file)), digest(source), `Runtime source mismatch: ${file}`);
      verifiedRuntimeFiles++;
    } else assert.ok(expected.has(file), `Unexpected packaged file: ${file}`);
  }
}
for (const dependency of runtimeDependencies) {
  const metadata = JSON.parse(extract(dependency.directory + '/package.json'));
  assert.equal(metadata.version, dependency.version);
  if (dependency.name === 'lazy-val' && dependency.version === '1.0.5') {
    assert.equal(metadata.license, 'MIT'); assert.equal(metadata.author, 'Vladimir Krivosheev');
    assert.match(extract('desktop/runtime-NOTICES.txt').toString(), /lazy-val 1\.0\.5/);
  } else assert.ok(actual.some(file => file.startsWith(dependency.directory + '/') && /^licen[sc]e(?:[.-]|$)/i.test(file.slice(dependency.directory.length + 1))), `Missing runtime license: ${dependency.name}`);
}
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) await fs.access(path.join(appOutput, 'win-unpacked', file));
const installerName = `TarkovLootMap-${pkg.version}-win-x64-setup.exe`, installerPath = path.join(output, installerName);
const installer = await fs.stat(installerPath);
assert(installer.size < GITHUB_ASSET_LIMIT, 'Installer exceeds the GitHub single-asset limit');
// Inspect the actual NSIS archive without starting an installer or application.
const sevenZip = await require('app-builder-lib/out/toolsets/7zip.js').getPath7za();
const inspectionRoot = path.join(root, 'work/desktop-installer-inspection');
await fs.mkdir(inspectionRoot, {recursive: true});
const inspection = await fs.mkdtemp(path.join(inspectionRoot, 'payload-'));
let installerPayloadMatched = false;
try {
  execFileSync(sevenZip, ['t', installerPath], {cwd: root, windowsHide: true, stdio: 'pipe', timeout: 120000});
  execFileSync(sevenZip, ['e', installerPath, 'resources/app.asar', '-o' + inspection, '-y'], {cwd: root, windowsHide: true, stdio: 'pipe', timeout: 120000});
  assert.equal(digest(await fs.readFile(path.join(inspection, 'app.asar'))), digest(await fs.readFile(archive)), 'Installer contains a different application payload');
  installerPayloadMatched = true;
} finally {
  assert.ok(path.resolve(inspection).startsWith(path.resolve(inspectionRoot) + path.sep));
  await fs.rm(inspection, {recursive: true, force: true});
}
const yaml = require('js-yaml');
const updateInfo = yaml.load(await fs.readFile(path.join(output, 'latest.yml'), 'utf8'));
const {SERVER_UPDATE_URL, validateUpdateInfo} = await import('../desktop/update-release.mjs');
validateUpdateInfo(updateInfo, {version: pkg.version, name: installerName, size: installer.size}, '0.0.0');
assert.equal(updateInfo.files[0].sha512, await fileDigest(installerPath, 'sha512', 'base64'));
const updateConfig = yaml.load(await fs.readFile(path.join(appOutput, 'win-unpacked/resources/app-update.yml'), 'utf8'));
assert.equal(updateConfig.provider, 'generic');
assert.equal(updateConfig.channel, 'latest');
assert.equal(updateConfig.url.replace(/\/$/, ''), SERVER_UPDATE_URL + pkg.version);
assert.ok(!updateConfig.token && !updateConfig.requestHeaders);
const installerSha256 = await fileDigest(installerPath), asarSha256 = await fileDigest(archive);
let offlineResources = null, bundle;
try { bundle = JSON.parse(await fs.readFile(path.join(output, 'offline-bundle.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (bundle) {
  assert.equal(bundle.schemaVersion, 1); assert.equal(bundle.version, pkg.version); assert.equal(bundle.resourceId, resourceRelease.resourceLockId);
  assert.equal(bundle.installerSha256, installerSha256); assert.equal(bundle.installerBytes, installer.size); assert.equal(bundle.asarSha256, asarSha256);
  assert.equal(bundle.profile, 'default'); assert.deepEqual(bundle.quality, {geometry: 'low', texture: 'medium', scenery: 'full'});
  assert.deepEqual(bundle.maps, Object.keys(ATLAS_MAPS));
  const profileBytes = await fs.readFile(path.join(output, 'offline-profile.json'));
  assert.equal(digest(profileBytes), bundle.inventorySha256);
  const profile = JSON.parse(profileBytes); assert.equal(profile.resourceId, bundle.resourceId); assert.deepEqual(profile.quality, bundle.quality); assert.deepEqual(profile.maps, bundle.maps);
  assert.equal(profile.entries.length, bundle.resourceFiles); assert.equal(new Set(profile.entries.map(entry => entry.path)).size, profile.entries.length);
  assert(profile.entries.every(entry => /^map-resources\/(?:client-resources\.json|objects\/[a-f0-9]{64}|models\/[a-f0-9]{64}\/\d+-\d+)$/.test(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0));
  assert.equal(profile.entries.reduce((total, entry) => total + entry.bytes, 0), bundle.resourceBytes);
  const embedded = await verifyEmbeddedArchive(installerPath, bundle.resourceArchive);
  offlineResources = {profile: bundle.profile, quality: bundle.quality, maps: bundle.maps.length, files: bundle.resourceFiles, bytes: bundle.resourceBytes, archive: embedded, inventorySha256: bundle.inventorySha256};
}
const result = {version: pkg.version, verifiedPayloadFiles: inventory.files.length, verifiedRuntimeFiles, runtimeDependencies, updateMetadataVerified: true, sourceMatched: true, privatePaths: false, installerName, installerBytes: installer.size,
  installerSha256, installerSha512: updateInfo.files[0].sha512, asarSha256, resourceLockSha256: digest(await fs.readFile(path.join(root, 'desktop/resources.lock.json'))), resourceRelease, installerPayloadMatched, offlineResources, githubSingleAssetFits: true};
await fs.writeFile(path.join(output, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
