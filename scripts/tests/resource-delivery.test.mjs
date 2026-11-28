import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {IDBFactory} from 'fake-indexeddb';
import {createResourceCache} from '../../site/atlas-resource-cache.js';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';
import {summarizeMapCache} from '../../site/atlas-map-cache.js';
import {buildResourceDelivery} from '../build-resource-delivery.mjs';
import {createSiteServer} from '../lib/site-server.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),chunkSize=4*2**20;
function cacheFixture(t){const cache=createResourceCache({indexedDB:new IDBFactory(),preferences:{getItem:()=>null}});t.after(()=>cache.close());return cache;}

test('interrupted model loading resumes verified chunks after reopening; map cleanup also removes partial data',async t=>{
  const indexedDB=new IDBFactory(),options={indexedDB,preferences:{getItem:()=>null}};let cache=createResourceCache(options);t.after(()=>cache.close());
  const data=Buffer.alloc(chunkSize*3+71,19),manifest={sha256:hash(data),stats:{bytes:data.length}},previous=globalThis.fetch;
  const first=new AbortController();let interrupt=true,calls=[];
  globalThis.fetch=async(url,{signal})=>{
    const query=new URL(url,'http://localhost').searchParams,offset=Number(query.get('offset')),length=Number(query.get('length'));calls.push(offset);
    if(interrupt&&offset>0)return new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    const bytes=data.subarray(offset,offset+length);return Response.json({offset,total:data.length,encoding:'base64',sha256:hash(bytes),data:bytes.toString('base64')});
  };
  t.after(()=>{globalThis.fetch=previous;});
  await assert.rejects(loadFactoryGeometry(manifest,done=>{if(done>0)first.abort();},'api/factory-geometry',first.signal,cache),{name:'AbortError'});
  const inventory=await cache.inventory();assert.equal(inventory.records.length,1);assert.equal(inventory.records[0].mapId,'factory');assert.equal(inventory.records[0].kind,'partial');
  const summary=summarizeMapCache('factory',inventory.records,{geometry:[['geometry:/api/factory-geometry',manifest.sha256,data.length]],texture:[]});assert.equal(summary.state,'partial');assert.ok(summary.percent>0&&summary.percent<100);
  await cache.close();cache=createResourceCache(options);
  interrupt=false;calls=[];assert.deepEqual(Buffer.from(await loadFactoryGeometry(manifest,()=>{},'api/factory-geometry',undefined,cache)),data);
  assert.ok(!calls.includes(0));assert.equal((await cache.stats()).resumedBytes,chunkSize);assert.equal((await cache.inventory()).records.length,1);
  const identity='geometry-chunk:/api/factory-geometry:0:4',ticket=cache.ticket(identity);await cache.clearMap('factory');
  assert.equal(await cache.put(identity,manifest.sha256,new Blob(['late']),ticket),false);assert.equal((await cache.stats()).count,0);
});

test('a bad chunk checksum never enters the resumable store and a bad final checksum removes partials',async t=>{
  const cache=cacheFixture(t),previous=globalThis.fetch,data=Buffer.from('data'),manifest={sha256:hash(data),stats:{bytes:data.length}};
  t.after(()=>{globalThis.fetch=previous;});
  globalThis.fetch=async()=>Response.json({offset:0,total:4,encoding:'base64',sha256:'0'.repeat(64),data:data.toString('base64')});
  await assert.rejects(loadFactoryGeometry(manifest,()=>{},'api/factory-geometry',undefined,cache),/分块校验失败/);assert.equal((await cache.stats()).count,0);
  const wrong=Buffer.from('oops');globalThis.fetch=async()=>Response.json({offset:0,total:4,encoding:'base64',sha256:hash(wrong),data:wrong.toString('base64')});
  await assert.rejects(loadFactoryGeometry(manifest,()=>{},'api/factory-geometry',undefined,cache),/完整性校验失败/);assert.equal((await cache.stats()).count,0);
});

