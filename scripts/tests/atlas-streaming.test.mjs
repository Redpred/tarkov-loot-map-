import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {texturedGroupBatches,createSectorStreamer} from '../../site/atlas-sectors.js';
import {selectSectors,selectNearbySectors,retainedSectorIds} from '../../site/atlas-navigation.js';
import {createMaterialLibrary} from '../../site/factory-materials.js';
import {sha256} from '../../site/atlas-resource-cache.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('stream did not reach expected state');await pause(5);}}
const blocked=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
function fixture(ids){
  const buffer=new ArrayBuffer(ids.length*160),meshes=ids.map((material,i)=>{
    const n=i*160;
    new Float32Array(buffer,n,9).set([0,0,0,1,0,0,0,1,0]);new Uint32Array(buffer,n+60,3).set([0,1,2]);
    new Float32Array(buffer,n+72,12).set([1,0,0,0,0,1,0,0,0,0,1,0]);
    new Float32Array(buffer,n+120,6).set([0,0,0,1,1,0]);
    return {material,positionOffset:n,uvOffset:n+36,indexOffset:n+60,matrixOffset:n+72,boundsOffset:n+120,vertices:3,indices:3,instances:1};
  });return {detail:{meshes,sha256:'a'.repeat(64)},buffer};
}
function library(before=async()=>{}){
  const refs=new Map(),released=[],materials=new Map();let disposed=false;
  return {refs,released,async acquire(ids,progress,signal){await before(ids,signal);signal?.throwIfAborted();return new Map(ids.map(id=>{
    refs.set(id,(refs.get(id)||0)+1);if(!materials.has(id)){const material=new THREE.MeshBasicMaterial();material.userData.atlasRole=id===2?'cutout':'solid';materials.set(id,material);}return [id,materials.get(id)];
  }));},release(ids){released.push(...ids);for(const id of ids){assert.ok(refs.get(id)>0,'material must have a live owner');refs.set(id,refs.get(id)-1);}},dispose(){disposed=true;for(const m of materials.values())m.dispose();},get disposed(){return disposed;}};
}
const free=groups=>groups.forEach(g=>{g.mesh.dispose();g.mesh.geometry.dispose();});
const sector=(id,x,bytes=2**20)=>({id,file:id+'.json',sha256:'a'.repeat(64),bounds:{min:[x,0,0],max:[x+1,1,1]},stats:{bytes}});
const clipping={low:{value:-10},high:{value:10}};
function harness(t,{sectors=[sector('a',0),sector('b',100)],lib=library(),loadGeometry,loadSpatial=async()=>null,connection={saveData:true},settings={mode:'radius',distance:5,sectorBudget:64,retain:true}}={}){
  const camera=new THREE.PerspectiveCamera(60,1,.1,200),center=new THREE.Vector3(),environment=new EventTarget();environment.hidden=false;
  camera.position.set(0,2,0);camera.lookAt(0,2,-10);camera.updateMatrixWorld();
  const fetched=[],added=[],removed=[],statuses=[],fixtures={a:fixture([0,1,2,3,4,5,6,7,8]),b:fixture([20]),c:fixture([30])};
  const streamer=createSectorStreamer({manifest:{sectors},map:{id:'fixture',name:'测试',textureBase:'data/',endpoint:'api/fixture'},getView:()=>({camera,center}),clipping,settings,environment,connection,materialLibrary:lib,
    fetcher:async(url,{signal})=>{signal.throwIfAborted();const id=url.split('/').at(-1).split('.')[0];fetched.push(id);return Response.json({...fixtures[id].detail,id});},
    loadGeometry:loadGeometry|| (async detail=>fixtures[detail.id].buffer),loadSpatial,
    onAdd:groups=>added.push(...groups),onRemove:groups=>removed.push(...groups),onStatus:(message,error)=>statuses.push({message,error})});
  t.after(()=>streamer.dispose());return {streamer,lib,camera,center,environment,fixtures,fetched,added,removed,statuses};
}

test('first textured batch appears without waiting for the last material; spatial indices and cutouts stay intact',async()=>{
  const {detail,buffer}=fixture([1,0,1,2,3,4,5,6,7,8]),lib=library(),spatial={meshes:detail.meshes.map((_,i)=>({box:[i,0,0,i+1,1,1],sphere:[i,0,0,1],collision:{index:i}}))};
  const batches=texturedGroupBatches(detail,buffer,lib,spatial);
  const first=await batches.next();assert.equal(first.done,false);assert.equal(first.value.groups.length,9);assert.equal(lib.refs.has(8),false);
  assert.deepEqual(first.value.groups.map(g=>g.collisionIndex.index),[0,2,1,3,4,5,6,7,8]);assert.equal(first.value.groups[3].collisionSolid,false);
  const last=await batches.next();assert.equal(last.value.groups.length,1);assert.equal((await batches.next()).done,true);
  for(const batch of [first.value,last.value]){free(batch.groups);lib.release(batch.materialIds);}assert.ok([...lib.refs.values()].every(n=>n===0));lib.dispose();
});

