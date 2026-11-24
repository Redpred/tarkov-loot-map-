import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

const require = createRequire(new URL('../../desktop/package.json', import.meta.url));

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'map-build-deps-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('map-build-deps-'));
    await fs.rm(resolved, {recursive: true, force: true});
  });
  const files = { 'main.js': 'export const test = 1;', 'space dir/地图.json': '{"test":true}',
    '.hidden/config.json': '{}', 'assets/sample.bin': Buffer.from([0, 1, 127, 255]), 'ignore.txt': 'ignore' };
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, 'app', name)), {recursive: true});
    await fs.writeFile(path.join(directory, 'app', name), content);
  }
  return {directory, app: path.join(directory, 'app'), files};
}

test('upgraded ASAR packs and extracts nested, Unicode, hidden and unpacked files', async t => {
  const {directory, app, files} = await fixture(t), asar = require('@electron/asar');
  const archive = path.join(directory, 'app.asar');
  await asar.createPackageWithOptions(app, archive, {unpack: '*.bin'});
  for (const [name, content] of Object.entries(files)) assert.deepEqual(asar.extractFile(archive, path.normalize(name)), Buffer.from(content), name);
  assert.equal(asar.statFile(archive, path.normalize('assets/sample.bin')).unpacked, true);
  const output = path.join(directory, 'extracted');
  asar.extractAll(archive, output);
  for (const [name, content] of Object.entries(files)) assert.deepEqual(await fs.readFile(path.join(output, name)), Buffer.from(content));
});

test('file selection and packaging imports retain the APIs used by the NSIS build', async t => {
  const {app} = await fixture(t);
  const asarRequire = createRequire(require.resolve('@electron/asar'));
  const {glob} = asarRequire('glob');
  assert.deepEqual((await glob('**/*.{js,json}', {cwd: app, dot: true, nodir: true})).map(file => file.replaceAll('\\', '/')).sort(),
    ['.hidden/config.json', 'main.js', 'space dir/地图.json']);
  const {FileList} = require('filelist');
  const pattern = path.join(app, '**/*.{js,json}').replaceAll('\\', '/');
  const list = new FileList(pattern).toArray().map(file => path.relative(app, file).replaceAll('\\', '/')).sort();
  assert.deepEqual(list, ['main.js', 'space dir/地图.json']);
  assert.equal(typeof require('@electron/universal').makeUniversalApp, 'function');
});
