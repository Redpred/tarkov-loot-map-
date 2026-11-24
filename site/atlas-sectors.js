import * as THREE from 'three';
import {loadFactoryGeometry,geometryProgressText} from './factory-geometry.js';
import {createMaterialLibrary} from './factory-materials.js';
import {selectSectors,selectNearbySectors,retainedSectorIds} from './atlas-navigation.js';
import {loadPreparedSpatial} from './atlas-runtime.js';
import {sha256} from './atlas-resource-cache.js';

export function buildGeometryGroups(manifest,buffer,materials,spatial=null){
  return manifest.meshes.map((m,i)=>{
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,m.positionOffset,m.vertices*3),3));
    geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(buffer,m.uvOffset,m.vertices*2),2));
    if(m.paintOffset!=null)geo.setAttribute('paintWeight',new THREE.BufferAttribute(new Uint8Array(buffer,m.paintOffset,m.vertices*4),4,true));
    const Index=m.indexComponentType==='uint16'?Uint16Array:Uint32Array;
    geo.setIndex(new THREE.BufferAttribute(new Index(buffer,m.indexOffset,m.indices),1));
    const prepared=spatial?.meshes[i];
    if(prepared){
      geo.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(prepared.box),new THREE.Vector3().fromArray(prepared.box,3));
      geo.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(prepared.sphere),prepared.sphere[3]);
    }else{geo.computeBoundingBox();geo.computeBoundingSphere();}
    const mesh=new THREE.InstancedMesh(geo,materials.get(m.material),m.instances);
    return {mesh,matrices:new Float32Array(buffer,m.matrixOffset,m.instances*12),boxes:new Float32Array(buffer,m.boundsOffset,m.instances*6),instances:m.instances,collisionIndex:prepared?.collision};
  });
}

export async function buildGroupsInSlices(manifest,buffer,materials,spatial=null,signal){
  const groups=[];let start=performance.now();
  try{
    for(let i=0;i<manifest.meshes.length;i++){
      signal?.throwIfAborted();
      groups.push(...buildGeometryGroups({meshes:[manifest.meshes[i]]},buffer,materials,spatial?{meshes:[spatial.meshes[i]]}:null));
      if(performance.now()-start>=6){await new Promise(resolve=>setTimeout(resolve,0));start=performance.now();}
    }
    signal?.throwIfAborted();return groups;
  }catch(error){disposeGroups(groups);throw error;}
}

function disposeGroups(groups){for(const g of groups){g.mesh.dispose();g.mesh.geometry.dispose();}}

// Publish only genuinely textured meshes. Cutouts/decals never get an opaque
// placeholder, and original mesh indices still select the matching spatial data.
export async function* texturedGroupBatches(detail,buffer,library,spatial=null,{signal,progress=()=>{},batchSize=8,waitUntilActive=async()=>{}}={}){
  const byMaterial=new Map();
  detail.meshes.forEach((mesh,index)=>{if(!byMaterial.has(mesh.material))byMaterial.set(mesh.material,[]);byMaterial.get(mesh.material).push(index);});
  const ids=[...byMaterial.keys()];
  for(let offset=0;offset<ids.length;offset+=batchSize){
    await waitUntilActive();
    signal?.throwIfAborted();
    const materialIds=ids.slice(offset,offset+batchSize),materials=await library.acquire(materialIds,progress,signal);
    let groups;
    try{
      const indices=materialIds.flatMap(id=>byMaterial.get(id));
      groups=await buildGroupsInSlices({meshes:indices.map(i=>detail.meshes[i])},buffer,materials,spatial?{meshes:indices.map(i=>spatial.meshes[i])}:null,signal);
      for(const g of groups)g.collisionSolid=!['decal','cutout'].includes(g.mesh.material.userData.atlasRole);
    }catch(error){library.release(materialIds);throw error;}
    // Ownership of groups and these material references transfers to the caller.
    yield {groups,materialIds};
  }
}