test('camera movement cancels a texture batch, removes partial GPU groups, and starts the newly visible sector',async t=>{
  let waiting=false;const lib=library(async(ids,signal)=>{if(ids.includes(8)){waiting=true;await blocked(signal);}}),h=harness(t,{lib});
  h.streamer.update();await until(()=>waiting);assert.equal(h.added.length,8);assert.ok(h.statuses.some(s=>s.message.includes('逐步显示 8/9')));
  h.center.x=100;h.camera.position.x=100;for(let i=0;i<20;i++)h.streamer.update();
  await until(()=>h.added.length===9&&h.statuses.at(-1).message.includes('1 / 1'));
  assert.deepEqual(h.fetched,['a','b']);assert.equal(h.removed.length,8);assert.equal(lib.refs.get(0),0);assert.equal(lib.refs.get(20),1);assert.ok(h.statuses.every(s=>!s.error));
  h.streamer.dispose();assert.equal(lib.refs.get(20),0);await until(()=>lib.disposed);
});

test('pausing and hiding a page stop pending downloads; resume can retry without a failed-sector state',async t=>{
  let block=true,calls=0,aborts=0;let h;
  h=harness(t,{loadGeometry:async(detail,progress,endpoint,signal)=>{calls++;if(block){try{await blocked(signal);}catch(e){aborts++;throw e;}}return h.fixtures[detail.id].buffer;}});
  h.streamer.update();await until(()=>calls===1);h.streamer.togglePause();await until(()=>aborts===1);await pause(120);assert.equal(calls,1);
  h.streamer.togglePause();await until(()=>calls===2);h.environment.hidden=true;h.environment.dispatchEvent(new Event('visibilitychange'));await until(()=>aborts===2);
  block=false;h.environment.hidden=false;h.environment.dispatchEvent(new Event('visibilitychange'));await until(()=>h.statuses.at(-1).message.includes('1 / 1'));
  assert.equal(calls,3);assert.ok(h.statuses.every(s=>!s.error));assert.equal(h.added.length,9);
});

test('background border loading waits for visible work and idle; new foreground work interrupts it',async t=>{
  let waiting=false,aborted=false;let h;
  h=harness(t,{sectors:[sector('a',0),sector('b',11),sector('c',40)],connection:{},settings:{mode:'radius',distance:10,sectorBudget:64,retain:true},loadGeometry:async(detail,progress,endpoint,signal)=>{
    if(detail.id==='b'){waiting=true;try{await blocked(signal);}catch(e){aborted=true;throw e;}}return h.fixtures[detail.id].buffer;
  }});
  h.streamer.update();await until(()=>h.statuses.at(-1)?.message.includes('1 / 1'));assert.deepEqual(h.fetched,['a']);
  await until(()=>waiting);h.center.x=40;h.streamer.update();await until(()=>h.fetched.includes('c')&&h.statuses.at(-1).message.includes('1 / 1'));
  assert.equal(aborted,true);assert.ok(h.statuses.every(s=>!s.error));assert.equal(h.lib.refs.get(20),undefined);
});

test('data saver disables speculative downloads',async t=>{
  const h=harness(t,{sectors:[sector('a',0),sector('b',11)],settings:{mode:'radius',distance:10,sectorBudget:64,retain:true}});
  h.streamer.update();await until(()=>h.statuses.at(-1)?.message.includes('1 / 1'));await pause(650);assert.deepEqual(h.fetched,['a']);
});

test('a sector failure stops its companion request, reports a retry, and does not leak partial materials',async t=>{
  let fail=true,spatialAborted=false;const previousError=console.error;console.error=()=>{};t.after(()=>{console.error=previousError;});
  const h=harness(t,{loadGeometry:async(detail,progress,endpoint,signal)=>{if(fail)throw Error('model failed');return h.fixtures[detail.id].buffer;},
    loadSpatial:async(map,id,detail,runtime,{signal})=>{if(fail){try{await blocked(signal);}catch(error){spatialAborted=true;throw error;}}return null;}});
  h.streamer.update();await until(()=>h.statuses.at(-1)?.error);assert.equal(spatialAborted,true);assert.equal(h.added.length,0);assert.equal(h.lib.refs.size,0);
  fail=false;h.streamer.retry();await until(()=>h.statuses.at(-1)?.message.includes('1 / 1'));assert.equal(h.fetched.length,2);assert.equal(h.added.length,9);
});

