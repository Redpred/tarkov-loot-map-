import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {defaultOfflineProfile, verifyOfflineProfile, nativeOfflineReader, CLIENT_MARKER, offlineHash as hash} from '../lib/desktop-offline-profile.mjs';
import {verifyEmbeddedArchive} from '../lib/desktop-offline-artifact.mjs';

async function fixture(t, streamed = false) {
  const workspace = path.resolve('work'); await fs.mkdir(workspace, {recursive: true});
  const directory = await fs.mkdtemp(path.join(workspace, 'offline-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), workspace); await fs.rm(directory, {recursive: true, force: true}); });
  const root = path.join(directory, 'map-resources'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'client-resources.json'), CLIENT_MARKER);
  const id = streamed ? 'streets' : 'factory', map = {id, streamed, geometry: `data/atlas/${id}-geometry.json`, textureBase: 'data/atlas/', endpoint: `api/${id}-geometry`};
  const data = Buffer.from('synthetic low-detail geometry'), sha = hash(data), objects = new Map();
  const lock = {schemaVersion: 1, files: {}, geometry: {}};
  const add = (name, value) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); objects.set(hash(bytes), bytes); lock.files[name] = [hash(bytes), bytes.length]; return hash(bytes); };
  const textures = Object.fromEntries(['used', 'unused'].map(name => [name, {sha256: hash(name), colorSpace: 'srgb', size: [256, 256]}]));
  const original = {sha256: hash('original geometry'), stats: {bytes: 123}, meshes: [{material: 0}], materials: [{tex: 'used'}], textures};
  if (streamed) original.sectors = [{id: 's_0_0', file: 'sectors/s_0_0.json', bounds: [], materialIds: [0], sha256: hash('original geometry'), stats: {bytes: 123}}];
  const originalSha = add(map.geometry, original);
  const low = {...original, sha256: sha, stats: {bytes: data.length}, geometryQuality: {quality: 'low', sourceManifestSha256: originalSha}};
  if (streamed) low.sectors = original.sectors.map(sector => ({...sector, sha256: sha, stats: {bytes: data.length}}));
  const lowSha = add(`data/geometry-quality/${id}/low/manifest.json`, low);
  const runtimePath = `data/geometry-quality/${id}/low/runtime/spatial.json`, runtimeSha = add(runtimePath, {syntheticIndex: true});
  add(`data/geometry-quality/${id}/manifest.json`, {schemaVersion: 1, mapId: id, sourceManifestSha256: originalSha, variants: {low: {file: 'low/manifest.json', manifestSha256: lowSha, runtime: {geometry: {index: {file: runtimePath, sha256: runtimeSha}}}}}});
  const medium = {};
  for (const name of Object.keys(textures)) {
    const bytes = Buffer.from('synthetic medium texture ' + name), textureSha = hash(bytes), file = `medium/${textureSha}.webp`;
    add(`data/model-quality/${id}/${file}`, bytes);
    medium[name] = {file, sha256: textureSha, bytes: bytes.length, sourceSha256: textures[name].sha256, colorSpace: 'srgb', size: [128, 128]};
  }
  add(`data/model-quality/${id}/manifest.json`, {schemaVersion: 1, mapId: id, sourceManifestSha256: originalSha, variants: {medium: {textures: medium}}});
  if (streamed) add(`data/geometry-quality/${id}/low/sectors/s_0_0.json`, {syntheticSector: true});
  const ignoredSha = add(`data/geometry-quality/${id}/medium/sectors/s_0_0.json`, {notDefault: true});
  lock.geometry[`api/${id}-geometry/low${streamed ? '/s_0_0' : ''}`] = [sha, data.length];
  lock.geometry[`api/${id}-geometry`] = [hash('unused high geometry'), 500];
  for (const [digest, bytes] of objects) { await fs.mkdir(path.join(root, 'objects'), {recursive: true}); await fs.writeFile(path.join(root, 'objects', digest), bytes); }
  const modelFile = path.join(root, 'models', sha, `0-${data.length}`); await fs.mkdir(path.dirname(modelFile), {recursive: true}); await fs.writeFile(modelFile, Buffer.concat([Buffer.from(sha), data]));
  return {directory, root, lock, map, runtimeSha, ignoredSha, unusedTexture: medium.unused.sha256, modelFile, data, readObject: async (_relative, [digest]) => objects.get(digest)};
}

for (const streamed of [false, true]) test(`default profile includes required metadata, deduplicates models and omits unused tiers/textures (${streamed ? 'streamed' : 'single'})`, async t => {
  const f = await fixture(t, streamed), profile = await defaultOfflineProfile({...f, maps: [f.map]});
  assert.deepEqual(profile.quality, {geometry: 'low', texture: 'medium', scenery: 'full'});
  assert(profile.objects.some(object => object.sha256 === f.runtimeSha));
  assert(!profile.objects.some(object => [f.ignoredSha, f.unusedTexture].includes(object.sha256)));
  if (streamed) assert(profile.objects.some(object => object.source.endsWith('/low/sectors/s_0_0.json')));
  assert.equal(profile.models.length, 1);
  const inventory = await verifyOfflineProfile(profile, await nativeOfflineReader(f.root));
  assert.equal(inventory.models, 1); assert.equal(inventory.chunks, 1);
  assert(inventory.entries.every(entry => entry.path.startsWith('map-resources/')));
});

test('resource selection fails when locked metadata or runtime references are corrupted', async t => {
  const f = await fixture(t);
  await assert.rejects(defaultOfflineProfile({...f, maps: [f.map], readObject: async () => Buffer.from('{}')}));
  delete f.lock.files[`data/geometry-quality/factory/low/runtime/spatial.json`];
  await assert.rejects(defaultOfflineProfile({...f, maps: [f.map]}), /Runtime metadata version mismatch/);
});

test('complete-model verification rejects self-consistent chunks for another model', async t => {
  const f = await fixture(t), profile = await defaultOfflineProfile({...f, maps: [f.map]});
  const changed = Buffer.alloc(f.data.length, 1);
  await fs.writeFile(f.modelFile, Buffer.concat([Buffer.from(hash(changed)), changed]));
  await assert.rejects(verifyOfflineProfile(profile, await nativeOfflineReader(f.root)), /Complete model checksum mismatch/);
});

test('native build reads refuse redirected resource directories and foreign markers', async t => {
  const f = await fixture(t), alias = path.join(f.directory, 'alias');
  await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(nativeOfflineReader(alias), /Links are not accepted/);
  await fs.writeFile(path.join(f.root, 'client-resources.json'), '{}');
  await assert.rejects(nativeOfflineReader(f.root), /Not a client resource directory/);
});

test('embedded resource verification covers stream boundaries and detects payload corruption', async t => {
  const f = await fixture(t), bytes = Buffer.from(Array.from({length: 250}, (_, i) => i)), file = path.join(f.directory, 'installer.bin');
  const descriptor = {bytes: bytes.length, sha256: hash(bytes), headerHex: bytes.subarray(0, 64).toString('hex')};
  await fs.writeFile(file, Buffer.concat([Buffer.alloc(65530), bytes, Buffer.from('trailer')]));
  assert.equal((await verifyEmbeddedArchive(file, descriptor)).offset, 65530);
  const damaged = Buffer.from(bytes); damaged[150] ^= 1;
  await fs.writeFile(file, Buffer.concat([Buffer.alloc(65530), damaged]));
  await assert.rejects(verifyEmbeddedArchive(file, descriptor), /missing or corrupt/);
});
