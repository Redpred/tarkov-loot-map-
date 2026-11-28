// Freeze only the files reached by the fixed model and texture specifications.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {DEFAULT_GEOMETRY_QUALITY} from '../site/atlas-geometry-quality.js';
import {DEFAULT_TEXTURE_QUALITY} from '../site/atlas-texture-quality.js';
import {resourcePath} from '../desktop/policy.mjs';
import {readMapCachePlan} from './lib/map-cache-plan.mjs';
import {archiveDigest, archiveId, validateArchiveLock} from './lib/desktop-resource-archive.mjs';

export async function buildDesktopLock(site) {
  site = path.resolve(site);
  const files = new Map(), geometry = new Map(), manifests = new Map();
  const quality = {geometry: DEFAULT_GEOMETRY_QUALITY, texture: DEFAULT_TEXTURE_QUALITY};
  async function read(relative) {
    const data = await fs.readFile(path.join(site, resourcePath(relative)));
    files.set(relative, [archiveDigest(data), data.length]);
    return data;
  }
  async function manifest(file) {
    const relative = path.relative(site, file).replaceAll('\\', '/');
    if (!manifests.has(relative)) manifests.set(relative, JSON.parse(await read(relative)));
    return manifests.get(relative);
  }
  for (const map of Object.values(ATLAS_MAPS)) {
    for (const scenery of ['full', 'simple']) {
      const plan = await readMapCachePlan(site, map, {...quality, scenery}, manifest);
      for (const [identity, sha, bytes] of plan.geometry) {
        const route = identity.slice('geometry:/'.length);
        if (geometry.has(route)) assert.deepEqual(geometry.get(route), [sha, bytes], route);
        else geometry.set(route, [sha, bytes]);
      }
      for (const [identity, sha, bytes] of plan.texture) {
        const relative = identity.slice('texture:/'.length);
        if (!files.has(relative)) await read(relative);
        assert.deepEqual(files.get(relative), [sha, bytes], relative);
      }
    }
    const textureCatalog = await manifest(path.join(site, 'data/model-quality', map.id, 'manifest.json'));
    assert.deepEqual(Object.keys(textureCatalog.variants), [quality.texture]);
    for (const directory of ['geometry-quality', 'scenery-details']) {
      const base = path.join(site, 'data', directory, map.id);
      const catalog = await manifest(path.join(base, 'manifest.json'));
      assert.deepEqual(Object.keys(catalog.variants), [quality.geometry]);
      const variant = catalog.variants[quality.geometry];
      const index = await manifest(path.join(base, variant.file));
      for (const record of index.sectors || []) await manifest(path.join(base, quality.geometry, record.file));
      for (const entry of Object.values(variant.runtime.geometry)) {
        if (!files.has(entry.file)) await read(entry.file);
        assert.deepEqual(files.get(entry.file), [entry.sha256, entry.bytes], entry.file);
      }
    }
  }
  return validateArchiveLock({schemaVersion: 1, files: Object.fromEntries([...files].sort()), geometry: Object.fromEntries([...geometry].sort())});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const {values} = parseArgs({options: {site: {type: 'string', default: path.join(root, 'site')}, out: {type: 'string', default: path.join(root, 'desktop/resources.lock.json')}}});
  const lock = await buildDesktopLock(values.site);
  await fs.writeFile(values.out, JSON.stringify(lock) + '\n');
  console.log(`Pinned ${Object.keys(lock.files).length} files and ${Object.keys(lock.geometry).length} model routes (${archiveId(lock)}).`);
}