export function createSectorStreamer({manifest,textureManifest=manifest,map,geometryBase=map.textureBase,geometryEndpoint=map.endpoint,getView,clipping,settings,onAdd,onRemove,onStatus,runtime=null,
  fetcher=globalThis.fetch,loadGeometry=loadFactoryGeometry,loadSpatial=loadPreparedSpatial,materialLibrary,environment=globalThis.document,connection=globalThis.navigator?.connection}){
  const library=materialLibrary||createMaterialLibrary(textureManifest,clipping,map.textureBase),loaded=new Map(),failed=new Map();
  let desired=[],nearby=[],center=new THREE.Vector3(),busy=false,timer=null,idleTimer=null,paused=false,pageSuspended=false,active=null,disposed=false,lastView='',movedAt=0,revision=0;
  const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
  const suspended=()=>paused||pageSuspended||disposed||environment?.hidden;
  const incomplete=()=>desired.some(s=>!loaded.get(s.id)?.complete&&!failed.has(s.id));
  function status(extra=''){
    if(disposed)return;
    const ready=desired.filter(s=>loaded.get(s.id)?.complete).length;
    const errors=desired.filter(s=>failed.has(s.id)).length;
    const mb=Math.round([...loaded.values()].reduce((n,v)=>n+v.sector.stats.bytes,0)/2**20);
    onStatus(errors?`${errors} 个分区加载失败，点击重试`:`${paused?'已暂停 · ':''}${map.name}场景 ${ready} / ${desired.length} 个分区 · 已载入 ${mb} MiB${desired.budgetLimited?' · 已限制加载范围（预算）':''}${extra?' · '+extra:''}`,errors>0,paused);
  }
  function remove(id){
    const value=loaded.get(id);if(!value)return;
    loaded.delete(id);if(value.groups.length)onRemove(value.groups);disposeGroups(value.groups);library.release(value.materialIds);
  }
  async function trim(){
    let keep,stamp=-1;
    for(const id of loaded.keys()){
      if(suspended())return;
      if(stamp!==revision){stamp=revision;keep=retainedSectorIds([...loaded.values()].filter(v=>v.complete).map(v=>v.sector),[...desired,...nearby],center,settings);}
      if(!keep.has(id)){remove(id);await yieldUI();}
    }
  }
  async function pump(){
    if(busy||disposed)return;busy=true;
    try{
      while(true){
        if(suspended())break;await trim();if(suspended())break;
        let sector=desired.find(s=>!loaded.get(s.id)?.complete&&!failed.has(s.id));
        if(!sector){
          // Prefetch never competes with visible work or runs during movement.
          if(desired.some(s=>!loaded.get(s.id)?.complete))break;
          if(performance.now()-movedAt<500){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{idleTimer=null;void pump();},500);break;}
          sector=nearby.find(s=>!loaded.has(s.id)&&!failed.has(s.id));
        }
        if(!sector)break;
        const job={id:sector.id,controller:new AbortController()},signal=job.controller.signal;
        active=job;let resources=[];
        try{
          status('读取模型');
          const response=await fetcher(geometryBase+sector.file,{signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const detail=await response.json();
          signal.throwIfAborted();
          if(detail.sha256!==sector.sha256)throw new Error('分区已更新，请刷新页面');
          if(sector.decorationFilter&&await sha256(new TextEncoder().encode(JSON.stringify(detail)))!==runtime?.geometry?.[sector.id]?.manifestSha256)throw new Error('装饰筛选分区已更新，请刷新页面');
          signal.throwIfAborted();
          resources=[loadGeometry(detail,(done,total,source)=>status(geometryProgressText(done,total,source)),`${geometryEndpoint}/${sector.id}`,signal),loadSpatial(map.id,sector.id,detail,runtime,{signal})];
          const [buffer,spatial]=await Promise.all(resources);signal.throwIfAborted();
          const entry={sector,groups:[],materialIds:[],complete:false};loaded.set(sector.id,entry);
          for await(const batch of texturedGroupBatches(detail,buffer,library,spatial,{signal,progress:(done,total)=>status(`补充贴图 ${done}/${total}`)})){
            if(signal.aborted){disposeGroups(batch.groups);library.release(batch.materialIds);signal.throwIfAborted();}
            entry.groups.push(...batch.groups);entry.materialIds.push(...batch.materialIds);onAdd(batch.groups);
            status(`逐步显示 ${entry.groups.length}/${detail.meshes.length}`);await yieldUI();
          }
          signal.throwIfAborted();entry.complete=true;status();
          await yieldUI();
        }catch(error){
          job.controller.abort();await Promise.allSettled(resources);remove(sector.id);
          if(error.name!=='AbortError'&&!disposed){failed.set(sector.id,{message:error.message,background:!desired.some(s=>s.id===sector.id)});console.error(`${map.id} sector ${sector.id}:`,error);}status();
        }finally{if(active===job)active=null;}
      }
    }finally{busy=false;if(disposed)library.dispose();else{status();if(!suspended()&&incomplete())update();}}
  }
  function replan(){
    if(suspended())return;
    revision++;
    const view=getView();
    center.copy(view.center);view.camera.updateMatrixWorld();
    const key=JSON.stringify([view.camera.matrixWorld.elements,view.camera.projectionMatrix.elements,center.toArray(),clipping.low.value,clipping.high.value,settings.mode,settings.distance,settings.sectorBudget,settings.retain,view.firstPerson]);
    if(key!==lastView){lastView=key;movedAt=performance.now();}
    const options={...settings,nearRadius:view.firstPerson?24:0};
    desired=selectSectors(manifest,view.camera,center,clipping,options);
    for(const sector of desired)if(failed.get(sector.id)?.background)failed.delete(sector.id);
    nearby=connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType)?[]:selectNearbySectors(manifest,view.camera,center,clipping,options,desired);
    if(active&&!desired.some(s=>s.id===active.id)&&(incomplete()||!nearby.some(s=>s.id===active.id)))active.controller.abort();
    if(suspended())active?.controller.abort();
    status();void pump();
  }
  function update(){if(!disposed&&!timer)timer=setTimeout(()=>{timer=null;replan();},lastView?80:0);}
  const visibility=()=>{if(environment?.hidden)active?.controller.abort();else replan();};
  environment?.addEventListener('visibilitychange',visibility);
  return {update,setSuspended(value){
      pageSuspended=Boolean(value);
      if(pageSuspended){clearTimeout(timer);timer=null;clearTimeout(idleTimer);idleTimer=null;active?.controller.abort();}
      else update();
    },retry(){failed.clear();update();},togglePause(){paused=!paused;if(paused)active?.controller.abort();update();status();return paused;},
    dispose(){if(disposed)return;disposed=true;clearTimeout(timer);clearTimeout(idleTimer);active?.controller.abort();environment?.removeEventListener('visibilitychange',visibility);for(const id of loaded.keys())remove(id);if(!busy)library.dispose();}};
}