test('border prefetch stays within count, bytes, height and remaining budget; near retained sectors replace far ones',()=>{
  const camera=new THREE.PerspectiveCamera(60,1,.1,200);camera.position.set(0,2,0);camera.lookAt(0,2,-10);camera.updateMatrixWorld();const center=new THREE.Vector3();
  const a=sector('a',0,8*2**20),b=sector('b',11,4*2**20),c=sector('c',11.2,4*2**20),large=sector('large',11.1,50*2**20),high={...sector('high',11),bounds:{min:[11,20,0],max:[12,21,1]}};
  const manifest={sectors:[a,b,c,large,high]},settings={mode:'radius',distance:10,sectorBudget:1024,retain:true};
  const visible=selectSectors(manifest,camera,center,clipping,settings);assert.deepEqual(visible.map(s=>s.id),['a']);
  assert.deepEqual(selectNearbySectors(manifest,camera,center,clipping,settings,visible).map(s=>s.id),['b','c']);
  assert.equal(selectNearbySectors(manifest,camera,center,clipping,{...settings,sectorBudget:8},visible).length,0);
  assert.equal(selectNearbySectors(manifest,camera,center,clipping,{...settings,mode:'all'},visible).length,0);
  const retained=retainedSectorIds([sector('far',200,1),sector('near',1,80*2**20),sector('less-near',3,80*2**20)],[a],center,settings);
  assert.deepEqual([...retained],['a','near']);assert.deepEqual([...retainedSectorIds([b],[a],center,{...settings,retain:false})],['a']);
  const projection=camera.projectionMatrix.toArray();selectNearbySectors(manifest,camera,center,clipping,{...settings,mode:'view'},visible);assert.deepEqual(camera.projectionMatrix.toArray(),projection);
});

test('material request concurrency is bounded; cancellation releases decoded textures while shared live materials survive',async t=>{
  const previousFetch=globalThis.fetch,previousLoad=THREE.TextureLoader.prototype.loadAsync,bytes=new Uint8Array([1,2,3]),hash=await sha256(bytes);
  let pending=0,peak=0,blockedMode=false;const textures=[];
  THREE.TextureLoader.prototype.loadAsync=async()=>{const texture=new THREE.Texture();texture.disposed=false;texture.addEventListener('dispose',()=>{texture.disposed=true;});textures.push(texture);return texture;};
  globalThis.fetch=async(url,{signal})=>{pending++;peak=Math.max(peak,pending);try{if(blockedMode)await blocked(signal);else await pause(1);signal.throwIfAborted();return new Response(bytes);}finally{pending--;}};
  t.after(()=>{globalThis.fetch=previousFetch;THREE.TextureLoader.prototype.loadAsync=previousLoad;});
  const manifest={materials:Array.from({length:9},(_,i)=>({tex:'t'+i})),textures:Object.fromEntries(Array.from({length:9},(_,i)=>['t'+i,{file:'t'+i+'.webp',sha256:hash,bytes:3}]))};
  manifest.materials.push({tex:'t0'});const lib=createMaterialLibrary(manifest,clipping);t.after(()=>lib.dispose());
  await lib.acquire([0]);blockedMode=true;const controller=new AbortController(),job=lib.acquire([1,2,3,4,5,6,7,8],()=>{},controller.signal);
  await until(()=>pending===4);controller.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(peak,4);assert.equal(pending,0);assert.equal(textures[0].disposed,false);
  await lib.acquire([9]);lib.release([0]);assert.equal(textures[0].disposed,false);lib.release([9]);assert.equal(textures[0].disposed,true);
});


test('covered map retains completed GPU groups, stops downloads and preserves manual pause',async t=>{
  const h=harness(t);h.streamer.update();await until(()=>h.statuses.at(-1)?.message.includes('1 / 1'));
  const original=h.added.slice();h.streamer.setSuspended(true);h.center.x=100;h.streamer.update();await pause(120);
  assert.deepEqual(h.fetched,['a']);assert.equal(h.removed.length,0);
  assert.ok(original.every(group=>h.added.includes(group)));assert.equal(h.lib.refs.get(0),1);
  h.streamer.togglePause();h.streamer.setSuspended(false);await pause(120);assert.deepEqual(h.fetched,['a']);
  h.streamer.togglePause();await until(()=>h.fetched.includes('b'));assert.ok(h.statuses.every(s=>!s.error));
});

test('covering during download cancels it without marking failure and resumes successfully',async t=>{
  let blocking=true,aborted=false,h;
  h=harness(t,{loadGeometry:async(detail,progress,endpoint,signal)=>{
    if(blocking)try{await blocked(signal);}catch(error){aborted=true;throw error;}
    return h.fixtures[detail.id].buffer;
  }});
  h.streamer.update();await until(()=>h.fetched.length===1);h.streamer.setSuspended(true);await until(()=>aborted);
  await pause(120);assert.equal(h.fetched.length,1);assert.ok(h.statuses.every(s=>!s.error));
  blocking=false;h.streamer.setSuspended(false);await until(()=>h.statuses.at(-1)?.message.includes('1 / 1'));
  assert.equal(h.added.length,9);assert.equal(h.fetched.length,2);
});