test('prepared delivery bypasses source reads, supports gzip/identity/ETag and preserves fallback validation; ZIPs resume',async t=>{
  const work=path.resolve('work'),directory=await fs.mkdtemp(path.join(work,'delivery-test-')),root=path.join(directory,'site'),out=path.join(directory,'prepared');
  t.after(async()=>{assert.equal(path.dirname(directory),work);assert.ok(path.basename(directory).startsWith('delivery-test-'));await fs.rm(directory,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'data/atlas'),{recursive:true});
  const data=Buffer.alloc(chunkSize+23,42),manifest={stats:{bytes:data.length},sha256:hash(data),meshes:[],materials:[],textures:{}};
  const sourceManifestSha256=hash(JSON.stringify(manifest));
  await fs.writeFile(path.join(root,'data/atlas/factory-geometry.json'),JSON.stringify(manifest));
  const geometry=path.join(root,'data/geometry-quality/factory'),texture=path.join(root,'data/model-quality/factory');
  await fs.mkdir(path.join(geometry,'low'),{recursive:true});await fs.mkdir(texture,{recursive:true});
  const selected={...manifest,geometryQuality:{quality:'low',sourceManifestSha256}};
  const binary=path.join(geometry,'low/model.bin');await fs.writeFile(binary,data);
  await fs.writeFile(path.join(geometry,'low/manifest.json'),JSON.stringify(selected));
  await fs.writeFile(path.join(geometry,'manifest.json'),JSON.stringify({schemaVersion:1,mapId:'factory',sourceManifestSha256,variants:{low:{file:'low/manifest.json',manifestSha256:hash(JSON.stringify(selected))}}}));
  await fs.writeFile(path.join(texture,'manifest.json'),JSON.stringify({schemaVersion:1,mapId:'factory',sourceManifestSha256,variants:{medium:{textures:{}}}}));
  await assert.rejects(buildResourceDelivery({root,out,mapIds:['factory'],quality:{geometry:'original',texture:'original',scenery:'full'}}),/128/);
  const catalog=await buildResourceDelivery({root,out,mapIds:['factory'],zip:false,onProgress(){}});
  assert.equal(catalog.packs[0].resourceBytes,data.length);
  await fs.cp(out,path.join(root,'data/resource-delivery'),{recursive:true});await fs.rename(binary,binary+'.saved');
  const pack=Buffer.from('sample archive bytes'),packHash=hash(pack);await fs.writeFile(path.join(root,'data/resource-delivery/packs',packHash+'.zip'),pack);
  const server=createSiteServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/factory-geometry/low?'+new URLSearchParams({offset:0,length:chunkSize,version:manifest.sha256});
  for(const encoding of ['gzip','identity']){const response=await fetch(url,{headers:{'accept-encoding':encoding}});assert.equal(response.status,200);assert.equal(response.headers.get('x-resource-delivery'),'prepared');assert.deepEqual(Buffer.from((await response.json()).data,'base64'),data.subarray(0,chunkSize));assert.equal((await fetch(url,{headers:{'if-none-match':response.headers.get('etag'),'accept-encoding':encoding}})).status,304);}
  assert.equal((await fetch(url.replace(manifest.sha256,'a'.repeat(64)))).status,409);
  assert.equal((await fetch(base+'/data/resource-delivery/_bundles/anything')).status,404);
  assert.equal((await fetch(base+'/data/%72esource-delivery/catalog.json')).status,200);
  assert.equal((await fetch(base+'/data/%72esource-delivery/packs/'+packHash+'.zip')).status,404);
  const download=base+'/resource-packs/'+packHash+'.zip',range=await fetch(download,{headers:{range:'bytes=7-13'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),pack.subarray(7,14));
  assert.equal((await fetch(download,{headers:{range:'bytes=999-1000'}})).status,416);
  assert.equal((await fetch(download,{method:'HEAD'})).headers.get('content-length'),String(pack.length));
  await fs.rename(binary+'.saved',binary);const fallback=await fetch(url.replace('length='+chunkSize,'length=19'));assert.equal(fallback.headers.get('x-resource-delivery'),null);assert.equal((await fallback.json()).sha256,hash(data.subarray(0,19)));
});
