import * as THREE from 'three';
import {budgetSectors} from './atlas-performance.js';
import {unityToView} from './factory-coordinates.js';
import {volumeDisplayPosition} from './atlas-volumes.js';

export function firstPersonEntryPosition({point,surface,target,camera,low=-Infinity,high=Infinity}){
  // An explicit point carries its own floor; a ray from above may hit a roof.
  if(point?.position&&['x','y','z'].every(axis=>Number.isFinite(point.position[axis]))){
    const p=unityToView(volumeDisplayPosition(point,low,high));return new THREE.Vector3(p.x,p.y,p.z);
  }
  const position=(surface()||target).clone();
  const towardsCamera=camera.position.clone().sub(position);towardsCamera.y=0;
  if(towardsCamera.lengthSq())position.addScaledVector(towardsCamera.normalize(),1.1);
  return position;
}

// Moving both camera and target preserves orientation and orthographic scale.
// A pivot on the central ray also preserves every point's screen position.
export function rebaseOrbitPivot(camera,controls,point){
  if(!point||!point.toArray().every(Number.isFinite))return false;
  const delta=point.clone().sub(controls.target);
  camera.position.add(delta);controls.target.copy(point);controls.update();
  camera.updateMatrixWorld();return true;
}

export function pickSceneSurface(camera,ndc,meshes,low,high,visible=()=>true){
  camera.updateMatrixWorld();
  const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);
  // InstancedMesh broad-phase bounds are maintained when the height band changes.
  const hits=ray.intersectObjects(meshes.filter(m=>m.visible),false);
  const hit=hits.find(h=>h.point.y>=low-.01&&h.point.y<=high+.01&&visible(h.point));
  return hit?.point.clone()||null;
}

export function planePivot(camera,ndc,height){
  const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),new THREE.Vector3());
}

export function sectorDistance(sector,center){
  // Sectors store Unity Z; the viewer uses -Z. Distance is to the actual
  // geometry footprint, so buildings crossing tile edges are not cut off.
  const x=center.x,z=-center.z,b=sector.bounds;
  return Math.hypot(Math.max(b.min[0]-x,0,x-b.max[0]),Math.max(b.min[2]-z,0,z-b.max[2]));
}

export function selectSectors(manifest,camera,center,clipping,settings){
  camera.updateMatrixWorld();
  const matrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(matrix);
  const box=new THREE.Box3();
  const candidates=manifest.sectors.filter(s=>{
    if(settings.mode==='all')return true;
    if(s.bounds.max[1]<clipping.low.value||s.bounds.min[1]>clipping.high.value)return false;
    if(sectorDistance(s,center)>settings.distance)return false;
    if(settings.mode==='radius')return true;
    if(settings.nearRadius&&sectorDistance(s,center)<=settings.nearRadius)return true;
    box.min.set(s.bounds.min[0],s.bounds.min[1],-s.bounds.max[2]);
    box.max.set(s.bounds.max[0],s.bounds.max[1],-s.bounds.min[2]);
    return frustum.intersectsBox(box);
  }).sort((a,b)=>sectorDistance(a,center)-sectorDistance(b,center));
  const selected=budgetSectors(candidates,settings.sectorBudget,s=>Boolean(settings.nearRadius)&&sectorDistance(s,center)<=settings.nearRadius);
  Object.defineProperty(selected,'budgetLimited',{value:selected.length<candidates.length});
  return selected;
}

// Only a small border beyond the requested view; never turn this into a
// background whole-map download. The visible set always owns the budget first.
export function selectNearbySectors(manifest,camera,center,clipping,settings,visible){
  if(settings.mode==='all'||!visible.length||visible.budgetLimited)return [];
  const limit=settings.sectorBudget?settings.sectorBudget*2**20:Infinity;
  let remaining=Math.min(32*2**20,limit*.05,limit-visible.reduce((n,s)=>n+s.stats.bytes,0));
  const selected=new Set(visible.map(s=>s.id)),projection=camera.projectionMatrix.clone();
  projection.elements[0]/=1.15;projection.elements[5]/=1.15;
  const frustum=new THREE.Frustum().setFromProjectionMatrix(projection.multiply(camera.matrixWorldInverse));
  const box=new THREE.Box3(),distance=settings.distance+Math.min(30,settings.distance*.15),out=[];
  const candidates=manifest.sectors.filter(s=>{
    if(selected.has(s.id)||s.bounds.max[1]<clipping.low.value||s.bounds.min[1]>clipping.high.value||sectorDistance(s,center)>distance)return false;
    if(settings.mode==='radius')return true;
    box.min.set(s.bounds.min[0],s.bounds.min[1],-s.bounds.max[2]);box.max.set(s.bounds.max[0],s.bounds.max[1],-s.bounds.min[2]);
    return frustum.intersectsBox(box);
  }).sort((a,b)=>sectorDistance(a,center)-sectorDistance(b,center));
  for(const sector of candidates){if(sector.stats.bytes>remaining)continue;out.push(sector);remaining-=sector.stats.bytes;if(out.length===2)break;}
  return out;
}

export function retainedSectorIds(loaded,wanted,center,settings){
  const ids=new Set(wanted.map(s=>s.id));if(!settings.retain)return ids;
  const budget=settings.sectorBudget?settings.sectorBudget*2**20:Infinity;
  let remaining=Math.min(128*2**20,budget*.125,budget-wanted.reduce((n,s)=>n+s.stats.bytes,0));
  for(const sector of loaded.filter(s=>!ids.has(s.id)).sort((a,b)=>sectorDistance(a,center)-sectorDistance(b,center))){
    if(sectorDistance(sector,center)>settings.distance+30||sector.stats.bytes>remaining)continue;
    ids.add(sector.id);remaining-=sector.stats.bytes;
  }
  return ids;
}
