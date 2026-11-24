import * as THREE from 'three';
import {buildCollisionCells,COLLISION_CELL_SIZE} from './atlas-spatial-data.js';

// Retained for point occlusion raycasts only; camera movement has no physics.
// Broad phase indexes original instance bounds; narrow phase uses the actual
// triangles. It does not turn rooms or whole buildings into solid AABB blocks.
export class SceneCollision {
  constructor(){
    this.cells=new Map();this.large=new Map();this.groups=new Map();this.size=COLLISION_CELL_SIZE;
    this.proxy=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    this.raycaster=new THREE.Raycaster();this.box=new THREE.Box3();this.point=new THREE.Vector3();this.normalMatrix=new THREE.Matrix3();
  }
  add(groups){for(const group of groups){
    if(group.collisionSolid===false||['decal','cutout'].includes(group.mesh.material.userData.atlasRole))continue;
    if(this.groups.has(group))continue;
    const spatial=group.collisionIndex?.size===this.size?group.collisionIndex:buildCollisionCells(group.boxes,this.size);
    const keys=[];this.groups.set(group,keys);
    for(const [key,ids] of spatial.cells){
      if(!this.cells.has(key))this.cells.set(key,new Map());
      this.cells.get(key).set(group,ids);keys.push(key);
    }
    if(spatial.large.length)this.large.set(group,spatial.large);
  }}
  remove(groups){for(const group of groups){this.large.delete(group);for(const key of this.groups.get(group)||[]){const cell=this.cells.get(key);cell?.delete(group);if(!cell?.size)this.cells.delete(key);}this.groups.delete(group);}}
  cast(origin,direction,distance,accept=()=>true){
    const end=origin.clone().addScaledVector(direction,distance),candidates=new Map(),s=this.size;
    const include=groups=>{for(const [group,ids] of groups){if(!candidates.has(group))candidates.set(group,new Set());const selected=candidates.get(group);for(const id of ids)selected.add(id);}};
    include(this.large);
    for(let x=Math.floor(Math.min(origin.x,end.x)/s);x<=Math.floor(Math.max(origin.x,end.x)/s);x++)
      for(let z=Math.floor(Math.min(-origin.z,-end.z)/s);z<=Math.floor(Math.max(-origin.z,-end.z)/s);z++)include(this.cells.get(x+','+z)||[]);
    this.raycaster.set(origin,direction);this.raycaster.far=distance;let nearest=null;
    for(const [group,ids] of candidates)for(const i of ids){
      const b=group.boxes.subarray(i*6,i*6+6);
      this.box.min.set(b[0],b[1],-b[5]);this.box.max.set(b[3],b[4],-b[2]);
      if(!this.box.containsPoint(origin)&&(!this.raycaster.ray.intersectBox(this.box,this.point)||this.point.distanceTo(origin)>this.raycaster.far+.001))continue;
      const m=group.matrices.subarray(i*12,i*12+12);
      this.proxy.geometry=group.mesh.geometry;
      this.proxy.matrixWorld.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],-m[8],-m[9],-m[10],-m[11],0,0,0,1);
      const hits=[];this.proxy.raycast(this.raycaster,hits);
      this.normalMatrix.getNormalMatrix(this.proxy.matrixWorld);
      for(const hit of hits){
        const normal=hit.face.normal.clone().applyNormalMatrix(this.normalMatrix);
        if(normal.dot(direction)>0)normal.negate();
        const result={point:hit.point,normal,distance:hit.distance};
        if(hit.distance<=this.raycaster.far&&accept(result)){nearest=result;this.raycaster.far=hit.distance;}
      }
    }
    return nearest;
  }
}
