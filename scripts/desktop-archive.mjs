// Freeze already-exported resources. No game extraction, remote downloads,
// automatic deletion, or publication. Objects are shared by content hash.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {gzip, gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createSiteServer} from './lib/site-server.mjs';
import {ARCHIVE_CHUNK, archiveDigest, archiveId, validateArchiveLock} from './lib/desktop-resource-archive.mjs';
const compress = promisify(gzip), decompress = promisify(gunzip);
const marker = '{"format":"tarkov-desktop-resource-archive","version":1}\n';

async function writeOnce(file, bytes) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, bytes, {flag: 'wx'});
    // link creates the final name atomically without replacing an old object.
    try { await fs.link(temp, file); }
    catch (error) { if (error.code !== 'EEXIST' || !(await fs.readFile(file)).equals(bytes)) throw error; }
  } finally { await fs.rm(temp, {force: true}); }
}
async function optionalRead(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
async function workers(entries, run, count = 4) {
  let cursor = 0, failed = false;
  const results = await Promise.allSettled(Array.from({length: count}, async () => {
    try { while (!failed && cursor < entries.length) await run(entries[cursor++]); }
    catch (error) { failed = true; throw error; }
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export async function buildDesktopArchive({siteRoot, archiveRoot, lock, verifyOnly = false, onProgress = () => {}}) {
  validateArchiveLock(lock);
  const site = path.resolve(siteRoot), root = path.resolve(archiveRoot), id = archiveId(lock);
  if (root === site || root.startsWith(site + path.sep) || site.startsWith(root + path.sep)) throw Error('Archive must be outside the public site');
  const markerFile = path.join(root, '.archive.json');
  if (!verifyOnly) {
    try { await fs.mkdir(root); await writeOnce(markerFile, Buffer.from(marker)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if ((await fs.readFile(markerFile, 'utf8')) !== marker) throw Error('Not a managed resource archive');
  const snapshot = path.join(root, 'snapshots', id + '.json');
  if (verifyOnly && !(await fs.readFile(snapshot)).equals(Buffer.from(JSON.stringify(lock) + '\n'))) throw Error('Snapshot mismatch');
  const unique = entries => [...new Map(Object.entries(entries).map(([name, entry]) => [entry[0], [name, entry]])).values()];
  const files = unique(lock.files), geometry = unique(lock.geometry);
  let objects = 0, models = 0, chunks = 0, sourceBytes = 0;
  await workers(files, async ([name, [hash, size]]) => {
    const output = path.join(root, 'objects', hash), existing = await optionalRead(output);
    const bytes = existing ?? (verifyOnly ? null : await fs.readFile(path.join(site, name)));
    if (!bytes || bytes.length !== size || archiveDigest(bytes) !== hash) throw Error(`Resource checksum mismatch: ${name}`);
    if (!existing) await writeOnce(output, bytes);
    sourceBytes += size; onProgress({phase: 'files', completed: ++objects, total: files.length});
  });
  const server = verifyOnly ? null : createSiteServer(site);
  try {
    if (server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
    await workers(geometry, async ([route, [version, size]]) => {
      const full = createHash('sha256');
      for (let offset = 0; offset < size; offset += ARCHIVE_CHUNK) {
        const length = Math.min(ARCHIVE_CHUNK, size-offset), output = path.join(root, 'chunks', version, `${offset}-${length}.gz`);
        const existing = await optionalRead(output);
        let bytes;
        if (existing) bytes = await decompress(existing, {maxOutputLength: Math.ceil(length/3)*4+1024});
        else {
          if (verifyOnly) throw Error(`Missing archived chunk: ${route} ${offset}`);
          const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}?${new URLSearchParams({offset, length, version})}`, {redirect: 'error', signal: AbortSignal.timeout(60000)});
          if (!response.ok) throw Error(`Resource source refused ${route}: ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
        }
        const chunk = JSON.parse(bytes), data = Buffer.from(chunk.data || '', 'base64');
        if (chunk.offset !== offset || chunk.total !== size || chunk.encoding !== 'base64' || data.length !== length || archiveDigest(data) !== chunk.sha256) throw Error(`Invalid archived chunk: ${route} ${offset}`);
        full.update(data); chunks++;
        if (!existing) await writeOnce(output, await compress(bytes, {level: 1}));
      }
      if (full.digest('hex') !== version) throw Error(`Model checksum mismatch: ${route}`);
      sourceBytes += size; onProgress({phase: 'geometry', completed: ++models, total: geometry.length});
    }, 2);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); }
  // A snapshot becomes addressable only after EVERY file and complete model
  // passes verification. Interrupted builds can resume; no older version is pruned.
  if (!verifyOnly) await writeOnce(snapshot, Buffer.from(JSON.stringify(lock) + '\n'));
  return {id, files: Object.keys(lock.files).length, routes: Object.keys(lock.geometry).length, objects, models, chunks, sourceBytes, verified: true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
  const options = {siteRoot: path.join(root, 'site'), archiveRoot: path.join(root, 'work/desktop-resource-archive')};
  let lockFile = path.join(root, 'desktop/resources.lock.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify') options.verifyOnly = true;
    else if (['--site', '--out', '--lock'].includes(args[i]) && args[i+1]) {
      const value = path.resolve(args[++i]);
      if (args[i-1] === '--lock') lockFile = value;
      else options[args[i-1] === '--site' ? 'siteRoot' : 'archiveRoot'] = value;
    } else throw Error(`Unknown argument: ${args[i]}`);
  }
  options.lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  let last = 0;
  options.onProgress = value => { if (Date.now()-last > 15000 || value.completed === value.total) { console.log(JSON.stringify(value)); last = Date.now(); } };
  console.log(JSON.stringify(await buildDesktopArchive(options)));
}
