import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {buildDesktopArchive} from '../desktop-archive.mjs';
import {archiveId, archiveDigest as hash, ARCHIVE_CHUNK, validateArchiveLock} from '../lib/desktop-resource-archive.mjs';
import {createSiteServer} from '../lib/site-server.mjs';
import {createDesktopResources} from '../../desktop/resources.mjs';

const manifestPath = 'data/atlas/factory-geometry.json', route = 'api/factory-geometry';
async function fixture(t) {
  const work = path.resolve('work'); await fs.mkdir(work, {recursive: true});
  const directory = await fs.mkdtemp(path.join(work, 'desktop-archive-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), work); assert.ok(path.basename(directory).startsWith('desktop-archive-test-'));
    await fs.rm(directory, {recursive: true, force: true});
  });
  const siteRoot = path.join(directory, 'site'), archiveRoot = path.join(directory, 'archive');
  await fs.mkdir(path.join(siteRoot, 'data/atlas'), {recursive: true});
  async function source(byte, size = ARCHIVE_CHUNK + 37) {
    const data = Buffer.alloc(size, byte), version = hash(data);
    const manifest = Buffer.from(JSON.stringify({sha256: version, stats: {bytes: size}, meshes: [], materials: [], textures: {}}));
    await fs.writeFile(path.join(siteRoot, manifestPath), manifest);
    await fs.writeFile(path.join(siteRoot, 'data/atlas/factory-geometry.bin'), data);
    const lock = {schemaVersion: 1, files: {[manifestPath]: [hash(manifest), manifest.length]}, geometry: {[route]: [version, size]}};
    return {lock, manifest, data, id: archiveId(lock)};
  }
  return {siteRoot, archiveRoot, directory, source};
}
async function serving(t, options) {
  const server = createSiteServer(options.siteRoot, {resourceArchive: options.archiveRoot});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const query = (v, offset = 0) => new URLSearchParams({offset, length: Math.min(ARCHIVE_CHUNK, v.data.length-offset), version: hash(v.data)});

test('two retained versions survive replacement/removal of live resources; desktop downloads stay pinned and metadata reopens offline', async t => {
  const f = await fixture(t), old = await f.source(13);
  const first = await buildDesktopArchive({...f, lock: old.lock});
  assert.equal(first.chunks, 2);
  const newer = await f.source(27); await buildDesktopArchive({...f, lock: newer.lock});
  await fs.rename(f.siteRoot, f.siteRoot + '-retired'); await fs.mkdir(f.siteRoot);
  const base = await serving(t, f);
  for (const v of [old, newer]) {
    const verify = await buildDesktopArchive({...f, lock: v.lock, verifyOnly: true}); assert.equal(verify.verified, true);
    const local = path.join(f.directory, v.id); await fs.mkdir(local);
    const options = {siteRoot: local, cacheRoot: path.join(local, 'metadata'), lock: v.lock, fetcher: async (url, init) => {
      assert.ok(new URL(url).pathname.startsWith(`/desktop-resources/${v.id}/`), 'no fallback to changed live resources');
      return fetch(base + new URL(url).pathname + new URL(url).search, init);
    }};
    const client = createDesktopResources(options);
    assert.deepEqual(await client.read(manifestPath), v.manifest);
    for (const offset of [0, ARCHIVE_CHUNK]) {
      const response = await client.handle(new Request(`tarkov://app/${route}?${query(v, offset)}`));
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from((await response.json()).data, 'base64'), v.data.subarray(offset, offset + ARCHIVE_CHUNK));
    }
    const offline = createDesktopResources({...options, fetcher: () => { throw Error('offline'); }});
    assert.deepEqual(await offline.read(manifestPath), v.manifest);
  }
  assert.equal((await fs.readdir(path.join(f.archiveRoot, 'snapshots'))).length, 2);
});

test('archive routes enforce snapshot/path/range binding and support immutable HEAD, ETag, gzip and identity', async t => {
  const f = await fixture(t), v = await f.source(3, 29);
  await buildDesktopArchive({...f, lock: v.lock}); const base = await serving(t, f), prefix = `${base}/desktop-resources/${v.id}/`;
  const url = prefix + manifestPath, response = await fetch(url), etag = response.headers.get('etag');
  assert.equal(response.headers.get('x-resource-delivery'), 'archive'); await response.arrayBuffer();
  assert.equal((await fetch(url, {headers: {'if-none-match': etag}})).status, 304);
  const head = await fetch(url, {method: 'HEAD'}); assert.equal(await head.text(), ''); assert.equal(head.headers.get('content-length'), String(v.manifest.length));
  for (const encoding of ['gzip', 'identity']) {
    const chunk = await fetch(prefix + route + '?' + query(v), {headers: {'accept-encoding': encoding}});
    assert.equal(chunk.headers.get('content-encoding'), encoding === 'gzip' ? 'gzip' : null);
    assert.deepEqual(Buffer.from((await chunk.json()).data, 'base64'), v.data);
  }
  for (const tail of [route + '?' + query(v, 1), route + '?' + query(v) + '&offset=0', route + '?' + query(v).toString().replace(hash(v.data), 'a'.repeat(64)), manifestPath + '?v=x']) assert.equal((await fetch(prefix + tail)).status, 400);
  for (const tail of ['', 'objects/' + hash(v.manifest), 'data/atlas/unlisted.json', 'data/atlas/%2e%2e/private.json']) assert.equal((await fetch(prefix + tail)).status, 404);
  assert.equal((await fetch(url, {method: 'POST'})).status, 405);
  assert.equal((await fetch(prefix.replace(v.id, '0'.repeat(64)) + manifestPath)).status, 404);
  assert.equal((await fetch(base + '/data/resource-archive/objects/' + hash(v.manifest))).status, 404);
});

