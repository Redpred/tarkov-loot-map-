import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {mergeMapData,runtimeInputs} from '../site/atlas-runtime.js';
import {createItemIndex} from '../site/atlas-item-index.js';
import {createTaskMapIndex,restoreTaskMapIndex} from '../site/task-map-index.js';
import {SceneCollision} from '../site/atlas-collision.js';
import {buildGeometryGroups} from '../site/atlas-sectors.js';

const root=path.resolve(import.meta.dirname,'..'),site=path.join(root,'site');
const catalog=JSON.parse(fs.readFileSync(path.join(site,'data/runtime/manifest.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(path.join(site,file));
function artifact(info){const bytes=read(info.file);assert.equal(hash(bytes),info.sha256);assert.equal(bytes.length,info.bytes);assert.deepEqual(gunzipSync(read(info.file+'.gz')),bytes);return JSON.parse(bytes);}
function median(fn){const values=[];for(let i=0;i<5;i++){const start=performance.now();fn();values.push(performance.now()-start);}return +values.sort((a,b)=>a-b)[2].toFixed(2);}
const normalize=entries=>entries.map(e=>({id:e.task.id,rows:e.objectives.map(r=>({id:r.objective.id,points:[...r.points].map(p=>p.id),candidate:r.candidate,hint:r.hint,relevant:r.relevant}))}));
const report={generatedAt:new Date().toISOString(),maps:[],geometry:{sectors:0,meshes:0,instances:0,bytes:0},note:'Node CPU microbenchmarks, median of 5; excludes network, GPU upload and drawing. Task sample = first 25 map-relevant tasks.'};
for(const map of Object.values(ATLAS_MAPS)){
  const entry=catalog.maps[map.id],prepared=artifact(entry),files=runtimeInputs(map);
  for(const file of files)assert.equal(hash(read(file)),entry.inputs[file],file);
  const [loot,poi,quests,regions,tasks]=files.map(file=>JSON.parse(read(file))),data=mergeMapData(loot,poi,quests);
  assert.deepEqual(prepared.loot,loot);assert.deepEqual(prepared.poi,poi);assert.deepEqual(prepared.quests,quests);assert.deepEqual(prepared.regions,regions);
  const original=createItemIndex(data),fast=createItemIndex(data,prepared.itemIndex);
  assert.deepEqual(fast.items,original.items);
  const a=original.serialize(),b=fast.serialize();assert.deepEqual(b,a);
  for(const query of ['显示卡','LEDX','5.45','钥匙','medicine'])assert.deepEqual(fast.search(query),original.search(query));
  const originalTasks=createTaskMapIndex({catalog:tasks,data,mapId:map.id,itemIndex:original});
  const fastTasks=restoreTaskMapIndex(prepared.taskIndex,data,map.id),all=tasks.tasks.map(t=>t.id);
  assert.deepEqual(normalize(fastTasks.entries(all)),normalize(originalTasks.entries(all)));
  const selected=prepared.taskIndex.entries.slice(0,25).map(e=>e.task.id);
  const metrics={id:map.id,points:data.points.length,items:original.items.length,tasks:prepared.taskIndex.entries.length,
    legacyDataGzipBytes:files.reduce((n,file)=>n+gzipSync(read(file),{level:4}).length,0),
    preparedDataGzipBytes:read(entry.file+'.gz').length,
    itemBuildMs:median(()=>createItemIndex(data)),itemRestoreMs:median(()=>createItemIndex(data,prepared.itemIndex)),
    taskBuildAndQueryMs:median(()=>createTaskMapIndex({catalog:tasks,data,mapId:map.id,itemIndex:original}).entries(selected)),
    taskRestoreAndQueryMs:median(()=>restoreTaskMapIndex(prepared.taskIndex,data,map.id).entries(selected))};
  const geometry=JSON.parse(read(map.geometry)),sectors=map.streamed?geometry.sectors:[{id:'whole'}];
  for(const sector of sectors){
    const file=map.streamed?map.textureBase+sector.file:map.geometry,detail=JSON.parse(read(file)),info=catalog.geometry[map.id][sector.id],spatial=artifact(info);
    assert.equal(hash(JSON.stringify(detail)),info.manifestSha256);assert.equal(spatial.geometrySha256,detail.sha256);
    const raw=read(file.replace(/\.json$/,'.bin'));assert.equal(hash(raw),detail.sha256);const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
    assert.equal(spatial.meshes.length,detail.meshes.length);
    for(let i=0;i<detail.meshes.length;i++){
      const m=detail.meshes[i],s=spatial.meshes[i],geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,m.positionOffset,m.vertices*3),3));
      geo.computeBoundingBox();geo.computeBoundingSphere();
      // JSON encodes -0 as 0; they have identical geometry and collision semantics.
      const jsonNumbers=values=>values.map(n=>n===0?0:n);
      assert.deepEqual(s.box,jsonNumbers([...geo.boundingBox.min.toArray(),...geo.boundingBox.max.toArray()]));
      assert.deepEqual(s.sphere,jsonNumbers([...geo.boundingSphere.center.toArray(),geo.boundingSphere.radius]));
      const boxes=new Float32Array(buffer,m.boundsOffset,m.instances*6),expected=new Map(),large=[];
      for(let n=0;n<m.instances;n++){
        const at=n*6,minX=Math.floor(boxes[at]/8),maxX=Math.floor(boxes[at+3]/8),minZ=Math.floor(boxes[at+2]/8),maxZ=Math.floor(boxes[at+5]/8);
        if((maxX-minX+1)*(maxZ-minZ+1)>256){large.push(n);continue;}
        for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=`${x},${z}`;if(!expected.has(key))expected.set(key,[]);expected.get(key).push(n);}
      }
      assert.deepEqual(s.collision,{size:8,cells:[...expected],large});
      report.geometry.meshes++;report.geometry.instances+=m.instances;
    }
    if(sector.id==='whole'){
      const material=new THREE.MeshBasicMaterial(),materials=new Map(detail.meshes.map(m=>[m.material,material]));
      const groups=buildGeometryGroups(detail,buffer,materials,spatial),without=groups.map(g=>({...g,collisionIndex:null}));
      metrics.collisionBuildMs=median(()=>new SceneCollision().add(without));
      metrics.collisionRestoreMs=median(()=>new SceneCollision().add(groups));
      const make=prepared=>{const groups=buildGeometryGroups(detail,buffer,materials,prepared);for(const g of groups){g.mesh.geometry.dispose();g.mesh.dispose();}};
      metrics.geometryBuildMs=median(()=>make(null));metrics.geometryRestoreMs=median(()=>make(spatial));
      for(const g of groups){g.mesh.geometry.dispose();g.mesh.dispose();}material.dispose();
    }
    report.geometry.sectors++;report.geometry.bytes+=raw.length;
  }
  report.maps.push(metrics);console.log(JSON.stringify(metrics));
}
const out=path.join(root,'work/runtime-precompute-20261014/verification.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({geometry:report.geometry,report:out}));
