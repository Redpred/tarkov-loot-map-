import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {ARCHIVE_CHUNK, archiveId, archiveDigest as hash, validateArchiveLock} from './lib/desktop-resource-archive.mjs';
const decompress=promisify(gunzip);

export async function verifyReleaseResources({directory, lock, onProgress=()=>{}}) {
  validateArchiveLock(lock);
  const descriptor=JSON.parse(await fs.readFile(path.join(directory,'resource-release.json'),'utf8'));
  const bytes=await fs.readFile(path.join(directory,'resources-index.json'));
  assert.equal(descriptor.resourceLockId,archiveId(lock));assert.equal(bytes.length,descriptor.index.bytes);assert.equal(hash(bytes),descriptor.index.sha256);
  const index=JSON.parse(bytes);assert.equal(index.schemaVersion,1);assert.equal(index.resourceLockId,descriptor.resourceLockId);assert.ok(index.packs.length<=950);
  const names=new Set();let totalBytes=0;
  for (const pack of index.packs) {
    assert.match(pack.name,/^resources-[a-z0-9_-]+\.zip$/);assert.equal(names.has(pack.name),false);names.add(pack.name);
    assert.ok(Number.isSafeInteger(pack.bytes)&&pack.bytes>0&&pack.bytes<=1900*2**20);assert.match(pack.sha256,/^[a-f0-9]{64}$/);
    const file=path.join(directory,pack.name);assert.equal((await fs.stat(file)).size,pack.bytes);
    const digest=createHash('sha256');for await(const part of createReadStream(file))digest.update(part);assert.equal(digest.digest('hex'),pack.sha256,pack.name);
    totalBytes+=pack.bytes;
  }
  const handles=new Map();
  async function member(entry) {
    assert.ok(Array.isArray(entry)&&entry.length===4);
    const [id,offset,length,digest]=entry,pack=index.packs[id];
    assert.ok(Number.isSafeInteger(id)&&id>=0&&pack&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>0&&offset+length<=pack.bytes);assert.match(digest,/^[a-f0-9]{64}$/);
    if(!handles.has(id))handles.set(id,await fs.open(path.join(directory,pack.name),'r'));
    const file=handles.get(id),data=Buffer.allocUnsafe(length);let read=0;
    while(read<length){const {bytesRead}=await file.read(data,read,length-read,offset+read);assert.ok(bytesRead>0);read+=bytesRead;}
    assert.equal(hash(data),digest);return data;
  }
  const files=new Map(Object.values(lock.files).map(entry=>[entry[0],entry[1]])),geometry=new Map(Object.values(lock.geometry).map(entry=>[entry[0],entry[1]]));
  assert.deepEqual(Object.keys(index.objects).sort(),[...files.keys()].sort());
  let objects=0,models=0,chunks=0;
  try {
    for(const [version,size] of files){const data=await member(index.objects[version]);assert.equal(data.length,size);assert.equal(hash(data),version);onProgress({phase:'objects',completed:++objects,total:files.size});}
    for(const [version,size] of geometry){
      const digest=createHash('sha256');
      for(let offset=0;offset<size;offset+=ARCHIVE_CHUNK){
        const length=Math.min(ARCHIVE_CHUNK,size-offset),key=`${version}/${offset}-${length}`;
        const data=JSON.parse(await decompress(await member(index.chunks[key]),{maxOutputLength:Math.ceil(length/3)*4+1024}));
        assert.equal(data.offset,offset);assert.equal(data.total,size);assert.equal(data.encoding,'base64');
        const decoded=Buffer.from(data.data,'base64');assert.equal(decoded.length,length);assert.equal(hash(decoded),data.sha256);digest.update(decoded);chunks++;
      }
      assert.equal(digest.digest('hex'),version);onProgress({phase:'models',completed:++models,total:geometry.size});
    }
    assert.equal(Object.keys(index.chunks).length,chunks);
  } finally { await Promise.all([...handles.values()].map(handle=>handle.close())); }
  return {resourceLockId:descriptor.resourceLockId,packs:index.packs.length,bytes:totalBytes,objects,models,chunks,verified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),read=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const lock=JSON.parse(await fs.readFile(path.resolve(read('--lock',path.join(root,'desktop/resources.lock.json'))),'utf8'));
  const release=JSON.parse(await fs.readFile(path.resolve(read('--release',path.join(root,'desktop/resource-release.json'))),'utf8'));
  let last=0;console.log(JSON.stringify(await verifyReleaseResources({lock,directory:path.resolve(read('--directory',path.join(root,'dist',release.tag))),onProgress:value=>{if(Date.now()-last>15000){console.log(JSON.stringify(value));last=Date.now();}}})));
}
