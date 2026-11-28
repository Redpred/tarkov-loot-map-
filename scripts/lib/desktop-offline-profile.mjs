import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {DEFAULT_GEOMETRY_QUALITY} from '../../site/atlas-geometry-quality.js';
import {DEFAULT_TEXTURE_QUALITY} from '../../site/atlas-texture-quality.js';
import {readSceneryMode} from '../../site/atlas-scenery-details.js';
import {readMapCachePlan} from './map-cache-plan.mjs';
import {validateArchiveLock, archiveId, ARCHIVE_CHUNK} from './desktop-resource-archive.mjs';

export const offlineHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const CLIENT_MARKER = Buffer.from('{"schemaVersion":1,"type":"tarkov-client-resources"}\n');
export const GITHUB_ASSET_LIMIT = 2 ** 31;

// Reads only lock-selected objects, never a directory-wide copy of user files.
export async function defaultOfflineProfile({lock, readObject, maps = Object.values(ATLAS_MAPS)}) {
  validateArchiveLock(lock);
  const quality = {geometry: DEFAULT_GEOMETRY_QUALITY, texture: DEFAULT_TEXTURE_QUALITY, scenery: readSceneryMode(null)};
  assert.deepEqual(quality, {geometry: 'low', texture: 'medium', scenery: 'full'}, 'Review the offline selector when defaults change');
  const objects = new Map(), models = new Map();
  const add = (collection, relative, entry) => {
    assert(entry, `Resource not locked: ${relative}`);
    const [sha256, bytes] = entry, previous = collection.get(sha256);
    if (previous) assert.equal(previous.bytes, bytes);
    else collection.set(sha256, {sha256, bytes, source: relative});
  };
  const read = async relative => {
    const entry = lock.files[relative]; assert(entry, `Metadata not locked: ${relative}`);
    const bytes = await readObject(relative, entry);
    assert.equal(bytes.length, entry[1], relative); assert.equal(offlineHash(bytes), entry[0], relative);
    add(objects, relative, entry); return JSON.parse(bytes);
  };
  const site = path.resolve('offline-profile-site');
  for (const map of maps) {
    const plan = await readMapCachePlan(site, map, quality, file => read(path.relative(site, file).replaceAll('\\', '/')));
    for (const [identity, sha256, bytes] of plan.geometry) {
      const relative = identity.slice(10); assert.deepEqual(lock.geometry[relative], [sha256, bytes]); add(models, relative, lock.geometry[relative]);
    }
    for (const [identity, sha256, bytes] of plan.texture) {
      const relative = identity.slice(9); assert.deepEqual(lock.files[relative], [sha256, bytes]); add(objects, relative, lock.files[relative]);
    }
    const prefix = `data/geometry-quality/${map.id}/low/sectors/`;
    for (const [relative, entry] of Object.entries(lock.files)) if (relative.startsWith(prefix) && relative.endsWith('.json')) add(objects, relative, entry);
    const catalog = await read(`data/geometry-quality/${map.id}/manifest.json`);
    for (const entry of Object.values(catalog.variants.low.runtime?.geometry || {})) {
      assert(entry?.file && lock.files[entry.file]?.[0] === entry.sha256, 'Runtime metadata version mismatch');
      add(objects, entry.file, lock.files[entry.file]);
    }
  }
  return {schemaVersion: 1, profile: 'default', quality, resourceId: archiveId(lock), maps: maps.map(map => map.id), objects: [...objects.values()], models: [...models.values()]};
}

export async function assertNoLinks(target) {
  const absolute = path.resolve(target), parts = [];
  for (let current = absolute; ; current = path.dirname(current)) { parts.push(current); if (current === path.dirname(current)) break; }
  for (const current of parts.reverse()) {
    try { assert(!(await fs.lstat(current)).isSymbolicLink(), 'Links are not accepted in build paths'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export async function nativeOfflineReader(root) {
  root = await assertNoLinks(root);
  const marker = await assertNoLinks(path.join(root, 'client-resources.json'));
  const markerStat = await fs.stat(marker);
  assert(markerStat.isFile() && markerStat.size === CLIENT_MARKER.length, 'Not a client resource directory');
  assert.deepEqual(await fs.readFile(marker), CLIENT_MARKER, 'Not a client resource directory');
  const checked = new Set();
  return async relative => {
    assert(/^(?:objects\/[a-f0-9]{64}|models\/[a-f0-9]{64}\/\d+-\d+)$/.test(relative), 'Invalid native resource path');
    const file = path.join(root, relative), parent = path.dirname(file);
    if (!checked.has(parent)) { await assertNoLinks(parent); checked.add(parent); }
    const stat = await fs.lstat(file); assert(stat.isFile() && !stat.isSymbolicLink(), 'Resource is not a regular file');
    assert(stat.size <= 64 * 2**20, 'Resource file exceeds the bound');
    return fs.readFile(file);
  };
}

// Complete-model hashes prevent internally consistent but misbound chunks.
export async function verifyOfflineProfile(profile, readNative, progress = () => {}) {
  const entries = [{path: 'map-resources/client-resources.json', bytes: CLIENT_MARKER.length, sha256: offlineHash(CLIENT_MARKER)}];
  for (const object of profile.objects) {
    const relative = 'objects/' + object.sha256, bytes = await readNative(relative);
    assert.equal(bytes.length, object.bytes, relative); assert.equal(offlineHash(bytes), object.sha256, relative);
    entries.push({path: 'map-resources/' + relative, bytes: bytes.length, sha256: object.sha256});
  }
  let chunks = 0;
  for (const model of profile.models) {
    const digest = createHash('sha256');
    for (let offset = 0; offset < model.bytes; offset += ARCHIVE_CHUNK) {
      const length = Math.min(ARCHIVE_CHUNK, model.bytes - offset), relative = `models/${model.sha256}/${offset}-${length}`, bytes = await readNative(relative);
      assert.equal(bytes.length, length + 64, relative);
      const body = bytes.subarray(64); assert.equal(offlineHash(body), bytes.subarray(0, 64).toString('ascii'), relative);
      digest.update(body); chunks++;
      entries.push({path: 'map-resources/' + relative, bytes: bytes.length, sha256: offlineHash(bytes)});
    }
    assert.equal(digest.digest('hex'), model.sha256, 'Complete model checksum mismatch'); progress(model.source);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {schemaVersion: 1, profile: profile.profile, quality: profile.quality, resourceId: profile.resourceId, maps: profile.maps,
    objects: profile.objects.length, models: profile.models.length, chunks, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries};
}
