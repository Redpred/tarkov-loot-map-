import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream';
import {acceptsGzip, matchesEtag} from './http-resource-cache.mjs';

export const ARCHIVE_CHUNK = 4 * 2**20;
export const archiveDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const archiveId = lock => archiveDigest(JSON.stringify(lock));
export function validateArchiveLock(lock) {
  if (lock?.schemaVersion !== 1 || !lock.files || !lock.geometry) throw Error('Invalid resource lock');
  const sizes = new Map();
  for (const [group, entries] of Object.entries({files: lock.files, geometry: lock.geometry})) {
    if (Array.isArray(entries) || typeof entries !== 'object') throw Error('Invalid resource entries');
    for (const [name, entry] of Object.entries(entries)) {
      const validPath = group === 'files'
        ? /^data\/(atlas|geometry-quality|model-quality|scenery-details|runtime)\/[a-zA-Z0-9_./-]+\.(json|png|webp)$/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..')
        : /^api\/[a-z_]+-geometry(?:\/(medium|low))?(?:\/simple)?(?:\/s_-?\d+_-?\d+)?$/.test(name);
      if (!validPath || !Array.isArray(entry) || entry.length !== 2 || !/^[a-f0-9]{64}$/.test(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[1] <= 0 || (group === 'files' && entry[1] > 64 * 2**20)) throw Error(`Invalid resource entry: ${name}`);
      if (sizes.has(entry[0]) && sizes.get(entry[0]) !== entry[1]) throw Error('Conflicting resource sizes');
      sizes.set(entry[0], entry[1]);
    }
  }
  return lock;
}

// The archive is outside the public site. Only paths bound by an immutable lock
// are served, never its directory listing, storage layout or arbitrary files.
export function createDesktopArchiveHandler(directory) {
  const root = directory && path.resolve(directory), snapshots = new Map();
  async function readSnapshot(id) {
    if (snapshots.has(id)) return snapshots.get(id);
    const file = path.join(root, 'snapshots', id + '.json'), stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > 32 * 2**20) throw Error('Invalid archive snapshot');
    const lock = validateArchiveLock(JSON.parse(await fs.promises.readFile(file, 'utf8')));
    if (archiveId(lock) !== id) throw Error('Archive snapshot checksum mismatch');
    snapshots.set(id, lock);
    if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value);
    return lock;
  }
  return async function serve(url, req, res) {
    const end = status => res.writeHead(status, {'Cache-Control': 'no-store'}).end();
    if (!root) { end(404); return; }
    const match = /^\/desktop-resources\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
    if (!match) { end(404); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { end(405); return; }
    let lock;
    try { lock = await readSnapshot(match[1]); }
    catch (error) { end(error.code === 'ENOENT' ? 404 : 503); return; }
    const relative = match[2];
    const isGeometry = Object.hasOwn(lock.geometry, relative);
    const entry = isGeometry ? lock.geometry[relative] : Object.hasOwn(lock.files, relative) ? lock.files[relative] : null;
    if (!entry) { end(404); return; }
    const [hash, size] = entry;
    let file, etag = `"${hash}"`;
    if (isGeometry) {
      const offsetText = url.searchParams.get('offset'), lengthText = url.searchParams.get('length');
      const offset = Number(offsetText), length = Number(lengthText);
      if (req.method !== 'GET') { end(405); return; }
      if ([...url.searchParams].length !== 3 || url.searchParams.get('version') !== hash || !/^\d+$/.test(offsetText ?? '') || !/^\d+$/.test(lengthText ?? '') || !Number.isSafeInteger(offset) || offset % ARCHIVE_CHUNK || offset >= size || length !== Math.min(ARCHIVE_CHUNK, size-offset)) { end(400); return; }
      file = path.join(root, 'chunks', hash, `${offset}-${length}.gz`);
      etag = `"${hash}-${offset}-${length}"`;
    } else {
      if (url.search) { end(400); return; }
      file = path.join(root, 'objects', hash);
    }
    let stat;
    try { stat = await fs.promises.stat(file); } catch { end(503); return; }
    if (!stat.isFile() || (!isGeometry && stat.size !== size)) { end(503); return; }
    const compressed = isGeometry && acceptsGzip(req.headers['accept-encoding']);
    const type = isGeometry || relative.endsWith('.json') ? 'application/json; charset=utf-8' : relative.endsWith('.png') ? 'image/png' : 'image/webp';
    const headers = {'Content-Type': type, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': etag, 'X-Resource-Delivery': 'archive'};
    if (isGeometry) headers.Vary = 'Accept-Encoding';
    if (compressed) headers['Content-Encoding'] = 'gzip';
    if (matchesEtag(req.headers['if-none-match'], etag)) { res.writeHead(304, headers).end(); return; }
    if (!isGeometry || compressed) headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file);
    if (isGeometry && !compressed) pipeline(stream, createGunzip(), res, () => {});
    else pipeline(stream, res, () => {});
  };
}