test('interrupted build publishes nothing, resumes shared objects, and verification detects damage without overwriting', async t => {
  const f = await fixture(t), v = await f.source(9, 51);
  const binary = path.join(f.siteRoot, 'data/atlas/factory-geometry.bin');
  await fs.writeFile(binary, Buffer.alloc(v.data.length, 8));
  await assert.rejects(buildDesktopArchive({...f, lock: v.lock}), /Model checksum mismatch/);
  await assert.rejects(fs.stat(path.join(f.archiveRoot, 'snapshots', v.id + '.json')), {code: 'ENOENT'});
  // Failed chunks are intentionally retained for diagnosis, never published.
  // A new archive can finish from intact source; a bad existing object fails closed.
  await fs.writeFile(binary, v.data);
  await assert.rejects(buildDesktopArchive({...f, lock: v.lock}), /Model checksum mismatch/);
  const goodRoot = path.join(f.directory, 'good-archive');
  await buildDesktopArchive({...f, archiveRoot: goodRoot, lock: v.lock});
  const object = path.join(goodRoot, 'objects', hash(v.manifest)), before = await fs.stat(object);
  await buildDesktopArchive({...f, archiveRoot: goodRoot, lock: v.lock});
  assert.equal((await fs.stat(object)).mtimeMs, before.mtimeMs);
  await fs.writeFile(object, 'damaged');
  await assert.rejects(buildDesktopArchive({...f, archiveRoot: goodRoot, lock: v.lock, verifyOnly: true}), /checksum mismatch/);
  assert.equal(await fs.readFile(object, 'utf8'), 'damaged');
});

test('missing committed archive object fails closed without trying the current site', async t => {
  const f = await fixture(t), v = await f.source(4, 17);
  await buildDesktopArchive({...f, lock: v.lock});
  await fs.unlink(path.join(f.archiveRoot, 'objects', hash(v.manifest)));
  const base = await serving(t, f), empty = path.join(f.directory, 'empty'); await fs.mkdir(empty);
  let requests = 0;
  const client = createDesktopResources({siteRoot: empty, cacheRoot: path.join(empty, 'cache'), lock: v.lock, fetcher: (url, init) => { requests++; return fetch(base + new URL(url).pathname, init); }});
  await assert.rejects(client.read(manifestPath), /503/); assert.equal(requests, 1);
});

test('legacy server fallback is limited to 404 and still verifies the locked bytes', async t => {
  const f = await fixture(t), v = await f.source(5, 16), empty = path.join(f.directory, 'empty'); await fs.mkdir(empty);
  let calls = [];
  const options = {siteRoot: empty, cacheRoot: path.join(empty, 'cache'), lock: v.lock, fetcher: async url => {
    calls.push(url); return new URL(url).pathname.startsWith('/desktop-resources/') ? new Response('', {status: 404}) : new Response(v.manifest);
  }};
  assert.deepEqual(await createDesktopResources(options).read(manifestPath), v.manifest); assert.equal(calls.length, 2);
  const changed = {...options, cacheRoot: path.join(empty, 'other'), fetcher: async url => new URL(url).pathname.startsWith('/desktop-resources/') ? new Response('', {status: 404}) : new Response('changed')};
  await assert.rejects(createDesktopResources(changed).read(manifestPath), /校验失败/);
  calls = [];
  await assert.rejects(createDesktopResources({...options, cacheRoot: path.join(empty, 'missing'), fetcher: async url => { calls.push(url); return new Response('', {status: 503}); }}).read(manifestPath), /503/);
  assert.equal(calls.length, 1);
});

test('archive lock rejects traversal, executable content and conflicting sizes; output cannot be a public directory', async t => {
  const f = await fixture(t), v = await f.source(6, 16);
  for (const name of ['data/atlas/../secret.json', 'data/atlas/x:secret.json', 'data/atlas/script.js', '../private.json']) assert.throws(() => validateArchiveLock({...v.lock, files: {[name]: [hash(v.manifest), v.manifest.length]}}));
  assert.throws(() => validateArchiveLock({...v.lock, files: {...v.lock.files, 'data/atlas/other.json': [hash(v.manifest), 1]}}));
  await assert.rejects(buildDesktopArchive({...f, archiveRoot: path.join(f.siteRoot, 'archive'), lock: v.lock}), /outside/);
  assert.throws(() => createSiteServer(f.siteRoot, {resourceArchive: path.join(f.siteRoot, 'archive')}), /outside/);
});
