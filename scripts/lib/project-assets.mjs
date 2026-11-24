import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createReleaseZip} from './release-zip.mjs';
import {fileDigest} from './desktop-offline-artifact.mjs';
import {assertNoLinks} from './desktop-offline-profile.mjs';

export const assetHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateProjectAssets(lock) {
  assert(lock.schemaVersion === 1 && Array.isArray(lock.files) && lock.files.length > 0, 'Invalid project asset lock');
  const paths = new Set();
  for (const entry of lock.files) {
    assert(/^(?:site\/(?:data|previews)\/|data\/|icon\/)/.test(entry.path) && !/[\\:%?#\u0000-\u001f]/.test(entry.path) && entry.path.split('/').every(p => p && p !== '.' && p !== '..'), 'Invalid asset path');
    assert(['runtime', 'inputs'].includes(entry.group) && entry.group === (entry.path.startsWith('site/') ? 'runtime' : 'inputs'), 'Invalid asset group');
    assert(/^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes < 100 * 2**20, 'Invalid asset identity');
    assert(!paths.has(entry.path.toLowerCase()), 'Duplicate asset path'); paths.add(entry.path.toLowerCase());
  }
  return assetHash(JSON.stringify(lock));
}

export async function verifyProjectAssets(root, lock, group = 'all') {
  validateProjectAssets(lock); assert(['all','runtime','inputs'].includes(group), 'Invalid asset group');
  const files = lock.files.filter(e => group === 'all' || e.group === group);
  for (const entry of files) {
    const file = await assertNoLinks(path.join(root, entry.path));
    const stat = await fs.stat(file).catch(() => null);
    assert(stat?.isFile() && stat.size === entry.bytes, `Asset missing or wrong size: ${entry.path}. Run assets:restore with the matching resource bundle.`);
    assert.equal(await fileDigest(file), entry.sha256, `Asset checksum mismatch: ${entry.path}`);
  }
  return {files: files.length, bytes: files.reduce((n,e) => n + e.bytes, 0)};
}

export async function packProjectAssets(root, lock, output) {
  const lockId = validateProjectAssets(lock); await verifyProjectAssets(root, lock);
  await assertNoLinks(output); await fs.mkdir(path.dirname(output),{recursive:true}); await fs.mkdir(output);
  const index = {schemaVersion: 1, lockId, packs: [], objects: {}};
  for (const group of ['runtime', 'inputs']) {
    const entries = lock.files.filter(e => e.group === group), name = `project-assets-${group}.zip`;
    if (!entries.length) continue;
    const writer = await createReleaseZip(path.join(output, name));
    try {
      for (const entry of entries) {
        if (index.objects[entry.sha256]) continue;
        const bytes = await fs.readFile(path.join(root, entry.path));
        assert.equal(assetHash(bytes), entry.sha256);
        const offset = await writer.add('objects/' + entry.sha256, bytes);
        index.objects[entry.sha256] = {pack: name, offset, bytes: bytes.length};
      }
      const result = await writer.finish(); assert(result.bytes < 2**31, 'Asset ZIP exceeds 2 GiB');
      index.packs.push({name, ...result});
    } finally { await writer.close(); }
  }
  const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'project-assets-index.json'), bytes, {flag:'wx'});
  const descriptor = {schemaVersion:1, lockId, repository:'Redpred/tarkov-loot-map', tag:'project-assets-' + lockId.slice(0,20), index:{name:'project-assets-index.json', bytes:bytes.length, sha256:assetHash(bytes)}};
  await fs.writeFile(path.join(output, 'project-assets-release.json'), JSON.stringify(descriptor,null,2)+'\n', {flag:'wx'});
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), [...index.packs.map(e=>`${e.sha256}  ${e.name}`),`${descriptor.index.sha256}  ${descriptor.index.name}`].join('\n')+'\n', {flag:'wx'});
  return descriptor;
}

