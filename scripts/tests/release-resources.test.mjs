import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createClientResourceStore} from '../../desktop/local-resources.mjs';
import {createReleasePackCache} from '../../desktop/release-pack-cache.mjs';
import {buildDesktopArchive} from '../desktop-archive.mjs';
import {buildReleaseResources} from '../desktop-release-resources.mjs';
import {verifyReleaseResources} from '../verify-desktop-release-resources.mjs';
import {archiveDigest as hash, ARCHIVE_CHUNK} from '../lib/desktop-resource-archive.mjs';
import {createReleaseResources, releaseDownloadUrl} from '../../desktop/release-resources.mjs';
const file = 'data/atlas/factory-geometry.json', route = 'api/factory-geometry';
async function fixture(t) {
  const work=path.resolve('work'); await fs.mkdir(work,{recursive:true});
  const directory=await fs.mkdtemp(path.join(work,'release-test-')), siteRoot=path.join(directory,'site'),archiveRoot=path.join(directory,'archive'),out=path.join(directory,'release');
  t.after(async()=>{assert.equal(path.dirname(directory),work);assert.ok(path.basename(directory).startsWith('release-test-'));await fs.rm(directory,{recursive:true,force:true});});
  await fs.mkdir(path.join(siteRoot,'data/atlas'),{recursive:true});
  const data=Buffer.alloc(ARCHIVE_CHUNK+19,39),version=hash(data),manifest=Buffer.from(JSON.stringify({sha256:version,stats:{bytes:data.length},meshes:[],materials:[],textures:{}}));
  await fs.writeFile(path.join(siteRoot,file),manifest);await fs.writeFile(path.join(siteRoot,'data/atlas/factory-geometry.bin'),data);
  const lock={schemaVersion:1,files:{[file]:[hash(manifest),manifest.length]},geometry:{[route]:[version,data.length]}};
  await buildDesktopArchive({siteRoot,archiveRoot,lock});
  const result=await buildReleaseResources({archiveRoot,lock,out,packLimit:64*1024});
  const calls=[];
  async function fetcher(url,init={}) {
    calls.push({url,headers:init.headers});assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');
    const name=path.basename(new URL(url).pathname),bytes=await fs.readFile(path.join(out,name));
    const match=/^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range || '');
    if(match){const start=Number(match[1]),end=Number(match[2]);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`}});}
    return new Response(bytes);
  }
  const options={release:result.descriptor,lock,cacheRoot:path.join(directory,'cache'),fetcher};
  return {directory,out,options,calls,manifest,data,version,result};
}
test('GitHub release ZIP ranges serve pinned metadata and model chunks; index survives offline restart',async t=>{
  const f=await fixture(t),service=createReleaseResources(f.options);
  const checked=await verifyReleaseResources({directory:f.out,lock:f.options.lock});assert.equal(checked.verified,true);assert.equal(checked.chunks,2);
  assert.deepEqual(await service.read(file,f.manifest.length),f.manifest);
  const bytes=await service.read(`${route}?offset=0&length=${ARCHIVE_CHUNK}&version=${f.version}`,Math.ceil(ARCHIVE_CHUNK/3)*4+1024);
  assert.deepEqual(Buffer.from(JSON.parse(bytes).data,'base64'),f.data.subarray(0,ARCHIVE_CHUNK));
  assert.equal(f.calls.filter(call=>call.url.endsWith('/resources-index.json')).length,1);
  assert.ok(f.calls.slice(1).every(call=>call.headers.Range));
  let indexRequests=0;
  const restored=createReleaseResources({...f.options,fetcher:(url,init)=>{if(url.endsWith('/resources-index.json')){indexRequests++;throw Error('index offline');}return f.options.fetcher(url,init);}});
  assert.deepEqual(await restored.read(file,f.manifest.length),f.manifest);assert.equal(indexRequests,0);
  assert.ok(f.result.packs<1000);
});
test('endpoints ignoring Range stream verified ZIPs to disk and reuse them across restart',async t=>{
  const f=await fixture(t);let packs=0;
  const options={...f.options,fetcher:async url=>{if(url.endsWith('.zip'))packs++;return new Response(await fs.readFile(path.join(f.out,path.basename(new URL(url).pathname))));}};
  const service=createReleaseResources(options);
  for(let i=0;i<2;i++)assert.deepEqual(await service.read(file,f.manifest.length),f.manifest);
  assert.deepEqual(await createReleaseResources(options).read(file,f.manifest.length),f.manifest);
  assert.equal(packs,1);
});
test('release redirects only reach exact GitHub asset hosts and preserve Range without credentials',async t=>{
  const f=await fixture(t);let redirected=0;
  const service=createReleaseResources({...f.options,fetcher:async(url,init)=>{
    if(new URL(url).hostname==='github.com')return new Response('',{status:302,headers:{location:'https://release-assets.githubusercontent.com/'+path.basename(new URL(url).pathname)}});
    redirected++;return f.options.fetcher(url,init);
  }});
  assert.deepEqual(await service.read(file,f.manifest.length),f.manifest);assert.equal(redirected,2);
  for(const url of ['http://github.com/x','https://github.com.evil/x','https://user@github.com/x','https://127.0.0.1/x','https://release-assets.githubusercontent.com.evil/x'])assert.equal(releaseDownloadUrl(url),false);
  const bad=createReleaseResources({...f.options,cacheRoot:path.join(f.directory,'other'),fetcher:async()=>new Response('',{status:302,headers:{location:'https://evil.invalid/private'}})});
  await assert.rejects(bad.read(file,f.manifest.length),/地址无效/);
});
test('wrong range, changed index/member, failed pack, and cancelled requests fail closed',async t=>{
  const f=await fixture(t);
  for(const mode of ['range','member','missing']){
    const service=createReleaseResources({...f.options,cacheRoot:path.join(f.directory,mode),fetcher:async(url,init)=>{
      if(url.endsWith('/resources-index.json'))return f.options.fetcher(url,init);
      if(mode==='missing')return new Response('',{status:404});
      const response=await f.options.fetcher(url,init);
      return new Response(mode==='member'?'bad':await response.arrayBuffer(),{status:206,headers:{'content-range':mode==='range'?'bytes 0-1/2':response.headers.get('content-range')}});
    }});
    await assert.rejects(service.read(file,f.manifest.length),mode==='range'?/范围响应/:mode==='member'?/内容校验/:/404/);
  }
  const changed=createReleaseResources({...f.options,cacheRoot:path.join(f.directory,'changed'),fetcher:async()=>new Response('{}')});
  await assert.rejects(changed.read(file,f.manifest.length),/索引校验/);
  const abort=new AbortController();abort.abort();await assert.rejects(createReleaseResources(f.options).read(file,f.manifest.length,abort.signal),{name:'AbortError'});
});
test('only an unpublished index permits legacy fallback and repeated 404 checks are bounded',async t=>{
  const f=await fixture(t);let requests=0;
  const service=createReleaseResources({...f.options,fetcher:async()=>{requests++;return new Response('',{status:404});}});
  assert.equal(await service.read(file,f.manifest.length),null);assert.equal(await service.read(file,f.manifest.length),null);assert.equal(requests,1);
  assert.throws(()=>createReleaseResources({...f.options,release:{...f.options.release,resourceLockId:'0'.repeat(64)}}),/版本配置/);
});
test('release validation catches changed ZIP bytes independently of the build output',async t=>{
  const f=await fixture(t),index=JSON.parse(await fs.readFile(path.join(f.out,'resources-index.json'),'utf8'));
  const file=path.join(f.out,index.packs[0].name),bytes=await fs.readFile(file);bytes[100]^=1;await fs.writeFile(file,bytes);
  await assert.rejects(verifyReleaseResources({directory:f.out,lock:f.options.lock}));
});

test('manually extracted gzip chunks combine with installed chunks, remain compressed, and bind to the whole model',async t=>{
  const f=await fixture(t),root=path.join(f.directory,'map-resources'),store=createClientResourceStore(root);
  assert.equal((await store.status()).available,true);
  await store.putChunk(f.version,0,f.data.subarray(0,ARCHIVE_CHUNK),f.data.length);
  const offset=ARCHIVE_CHUNK,body=f.data.subarray(offset),dir=path.join(root,'chunks',f.version);
  await fs.mkdir(dir,{recursive:true});
  const chunkFile=path.join(dir,`${offset}-${body.length}.gz`);
  const write=async bytes=>fs.writeFile(chunkFile,gzipSync(JSON.stringify({offset,total:f.data.length,encoding:'base64',data:bytes.toString('base64'),sha256:hash(bytes)})));
  await write(body);
  assert.deepEqual(await store.getChunk(f.version,offset,body.length,f.data.length),body);
  await assert.rejects(fs.stat(path.join(root,'models',f.version,`${offset}-${body.length}`)),{code:'ENOENT'});
  await write(Buffer.alloc(body.length,17)); // Internally valid, but wrong complete-model hash.
  assert.equal(await createClientResourceStore(root).getChunk(f.version,offset,body.length,f.data.length),null);
  await fs.writeFile(chunkFile,'broken gzip');
  assert.equal(await createClientResourceStore(root).getChunk(f.version,offset,body.length,f.data.length),null);
});

test('large fallback streams with bounded storage and rejects corruption, truncation, overflow and cancellation',async t=>{
  const f=await fixture(t),root=path.join(f.directory,'large-cache'),cache=createReleasePackCache(root);
  const block=Buffer.alloc(1024*1024,61),blocks=70,digest=createHash('sha256');
  for(let i=0;i<blocks;i++)digest.update(block);
  const pack={bytes:blocks*block.length,sha256:digest.digest('hex')};
  function response(count,corrupt=false,abort) {let i=0;return new Response(new ReadableStream({pull(controller){if(i===count){controller.close();return;}if(abort&&i===2)abort.abort();controller.enqueue(corrupt&&i===0?Buffer.alloc(block.length,62):block);i++;}}));}
  const offset=pack.bytes-7;
  assert.deepEqual(await cache.read(pack,offset,7,response(blocks)),block.subarray(0,7));
  assert.deepEqual(await createReleasePackCache(root).read(pack,offset,7),block.subarray(0,7));
  assert.equal((await fs.readdir(path.join(root,'release-packs'))).length,1);
  // A second pack evicts the previous fallback file, including on failure.
  const bad={...pack,sha256:'b'.repeat(64)};
  for(const [count,corrupt] of [[blocks,true],[blocks-1,false],[blocks+1,false]]){
    await assert.rejects(cache.read(bad,0,7,response(count,corrupt)),/校验失败|预期大小/);
    assert.deepEqual(await fs.readdir(path.join(root,'release-packs')),[]);
  }
  const abort=new AbortController();
  await assert.rejects(cache.read(bad,0,7,response(blocks,false,abort),abort.signal),{name:'AbortError'});
  assert.deepEqual(await fs.readdir(path.join(root,'release-packs')),[]);
});
