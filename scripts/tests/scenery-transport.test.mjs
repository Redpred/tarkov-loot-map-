import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createSiteServer,MAX_GEOMETRY_CHUNK} from '../lib/site-server.mjs';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {cacheOwner} from '../../site/atlas-cache-identity.js';
import {makeMapCachePlan,createMapCacheReader,summarizeMapCache,cacheQualityText} from '../../site/atlas-map-cache.js';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=value=>digest(JSON.stringify(value));
const json=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
const spans=[[0,0,8],[8,20,12],[20,48,16]],tiers=['original','medium','low'];
const bounds={min:[0,0,0],max:[10,10,10]};
const sourceBase={sceneSha256:'a'.repeat(64),bounds,materials:[{tex:'wall'},{tex:'litter'},{tex:'glass',emis:'wall'}],textures:Object.fromEntries(['wall','litter','glass'].map((name,i)=>[name,{file:`textures/${name}.webp`,sha256:String(i+1).repeat(64),bytes:10+i}]))};

async function fixture(t){
  const work=path.resolve(import.meta.dirname,'../../work');await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'scenery-transport-'));
  const records=new Map();
  for(const map of [ATLAS_MAPS.factory,ATLAS_MAPS.streets]){
    const makeSource=tier=>{
      const raw=Buffer.from(Array.from({length:64},(_,i)=>i+tiers.indexOf(tier))),detail={...sourceBase,sha256:digest(raw),stats:{bytes:64},meshes:[{material:0},{material:1},{material:2}],materialIds:[0,1,2]};
      const manifest=map.streamed?{...sourceBase,stats:{sectorBytes:128},sectors:[{...detail,id:'s_0_0',file:'sectors/s_0_0.json'},{...detail,id:'s_1_0',file:'sectors/s_1_0.json'}]}:detail;
      return {raw,manifest};
    };
    const original=makeSource('original'),qualityCatalog={schemaVersion:1,mapId:map.id,sourceManifestSha256:fingerprint(original.manifest),variants:{}},catalog={schemaVersion:1,recipeVersion:1,mapId:map.id,sceneSha256:sourceBase.sceneSha256,sourceManifestSha256:fingerprint(original.manifest),variants:{}};
    for(const tier of tiers){
      const source=tier==='original'?original:makeSource(tier),sourceDirectory=tier==='original'?path.dirname(map.geometry):`data/geometry-quality/${map.id}/${tier}`;
      if(tier!=='original')source.manifest.geometryQuality={quality:tier,sourceManifestSha256:fingerprint(original.manifest)};
      const sourceFile=tier==='original'?map.geometry:`${sourceDirectory}/manifest.json`;
      await json(path.join(root,sourceFile),source.manifest);
      if(tier!=='original')qualityCatalog.variants[tier]={file:`${tier}/manifest.json`,manifestSha256:fingerprint(source.manifest)};
      const derivedDirectory=`data/scenery-details/${map.id}/${tier}`,runtime={geometry:{}},selected=[],details=[];
      const sourceRecords=map.streamed?source.manifest.sectors:[source.manifest];
      for(const [i,record] of sourceRecords.entries()){
        const bytes=i?source.raw:Buffer.concat(spans.map(([,offset,size])=>source.raw.subarray(offset,offset+size))),retained=i?[[0,0,64]]:spans;
        const derived={...record,sha256:digest(bytes),stats:{bytes:bytes.length},meshes:i?record.meshes:record.meshes.filter(m=>m.material!==1),materialIds:i?[0,1,2]:[0,2],decorationFilter:{recipeVersion:1,sourceManifestSha256:fingerprint(source.manifest),sourceGeometrySha256:record.sha256,sourceBytes:64,removedMeshes:i?0:1,spans:retained}};
        const id=map.streamed?record.id:'whole',binary=map.streamed?`${sourceDirectory}/sectors/${id}.bin`:`${sourceDirectory}/${tier==='original'?'factory-geometry':'model'}.bin`;
        await fs.mkdir(path.dirname(path.join(root,binary)),{recursive:true});await fs.writeFile(path.join(root,binary),source.raw);
        runtime.geometry[id]={manifestSha256:fingerprint(derived)};
        const file=map.streamed?`${derivedDirectory}/sectors/${id}.json`:`${derivedDirectory}/manifest.json`;
        await json(path.join(root,file),derived);details.push({derived,bytes,binary,file});
        const {meshes,decorationFilter,...index}=derived;selected.push({...index,decorationFilter:{...decorationFilter,spans:undefined}});
      }
      const manifest=map.streamed?{...source.manifest,sectors:selected,decorationFilter:{recipeVersion:1,sourceManifestSha256:fingerprint(source.manifest)}}:details[0].derived;
      const file=`${derivedDirectory}/manifest.json`;await json(path.join(root,file),manifest);
      catalog.variants[tier]={file:`${tier}/manifest.json`,sourceManifestSha256:fingerprint(source.manifest),manifestSha256:fingerprint(manifest),runtime};
      records.set(`${map.id}:${tier}`,{map,tier,source,sourceFile,manifest,file,details,catalog});
    }
    await json(path.join(root,`data/geometry-quality/${map.id}/manifest.json`),qualityCatalog);
    await json(path.join(root,`data/scenery-details/${map.id}/manifest.json`),catalog);
  }
  const server=createSiteServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(root)),work);assert.ok(path.basename(root).startsWith('scenery-transport-'));await fs.rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const endpoint=(record,i=0)=>`${base}/${record.map.endpoint}${record.tier==='original'?'':'/'+record.tier}/simple${record.map.streamed?'/'+record.details[i].derived.id:''}`;
  const url=(record,values={},i=0)=>endpoint(record,i)+'?'+new URLSearchParams({offset:0,length:32,version:record.details[i].derived.sha256,...values});
  return {root,records,base,endpoint,url};
}

