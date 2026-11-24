import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildSpatialData,buildCollisionCells} from '../../site/atlas-spatial-data.js';
import {buildGeometryGroups} from '../../site/atlas-sectors.js';
import {SceneCollision} from '../../site/atlas-collision.js';

function fixture(){
  const source=new THREE.BoxGeometry(4,2,6),p=source.attributes.position.array,uv=source.attributes.uv.array;
  const vertices=p.length/3,index=new Uint32Array(source.index.array),paint=new Uint8Array(vertices*4);
  const instances=[[1,-8,1,-8],[1,8,3,8],[100,1000,-10,1000]];
  const matrices=new Float32Array(instances.length*12),boxes=new Float32Array(instances.length*6);
  source.computeBoundingBox();
  instances.forEach(([scale,x,y,z],i)=>{matrices.set([scale,0,0,x,0,1,0,y,0,0,scale,z],i*12);
    const box=source.boundingBox.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(scale,1,scale)));
    boxes.set([...box.min.toArray(),...box.max.toArray()],i*6);
  });
  const buffer=new ArrayBuffer(p.byteLength+uv.byteLength+paint.byteLength+index.byteLength+matrices.byteLength+boxes.byteLength);
  const mesh={vertices,instances:instances.length,indices:index.length,material:0};let offset=0;
  for(const [key,array] of [['position',p],['uv',uv],['paint',paint],['index',index],['matrix',matrices],['bounds',boxes]]){
    mesh[key+'Offset']=offset;new Uint8Array(buffer,offset,array.byteLength).set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));offset+=array.byteLength;
  }
  return {manifest:{sha256:'a'.repeat(64),meshes:[mesh]},buffer,source};
}
test('precomputed bounds match Three.js exactly and do not change vertex/UV/index buffers',()=>{
  const {manifest,buffer}=fixture(),spatial=buildSpatialData(manifest,buffer),material=new THREE.MeshBasicMaterial();
  const reference=buildGeometryGroups(manifest,buffer,new Map([[0,material]]));
  const prepared=buildGeometryGroups(manifest,buffer,new Map([[0,material]]),JSON.parse(JSON.stringify(spatial)));
  assert.deepEqual(prepared[0].mesh.geometry.boundingBox,reference[0].mesh.geometry.boundingBox);
  assert.deepEqual(prepared[0].mesh.geometry.boundingSphere,reference[0].mesh.geometry.boundingSphere);
  for(const name of ['position','uv','paintWeight'])assert.deepEqual(prepared[0].mesh.geometry.attributes[name].array,reference[0].mesh.geometry.attributes[name].array);
  assert.deepEqual(prepared[0].mesh.geometry.index.array,reference[0].mesh.geometry.index.array);
  assert.deepEqual(prepared[0].matrices,reference[0].matrices);assert.deepEqual(prepared[0].boxes,reference[0].boxes);
});

test('Unity collision grid covers negative coordinates, exact boundaries and large instances',()=>{
  const cells=buildCollisionCells(new Float32Array([-8,0,-8,0,1,0,-1000,0,-1000,1000,1,1000]));
  assert.deepEqual(cells.cells.map(([key])=>key),['-1,-1','-1,0','0,-1','0,0']);assert.deepEqual(cells.large,[1]);
});

test('prepared and fallback collisions agree with brute-force rays; removing sectors leaves no stale hits',()=>{
  const {manifest,buffer}=fixture(),material=new THREE.MeshBasicMaterial(),spatial=buildSpatialData(manifest,buffer);
  const groups=buildGeometryGroups(manifest,buffer,new Map([[0,material]]),spatial);
  const fast=new SceneCollision(),fallback=new SceneCollision();fast.add(groups);fallback.add(groups.map(g=>({...g,collisionIndex:null})));
  const proxy=new THREE.Mesh(groups[0].mesh.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  function brute(origin,direction,distance){
    const ray=new THREE.Raycaster(origin,direction,0,distance);let best=null;
    for(let i=0;i<groups[0].instances;i++){
      const m=groups[0].matrices.subarray(i*12,i*12+12);proxy.matrixWorld.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],-m[8],-m[9],-m[10],-m[11],0,0,0,1);
      const hits=[];proxy.raycast(ray,hits);for(const hit of hits)if(!best||hit.distance<best.distance)best=hit;
    }return best;
  }
  const down=new THREE.Vector3(0,-1,0);
  for(const x of [-11,-10,-8,-6,0,6,8,10,11,1000])for(const z of [-12,-11,-8,-5,0,5,8,11,12,-1000]){
    const origin=new THREE.Vector3(x,20,z),a=fast.cast(origin,down,60),b=fallback.cast(origin,down,60),expected=brute(origin,down,60);
    assert.equal(a?.distance??null,expected?.distance??null,`${x},${z}`);assert.equal(b?.distance??null,expected?.distance??null);
  }
  const origin=new THREE.Vector3(-8,1,30),direction=new THREE.Vector3(0,0,-1);assert.equal(fast.cast(origin,direction,80)?.distance,brute(origin,direction,80)?.distance);
  fast.add(groups);assert.equal(fast.groups.size,1);fast.remove(groups);assert.equal(fast.groups.size,0);assert.equal(fast.cells.size,0);assert.equal(fast.large.size,0);assert.equal(fast.cast(new THREE.Vector3(-8,20,8),down,60),null);
  groups[0].mesh.material.userData.atlasRole='decal';fast.add(groups);assert.equal(fast.groups.size,0);
});
