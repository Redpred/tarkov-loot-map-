import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileDigest} from './desktop-offline-artifact.mjs';
import {assertNoLinks} from './desktop-offline-profile.mjs';

export function snapshotRelative(value) {
  assert(typeof value === 'string' && /^(EscapeFromTarkov\.exe|EscapeFromTarkov_Data(?:\/[^:]+)?)$/.test(value) && !/[\\%\u0000-\u001f]/.test(value) && value.split('/').every(p=>p&&p!=='.'&&p!=='..'), 'Invalid client snapshot path');
  return value;
}
export async function copyClientSnapshot({source, output, include = ['EscapeFromTarkov.exe','EscapeFromTarkov_Data']}) {
  source=await assertNoLinks(source); output=await assertNoLinks(output);
  assert(source!==output&&!output.startsWith(source+path.sep)&&!source.startsWith(output+path.sep),'Snapshot must be independent of its source');
  const files=new Set();
  async function collect(relative) {
    snapshotRelative(relative); const full=await assertNoLinks(path.join(source,relative)),stat=await fs.lstat(full);
    assert(!stat.isSymbolicLink(),'Linked client files are not accepted');
    if(stat.isDirectory())for(const entry of await fs.readdir(full))await collect(relative+'/'+entry);
    else {assert(stat.isFile());files.add(relative);}
  }
  for(const relative of include)await collect(snapshotRelative(relative));
  assert(files.size>0,'No client files selected');await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output);
  for(const relative of files){const target=path.join(output,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(source,relative),target,fs.constants.COPYFILE_EXCL);}
  // Only copies are hashed or parsed. The source installation is never inspected.
  const entries=[];
  for(const relative of [...files].sort()){const copy=path.join(output,relative);entries.push({path:relative,bytes:(await fs.stat(copy)).size,sha256:await fileDigest(copy)});}
  const manifest={schemaVersion:1,type:'eft-client-snapshot',createdAt:new Date().toISOString(),files:entries};
  await fs.writeFile(path.join(output,'client-snapshot.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
export async function verifyClientSnapshot(directory) {
  directory=await assertNoLinks(directory);
  const manifest=JSON.parse(await fs.readFile(await assertNoLinks(path.join(directory,'client-snapshot.json')),'utf8'));
  assert(manifest.schemaVersion===1&&manifest.type==='eft-client-snapshot'&&Array.isArray(manifest.files)&&manifest.files.length>0,'Use client:snapshot to create a verified copy first');
  const seen=new Set();
  for(const entry of manifest.files){snapshotRelative(entry.path);assert(!seen.has(entry.path.toLowerCase()));seen.add(entry.path.toLowerCase());const file=await assertNoLinks(path.join(directory,entry.path));assert.equal((await fs.stat(file)).size,entry.bytes);assert.equal(await fileDigest(file),entry.sha256,'Client snapshot checksum mismatch: '+entry.path);}
  return manifest;
}