test('filtered JSON transport reads fragmented original ranges at every model tier and preserves unchanged endpoints',async t=>{
  const f=await fixture(t);
  for(const record of f.records.values()){
    const response=await fetch(f.url(record,{offset:6,length:26}),{headers:{'accept-encoding':'gzip'}});
    assert.equal(response.status,200,`${record.map.id}/${record.tier}`);assert.equal(response.headers.get('content-encoding'),'gzip');
    assert.match(response.headers.get('content-type'),/application\/json/);assert.equal(response.headers.get('content-disposition'),'inline');assert.match(response.headers.get('cache-control'),/immutable/);
    const chunk=await response.json();assert.equal(chunk.total,36);assert.deepEqual(Buffer.from(chunk.data,'base64'),record.details[0].bytes.subarray(6,32));
    const unchanged=await fetch(f.url(record,{offset:6,length:26}),{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(unchanged.status,304);
    const tail=await fetch(f.url(record,{offset:32,length:32}));assert.deepEqual(Buffer.from((await tail.json()).data,'base64'),record.details[0].bytes.subarray(32));
    const original=await fetch(f.url(record).replace('/simple','').replace(record.details[0].derived.sha256,record.source.manifest.sectors?.[0].sha256||record.source.manifest.sha256));
    assert.equal(original.status,200);assert.deepEqual(Buffer.from((await original.json()).data,'base64'),record.source.raw.subarray(0,32));
    const full=await loadFactoryGeometry(record.details[0].derived,()=>{},f.endpoint(record));assert.deepEqual(Buffer.from(full),record.details[0].bytes);
    if(record.map.streamed){const data=await loadFactoryGeometry(record.details[1].derived,()=>{},f.endpoint(record,1));assert.deepEqual(Buffer.from(data),record.source.raw);}
  }
});

test('filtered transport rejects stale metadata, invalid ranges and missing sectors without serving source bytes',async t=>{
  const f=await fixture(t),r=f.records.get('factory:medium');
  for(const values of [{offset:-1},{offset:'NaN'},{length:0},{length:MAX_GEOMETRY_CHUNK+1},{version:'x'}])assert.equal((await fetch(f.url(r,values))).status,400);
  assert.equal((await fetch(f.url(r,{offset:36}))).status,416);assert.equal((await fetch(f.url(r,{version:'0'.repeat(64)}))).status,409);
  assert.equal((await fetch(f.url(r),{method:'POST'})).status,405);
  for(const route of ['/api/factory-geometry/simple/s_0_0','/api/streets-geometry/simple','/api/streets-geometry/simple/s_9_9','/api/factory-geometry/simple/medium','/api/unknown-geometry/simple'])assert.equal((await fetch(f.base+route+'?'+new URLSearchParams({offset:0,length:16,version:r.details[0].derived.sha256}))).status,404);
  await json(path.join(f.root,r.sourceFile),{...r.source.manifest,changedSource:true});assert.equal((await fetch(f.url(r))).status,409);
  await json(path.join(f.root,r.sourceFile),r.source.manifest);
  const catalogFile=path.join(f.root,'data/scenery-details/factory/manifest.json'),saved=structuredClone(r.catalog);
  r.catalog.variants.medium.sourceManifestSha256='f'.repeat(64);await json(catalogFile,r.catalog);assert.equal((await fetch(f.url(r))).status,409);
  await json(catalogFile,saved);
  await json(path.join(f.root,r.file),{...r.manifest,changedDerived:true});assert.equal((await fetch(f.url(r))).status,409);
  await json(path.join(f.root,r.file),r.manifest);
  await fs.truncate(path.join(f.root,r.details[0].binary),60);const truncated=await fetch(f.url(r));assert.equal(truncated.status,503);assert.match((await truncated.json()).error,/重建/);
});

test('filtered details require valid source hashes and complete ordered spans even with matching catalog fingerprints',async t=>{
  const f=await fixture(t),r=f.records.get('streets:original'),catalogFile=path.join(f.root,'data/scenery-details/streets/manifest.json');
  for(const [changes,status] of [[{sourceGeometrySha256:'b'.repeat(64)},409],[{sourceBytes:63},409],[{spans:[[0,0,8],[9,20,12],[20,48,16]]},503],[{spans:[[0,0,36],[36,63,1]]},503]]){
    const changed=structuredClone(r.details[0].derived);Object.assign(changed.decorationFilter,changes);
    const catalog=structuredClone(r.catalog);catalog.variants.original.runtime.geometry.s_0_0.manifestSha256=fingerprint(changed);
    await json(path.join(f.root,r.details[0].file),changed);await json(catalogFile,catalog);
    assert.equal((await fetch(f.url(r))).status,status,JSON.stringify(changes));
  }
});

test('source binary changes invalidate compressed responses and final client integrity checks still reject corruption',async t=>{
  const f=await fixture(t),r=f.records.get('factory:original'),response=await fetch(f.url(r));assert.equal(response.status,200);await response.arrayBuffer();
  const file=await fs.open(path.join(f.root,r.details[0].binary),'r+');await file.write(Buffer.from([255]),0,1,0);await file.close();
  const changed=await fetch(f.url(r),{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),response.headers.get('etag'));assert.equal(Buffer.from((await changed.json()).data,'base64')[0],255);
  await assert.rejects(loadFactoryGeometry(r.details[0].derived,()=>{},f.endpoint(r)),/完整性校验失败/);
});

test('cache plans separate scenery variants, reuse unchanged sectors and only include retained material textures',async t=>{
  const f=await fixture(t),query='geometry=original&texture=original',url=`${f.base}/api/cache-plan/factory?${query}`;
  const explicitFull=await (await fetch(url+'&scenery=full')).json();assert.equal(explicitFull.quality.scenery,'full');
  const full=await (await fetch(url)).json();assert.deepEqual(full.quality,{geometry:'original',texture:'original'});assert.equal(full.texture.length,3);
  const response=await fetch(url+'&scenery=simple'),simple=await response.json();assert.equal(response.status,200);assert.equal(simple.quality.scenery,'simple');assert.equal(simple.texture.length,2);assert.ok(simple.texture.every(([id])=>!id.includes('litter')));assert.match(simple.geometry[0][0],/\/simple$/);assert.equal(simple.geometry[0][2],36);
  assert.equal((await fetch(url+'&scenery=simple',{headers:{'if-none-match':response.headers.get('etag')}})).status,304);
  const originalRows=[...full.geometry,...full.texture].map(([identity,version,bytes])=>({identity,version,bytes,...cacheOwner(identity)}));assert.equal(summarizeMapCache('factory',originalRows,simple).state,'partial');
  const r=f.records.get('streets:low'),streamed=makeMapCachePlan(r.map,r.manifest,r.source.manifest,{geometry:'low',texture:'original',scenery:'simple'});
  assert.equal(streamed.geometry[0][0],'geometry:/api/streets-geometry/low/simple/s_0_0');assert.equal(streamed.geometry[1][0],'geometry:/api/streets-geometry/low/s_1_0');
  for(const row of streamed.geometry)assert.deepEqual(cacheOwner(row[0]),{mapId:'streets',kind:'geometry',quality:'low'});
  assert.deepEqual(cacheOwner('geometry:/api/factory-geometry/simple'),{mapId:'factory',kind:'geometry',quality:'original'});
  for(const extra of ['&scenery=wrong','&scenery=','&scenery=simple&scenery=full','&extra=full'])assert.equal((await fetch(url+extra)).status,400);
  const file=path.join(f.root,f.records.get('factory:original').file),manifest=f.records.get('factory:original').manifest;
  await json(file,{...manifest,changed:true});assert.equal((await fetch(url+'&scenery=simple')).status,503,'selected manifest changes invalidate the cached plan');
  await json(file,manifest);assert.equal((await fetch(url+'&scenery=simple')).status,200);
  const catalog=structuredClone(f.records.get('factory:original').catalog);catalog.variants.original.sourceManifestSha256='b'.repeat(64);await json(path.join(f.root,'data/scenery-details/factory/manifest.json'),catalog);
  assert.equal((await fetch(url+'&scenery=simple')).status,503,'catalog changes invalidate the cached plan');assert.equal((await fetch(url)).status,200,'full plans remain independent');
});

test('browser cache readers keep full and simple plan reuse separate and reject the wrong scenery response',async()=>{
  const map=ATLAS_MAPS.factory,geometry={...sourceBase,sha256:'d'.repeat(64),stats:{bytes:36},meshes:[{material:0}]},fullQuality={geometry:'original',texture:'original',scenery:'full'},simpleQuality={...fullQuality,scenery:'simple'};
  const full=makeMapCachePlan(map,geometry,geometry,fullQuality),simple=makeMapCachePlan(map,geometry,geometry,simpleQuality),records=[...simple.geometry,...simple.texture].map(([identity,version,bytes])=>({identity,version,bytes,...cacheOwner(identity)}));
  let calls=0,wrong=false;
  const reader=createMapCacheReader({cache:{inventory:async()=>({available:true,records})},fetcher:async url=>{calls++;return Response.json(wrong?full:url.includes('scenery=simple')?simple:full);}});
  assert.equal((await reader.read(simpleQuality)).maps[0].state,'complete');assert.equal((await reader.read(fullQuality)).maps[0].state,'partial');assert.equal(calls,2);
  await reader.read(simpleQuality);assert.equal(calls,2);reader.invalidate();wrong=true;
  assert.equal((await reader.read(simpleQuality)).maps[0].state,'unknown');assert.match(cacheQualityText(simpleQuality),/装饰精简/);assert.match(cacheQualityText(fullQuality),/装饰保留/);
});