export async function restoreProjectAssets(root, lock, descriptor, from, group = 'all') {
  const lockId = validateProjectAssets(lock);
  assert(['all','runtime','inputs'].includes(group), 'Invalid asset group');
  assert(descriptor.schemaVersion === 1 && descriptor.lockId === lockId && descriptor.index.name === 'project-assets-index.json');
  const indexPath = await assertNoLinks(path.join(from, descriptor.index.name));
  assert.equal((await fs.stat(indexPath)).size, descriptor.index.bytes);
  const indexBytes = await fs.readFile(indexPath); assert.equal(assetHash(indexBytes), descriptor.index.sha256, 'Asset index checksum mismatch');
  const index = JSON.parse(indexBytes); assert.equal(index.lockId, lockId);
  const entries = lock.files.filter(e => group === 'all' || e.group === group), selected = [], packs = new Map();
  // Preflight all destinations before writing. Existing mismatches are never overwritten.
  for (const entry of entries) {
    const target = await assertNoLinks(path.join(root, entry.path)), stat = await fs.stat(target).catch(error => {if (error.code !== 'ENOENT') throw error; return null;});
    if (stat) { assert(stat.isFile() && stat.size === entry.bytes && await fileDigest(target) === entry.sha256, `Existing asset differs; preserve it before restoring: ${entry.path}`); continue; }
    const member = index.objects[entry.sha256], pack = index.packs.find(p => p.name === member?.pack);
    assert(pack && /^project-assets-(runtime|inputs)\.zip$/.test(pack.name) && /^[a-f0-9]{64}$/.test(pack.sha256) && pack.bytes < 2**31);
    assert(Number.isSafeInteger(member.offset) && member.offset >= 0 && member.bytes === entry.bytes && member.offset + member.bytes <= pack.bytes);
    packs.set(pack.name, pack); selected.push({entry, target, member});
  }
  for (const pack of packs.values()) {
    const file = await assertNoLinks(path.join(from,pack.name)); assert.equal((await fs.stat(file)).size, pack.bytes);
    assert.equal(await fileDigest(file), pack.sha256, 'Asset archive checksum mismatch');
  }
  const handles = new Map();
  try {
    for (const {entry,target,member} of selected) {
      if (!handles.has(member.pack)) handles.set(member.pack, await fs.open(path.join(from, member.pack), 'r'));
      const bytes = Buffer.alloc(entry.bytes); let offset=0;
      while(offset<bytes.length){const read=await handles.get(member.pack).read(bytes,offset,bytes.length-offset,member.offset+offset); assert(read.bytesRead>0); offset+=read.bytesRead;}
      assert.equal(assetHash(bytes), entry.sha256, `Asset object checksum mismatch: ${entry.path}`);
      await assertNoLinks(target); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,bytes,{flag:'wx'});
    }
  } finally { await Promise.all([...handles.values()].map(handle=>handle.close())); }
  return {restored:selected.length,reused:entries.length-selected.length,lockId};
}

// Refresh only the existing allowlist and explicitly requested changes; never sweep raw resource folders.
export async function refreshProjectAssetLock(root, lock, {add = [], remove = []} = {}) {
  validateProjectAssets(lock);
  assert(Array.isArray(add) && Array.isArray(remove) && [...add,...remove].every(p => typeof p === 'string'), 'Asset changes must contain path arrays');
  const previous = new Map(lock.files.map(e => [e.path,e]));
  assert(new Set(add).size === add.length && new Set(remove).size === remove.length, 'Duplicate asset changes');
  for (const file of remove) assert(previous.has(file), `Cannot remove an unlocked asset: ${file}`);
  for (const file of add) assert(!previous.has(file) && !remove.includes(file), `Asset is already locked: ${file}`);
  const selected = [...lock.files.filter(e => !remove.includes(e.path)), ...[...add].sort().map(file => ({path:file,group:file.startsWith('site/')?'runtime':'inputs',bytes:1,sha256:'0'.repeat(64)}))];
  validateProjectAssets({schemaVersion:1,files:selected});
  const files = [];
  for (const entry of selected) {
    const file = await assertNoLinks(path.join(root,entry.path)), stat = await fs.stat(file);
    assert(stat.isFile() && stat.size > 0 && stat.size < 100 * 2**20, `Invalid asset size: ${entry.path}`);
    files.push({path:entry.path,group:entry.group,bytes:stat.size,sha256:await fileDigest(file)});
  }
  const candidate = {...lock,files}, lockId = validateProjectAssets(candidate);
  return {lock:candidate,lockId,changes:{added:[...add].sort(),removed:[...remove].sort(),changed:files.filter(e => previous.has(e.path) && (e.sha256 !== previous.get(e.path).sha256 || e.bytes !== previous.get(e.path).bytes)).map(e => e.path)}};
}
