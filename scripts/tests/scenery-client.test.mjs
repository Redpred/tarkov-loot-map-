import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../lib/geometry-quality.mjs';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';
import {SCENERY_DETAILS_KEY,readSceneryMode,saveSceneryMode} from '../../site/atlas-scenery-details.js';
import {createTextureSettings} from '../../site/atlas-texture-settings.js';
import * as THREE from 'three';
import {createSectorStreamer} from '../../site/atlas-sectors.js';

test('full scenery is default; the checkbox applies globally with qualities and editor preserves the preference',()=>{
  const before={localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),location:Object.getOwnPropertyDescriptor(globalThis,'location')};
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let reloads=0;
  assert.equal(readSceneryMode(storage),'full');assert.ok(saveSceneryMode('simple',storage));assert.equal(readSceneryMode(storage),'simple');
  values.set(SCENERY_DETAILS_KEY,'invalid');assert.equal(readSceneryMode(storage),'full');
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};assert.equal(readSceneryMode(blocked),'full');assert.equal(saveSceneryMode('simple',blocked),false);
  values.clear();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>reloads++}});
  try{
    const nodes=Object.fromEntries(['textureQuality','textureQualityStatus','geometryQuality','geometryQualityStatus','applyTextureQuality','loadSceneryDetails','sceneryDetailsStatus'].map(id=>['#'+id,{}]));
    const ui=createTextureSettings({querySelector:id=>nodes[id]});assert.equal(nodes['#loadSceneryDetails'].checked,true);assert.equal(nodes['#applyTextureQuality'].hidden,true);
    nodes['#loadSceneryDetails'].checked=false;nodes['#loadSceneryDetails'].onchange();assert.equal(nodes['#applyTextureQuality'].hidden,false);
    nodes['#applyTextureQuality'].onclick();assert.equal(values.get(SCENERY_DETAILS_KEY),'simple');assert.equal(reloads,1);
    ui.sceneryLoaded({scenery:'full',locked:true});ui.reset();assert.equal(nodes['#loadSceneryDetails'].checked,true);assert.equal(nodes['#loadSceneryDetails'].disabled,true);
    nodes['#applyTextureQuality'].onclick();assert.equal(values.get(SCENERY_DETAILS_KEY),'simple');
  }finally{for(const [key,desc] of Object.entries(before)){if(desc)Object.defineProperty(globalThis,key,desc);else delete globalThis[key];}}
});

function fixture(){
  const source=Buffer.from('ABCDEFGHIJKL'),derived=Buffer.from('ABGHIJKL'),version=digest(source),target=digest(derived),identity='geometry:/api/factory-geometry/medium';
  const rows=new Map([[identity+'|'+version,new Blob([source])]]),requests=[],writes=[];
  return {source,derived,identity,version,rows,requests,writes,manifest:{sha256:target,stats:{bytes:8},decorationFilter:{sourceGeometrySha256:version,sourceBytes:12,removedMeshes:1,spans:[[0,0,2],[2,6,6]]}},cache:{ticket:()=>0,enabled:()=>true,get:async(k,v)=>{requests.push(k);return rows.get(k+'|'+v);},put:async(k,v,b)=>{writes.push(k);rows.set(k+'|'+v,b);},remove:async(k,v)=>rows.delete(k+'|'+v)}};
}
test('simple scene reconstructs from a verified full cached model without fetching and then reuses its own cache',async()=>{
  const f=fixture(),old=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network');};
  try{
    const bytes=await loadFactoryGeometry(f.manifest,()=>{},'/api/factory-geometry/medium/simple',undefined,f.cache);assert.deepEqual(Buffer.from(bytes),f.derived);
    assert.equal(f.writes.length,1);assert.equal(f.writes[0],f.identity+'/simple');assert.ok(f.rows.has(f.identity+'|'+f.version));
    f.requests.length=0;await loadFactoryGeometry(f.manifest,()=>{},'/api/factory-geometry/medium/simple',undefined,f.cache);assert.deepEqual(f.requests,[f.identity+'/simple']);
  }finally{globalThis.fetch=old;}
});
test('unchanged sectors use the original cache key; abort cannot evict verified source cache',async()=>{
  const f=fixture(),unchanged={sha256:f.version,stats:{bytes:12},decorationFilter:{removedMeshes:0}};
  assert.deepEqual(Buffer.from(await loadFactoryGeometry(unchanged,()=>{},'/api/factory-geometry/medium/simple',undefined,f.cache)),f.source);assert.deepEqual(f.requests,[f.identity]);
  const controller=new AbortController(),get=f.cache.get;f.cache.get=async(k,v)=>{const r=await get(k,v);if(k===f.identity)controller.abort();return r;};
  await assert.rejects(loadFactoryGeometry(f.manifest,()=>{},'/api/factory-geometry/medium/simple',controller.signal,f.cache),{name:'AbortError'});assert.ok(f.rows.has(f.identity+'|'+f.version));assert.equal(f.writes.length,0);
});
test('invalid retained ranges never persist a corrupted derived cache',async()=>{
  for(const spans of [[[1,0,2],[2,6,6]],[[0,0,2],[2,1,6]],[[0,0,2],[2,9,6]],[[0,0,2]]]){
    const f=fixture();f.manifest.decorationFilter.spans=spans;
    await assert.rejects(loadFactoryGeometry(f.manifest,()=>{},'/api/factory-geometry/medium/simple',undefined,f.cache));assert.equal(f.writes.length,0);assert.ok(f.rows.has(f.identity+'|'+f.version));
  }
});
test('streamed filter metadata must match its catalog fingerprint before any geometry or material work',async t=>{
  const camera=new THREE.PerspectiveCamera(60,1,.1,100),center=new THREE.Vector3(),detail={sha256:'a'.repeat(64),meshes:[],decorationFilter:{removedMeshes:1}};
  camera.position.set(0,2,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld();let errorStatus='',called=false;
  const previous=console.error;console.error=()=>{};t.after(()=>{console.error=previous;});
  const streamer=createSectorStreamer({manifest:{sectors:[{id:'s_0_0',file:'sectors/s_0_0.json',sha256:detail.sha256,stats:{bytes:20},bounds:{min:[0,0,0],max:[1,1,1]},decorationFilter:{removedMeshes:1}}]},map:{id:'fixture',name:'测试',endpoint:'api/fixture',textureBase:'data/'},runtime:{geometry:{s_0_0:{manifestSha256:'f'.repeat(64)}}},getView:()=>({camera,center}),clipping:{low:{value:-10},high:{value:10}},settings:{mode:'radius',distance:20,sectorBudget:64,retain:false},environment:null,connection:{saveData:true},materialLibrary:{dispose(){},acquire(){called=true;throw Error();}},fetcher:async()=>Response.json(detail),loadGeometry:async()=>{called=true;throw Error();},loadSpatial:async()=>{called=true;throw Error();},onAdd(){called=true;},onRemove(){},onStatus:(message,error)=>{if(error)errorStatus=message;}});
  t.after(()=>streamer.dispose());streamer.update();
  const end=Date.now()+2000;while(!errorStatus&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(errorStatus);assert.equal(called,false);
});
