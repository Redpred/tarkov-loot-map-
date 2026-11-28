import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import * as THREE from 'three';
import {buildGeometryQuality} from '../build-geometry-quality.mjs';
import {verifyGeometryQuality,verifyMesh} from '../verify-geometry-quality.mjs';
import {simplifyGeometry,views,digest,bytesOf,manifestDigest} from '../lib/geometry-quality.mjs';
import {buildGeometryGroups} from '../../site/atlas-sectors.js';
import {loadGeometryQuality} from '../../site/atlas-geometry-quality.js';
import {selectedCacheQuality} from '../../site/atlas-map-cache.js';
import {createSiteServer} from '../lib/site-server.mjs';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';

function fixture(segments=24,materials=[{}, {role:'cutout'}, {vp:{layers:[]}}]){
  const geo=new THREE.PlaneGeometry(8,8,segments,segments),parts=[],meshes=[];let offset=0;
  const add=a=>{const start=offset,b=bytesOf(a);parts.push(b);offset+=b.length;return start;};
  for(let j=0;j<materials.length;j++){
    const p=geo.attributes.position.array,uv=geo.attributes.uv.array,paint=new Uint8Array(p.length/3*4);
    for(let i=0;i<paint.length;i+=4)paint.set([255,Math.round(uv[i/2]*255),0,255],i);
    meshes.push({name:`plane-${j}`,material:j,vertices:p.length/3,indices:geo.index.count,instances:1,rendererSources:['fixture'],sourceFaceStart:0,sourceFaceCount:geo.index.count/3,
      positionOffset:add(p),uvOffset:add(uv),paintOffset:add(paint),indexOffset:add(Uint32Array.from(geo.index.array)),matrixOffset:add(new Float32Array([2,0,0,3,0,1,0,2,0,0,-1,5])),boundsOffset:add(new Float32Array([-5,-2,5,11,6,5]))});
  }
  const raw=Buffer.concat(parts);return {raw,buffer:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),manifest:{schemaVersion:1,binary:'factory-geometry.bin',sha256:digest(raw),sceneSha256:'a'.repeat(64),bounds:{min:[-5,-2,5],max:[11,6,5]},materials,textures:{},meshes,stats:{bytes:raw.length,exportedInstances:meshes.length}}};
}
test('map and download plans use fixed geometry and textures with legacy preferences present',()=>{
  const before=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const values=new Map([['atlas-geometry-quality-v1','original'],['atlas-texture-quality-v1','low']]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)}});
  try{
    assert.deepEqual(selectedCacheQuality(),{geometry:'low',texture:'medium',scenery:'full'});
    values.set('atlas-scenery-details-v1','simple');
    assert.deepEqual(selectedCacheQuality(),{geometry:'low',texture:'medium',scenery:'simple'});
  }finally{if(before)Object.defineProperty(globalThis,'localStorage',before);else delete globalThis.localStorage;}
});
test('simplification preserves instance coordinates, material seams and cutout triangles; renderer accepts compact indices and omitted paint',async()=>{
  const f=fixture();
  for(const tier of ['medium','low']){
    const out=await simplifyGeometry(f.manifest,f.buffer,f.manifest.materials,tier),b=out.bytes.buffer.slice(out.bytes.byteOffset,out.bytes.byteOffset+out.bytes.length);
    assert.ok(out.bytes.length<f.raw.length);assert.ok(out.manifest.meshes[0].indices<f.manifest.meshes[0].indices);
    out.manifest.meshes.forEach((m,i)=>verifyMesh(f.manifest.meshes[i],m,views(f.manifest.meshes[i],f.buffer),views(m,b),f.manifest.materials[i],tier));
    const materials=new Map(f.manifest.materials.map((_,i)=>[i,new THREE.MeshBasicMaterial()])),groups=buildGeometryGroups(out.manifest,b,materials);
    assert.ok(groups[0].mesh.geometry.index.array instanceof Uint16Array);assert.equal(groups[0].mesh.geometry.getAttribute('paintWeight'),undefined);assert.ok(groups[2].mesh.geometry.getAttribute('paintWeight'));
    for(const g of groups){g.mesh.geometry.dispose();g.mesh.dispose();}for(const material of materials.values())material.dispose();
  }
});
test('large protected meshes retain 32-bit indices without overflow',async()=>{
  const f=fixture(260,[{role:'cutout'}]),out=await simplifyGeometry(f.manifest,f.buffer,f.manifest.materials,'low');
  assert.equal(out.manifest.meshes[0].vertices,261*261);assert.equal(out.manifest.meshes[0].indexComponentType,'uint32');assert.equal(out.manifest.meshes[0].indices,f.manifest.meshes[0].indices);
});
test('derived versions are source-bound, independently cached and served only through allowed JSON routes',async t=>{
  const work=path.resolve(import.meta.dirname,'../../work');await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'geometry-quality-test-')),site=path.join(root,'site'),snapshot=path.join(root,'snapshot'),out=path.join(root,'generated');
  t.after(async()=>{assert.equal(path.dirname(root),work);assert.ok(path.basename(root).startsWith('geometry-quality-test-'));await fs.rm(root,{recursive:true,force:true});});
  const map={id:'factory',geometry:'data/atlas/factory-geometry.json',textureBase:'data/atlas/',endpoint:'api/factory-geometry'},f=fixture();
  for(const base of [site,snapshot]){await fs.mkdir(path.join(base,'data/atlas'),{recursive:true});await fs.writeFile(path.join(base,map.geometry),JSON.stringify(f.manifest));await fs.writeFile(path.join(base,'data/atlas/factory-geometry.bin'),f.raw);}
  await buildGeometryQuality({siteRoot:site,snapshotRoot:snapshot,outRoot:out,maps:[map],onProgress(){}});
  await verifyGeometryQuality({siteRoot:site,snapshotRoot:snapshot,derivedRoot:out,maps:[map],onProgress(){}});
  await fs.cp(path.join(out,'geometry-quality'),path.join(site,'data/geometry-quality'),{recursive:true});await fs.cp(path.join(out,'runtime'),path.join(site,'data/runtime'),{recursive:true});
  const server=createSiteServer(site);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,fetcher=url=>fetch(new URL(url,base+'/'));
  const entries=new Map(),keys=[],cache={get:async(key,version)=>{keys.push(key);return entries.get(key+'|'+version);},put:async(key,version,blob)=>entries.set(key+'|'+version,blob),ticket:()=>1};
  for(const quality of ['original','low']){
    const chosen=await loadGeometryQuality(f.manifest,map,quality,{fetcher});assert.equal(chosen.quality,quality,chosen.reason);
    const endpoint=new URL(chosen.endpoint,base+'/').href;
    const bytes=await loadFactoryGeometry(chosen.manifest,()=>{},endpoint,undefined,cache);assert.equal(digest(new Uint8Array(bytes)),chosen.manifest.sha256);
    const query=new URLSearchParams({offset:0,length:32,version:chosen.manifest.sha256});
    const response=await fetch(endpoint+'?'+query);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);assert.match(response.headers.get('cache-control'),/immutable/);await response.arrayBuffer();
    const hit=await fetch(endpoint+'?'+query,{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(hit.status,304);
    const stale=await fetch(endpoint+'?'+new URLSearchParams({offset:0,length:32,version:'0'.repeat(64)}));assert.equal(stale.status,409);
  }
  assert.equal(new Set(keys.filter(key=>key.startsWith('geometry:'))).size,2);
  for(const route of ['/api/factory-geometry/ultra','/api/factory-geometry/medium/s_0_0','/api/unknown-geometry/low'])assert.equal((await fetch(base+route)).status,404);
  const changed={...f.manifest,manualCull:'updated'};const fallback=await loadGeometryQuality(changed,map,'low',{fetcher});assert.equal(fallback.quality,'original');assert.match(fallback.warning,/原始模型/);
  await fs.writeFile(path.join(site,map.geometry),JSON.stringify(changed));
  const derived=JSON.parse(await fs.readFile(path.join(site,'data/geometry-quality/factory/low/manifest.json')));
  assert.equal((await fetch(base+'/api/factory-geometry/low?'+new URLSearchParams({offset:0,length:32,version:derived.sha256}))).status,409);
});
