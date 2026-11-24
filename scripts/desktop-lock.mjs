// Maintainer-only operation: freeze already prepared assets, never extract or modify them.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
const root = path.resolve(import.meta.dirname, '..'), site = path.join(root, 'site');
const files = {}, geometry = {};
for (const directory of ['atlas', 'geometry-quality', 'model-quality', 'scenery-details', 'runtime']) {
  const base = `data/${directory}`;
  for (const name of (await fs.readdir(path.join(site, base), {recursive: true})).sort()) {
    const relative = `${base}/${name.replaceAll('\\', '/')}`;
    if (!/\.(json|webp|png)$/.test(relative)) continue;
    if (directory === 'runtime' && !/^data\/runtime\/[a-f0-9]{64}\.json$/.test(relative)) continue;
    const data = await fs.readFile(path.join(site, relative));
    files[relative] = [createHash('sha256').update(data).digest('hex'), data.length];
  }
}
for (const map of Object.values(ATLAS_MAPS)) {
  for (const tier of ['original', 'medium', 'low']) for (const scenery of ['full', 'simple']) {
    const file = scenery === 'simple' ? `data/scenery-details/${map.id}/${tier}/manifest.json` : tier === 'original' ? map.geometry : `data/geometry-quality/${map.id}/${tier}/manifest.json`;
    const manifest = JSON.parse(await fs.readFile(path.join(site, file), 'utf8'));
    const endpoint = `api/${map.id}-geometry${tier === 'original' ? '' : '/' + tier}${scenery === 'simple' ? '/simple' : ''}`;
    for (const model of map.streamed ? manifest.sectors : [manifest]) geometry[endpoint + (map.streamed ? '/' + model.id : '')] = [model.sha256, model.stats.bytes];
  }
}
const lock = {schemaVersion: 1, files, geometry};
await fs.writeFile(path.join(root, 'desktop/resources.lock.json'), JSON.stringify(lock) + '\n');
console.log(`Pinned ${Object.keys(files).length} resource files and ${Object.keys(geometry).length} geometry routes.`);
