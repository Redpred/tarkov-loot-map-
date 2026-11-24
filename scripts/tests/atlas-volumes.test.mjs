import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {validateVolume,volumeBounds,clippedVolume,pointIntersectsHeight,volumeContainsPosition,volumeDisplayPosition} from '../../site/atlas-volumes.js';
import {createVolumeLayer} from '../../site/atlas-volume-layer.js';
import {attachMapVolumes,volumeSourceHash} from '../../site/atlas-volume-data.js';
import {filterModePoints} from '../../site/atlas-map-filter-data.js';
import {regionVisibleOnFloor} from '../../site/atlas-region-labels.js';
import {regionAtPosition} from '../../site/atlas-region-arrivals.js';
import {mergeMapData} from '../../site/atlas-runtime.js';

const box=(transform=p=>p)=>({type:'box',corners:[[0,0,0],[2,0,0],[2,0,4],[0,0,4],[0,6,0],[2,6,0],[2,6,4],[0,6,4]].map(transform)});
const prism={type:'prism',polygon:[{x:0,z:0},{x:4,z:0},{x:4,z:1},{x:1,z:1},{x:1,z:4},{x:0,z:4}],minY:0,maxY:6};
const almost=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const geometrySha256='1'.repeat(64);

test('full affine corner order, rotation and shear survive without coordinate swaps',()=>{
  const volume=box(([x,y,z])=>[100+x+y*.3,10+y+x*.2,-30+z-y*.4]);
  assert.equal(validateVolume(volume),volume);assert.deepEqual(volumeBounds(volume),{minY:10,maxY:16.4});
  const {faces,edges}=clippedVolume(volume);assert.equal(faces.length,6);assert.equal(edges.length,12);
  assert.deepEqual(new Set(faces.flat().map(JSON.stringify)),new Set(volume.corners.map(JSON.stringify)));
  assert.ok(volumeContainsPosition(volume,{x:101.9,y:13.2,z:-29.2}));
  assert.equal(volumeContainsPosition(volume,{x:103.7,y:10.1,z:-29}),false,'world AABB does not stand in for the transformed collider');
  assert.equal(validateVolume({type:'box',corners:volume.corners.slice(1)}),null);
  assert.equal(validateVolume({...volume,corners:volume.corners.map((p,i)=>i===6?[p[0]+1,p[1],p[2]]:p)}),null);
  assert.equal(validateVolume(box(([x,y,z])=>[x,0,z])),null);
  const negativeSize=box(([x,y,z])=>[x,-y,z]);assert.ok(validateVolume(negativeSize));assert.equal(clippedVolume(negativeSize,-4,-2).faces.length,6);
});

test('tilted volume slicing generates closed caps at both limits with no distorted corners',()=>{
  const volume=box(([x,y,z])=>[x+y*.5,y+x,z+y*.25]);
  const {faces,edges}=clippedVolume(volume,1,5);
  assert.ok(faces.every(face=>face.every(p=>p[1]>=1&&p[1]<=5)));
  assert.ok(faces.some(face=>face.every(p=>p[1]===1)));
  assert.ok(faces.some(face=>face.every(p=>p[1]===5)));
  const key=p=>p.map(n=>n.toFixed(6)).join(',');
  for(const [a,b] of edges){
    const count=faces.filter(face=>face.some((p,i)=>key(p)===key(a)&&key(face[(i+1)%face.length])===key(b)||key(p)===key(b)&&key(face[(i+1)%face.length])===key(a))).length;
    assert.equal(count,2,'every closed shell boundary belongs to two faces');
  }
  assert.deepEqual(clippedVolume(volume,20,30),{faces:[],edges:[]});
  assert.deepEqual(clippedVolume(volume,5,5),{faces:[],edges:[]});
});

test('sphere slicing retains spherical surfaces and exact horizontal circle caps',()=>{
  const sphere={type:'sphere',center:[10,4,-3],radius:5};
  const {faces}=clippedVolume(sphere,2,6);
  assert.deepEqual(volumeBounds(sphere),{minY:-1,maxY:9});
  for(const p of faces.flat()){assert.ok(p[1]>=2&&p[1]<=6);almost(Math.hypot(p[0]-10,p[1]-4,p[2]+3),5);}
  for(const y of [2,6]){const cap=faces.find(face=>face.every(p=>p[1]===y));assert.equal(cap.length,32);almost(Math.hypot(cap[0][0]-10,cap[0][2]+3),Math.sqrt(21));}
  assert.ok(volumeContainsPosition(sphere,{x:10,y:4,z:-3}));assert.ok(!volumeContainsPosition(sphere,{x:15,y:9,z:-3}));
});

test('concave manual prisms retain footprints and caps triangulate to the correct area',()=>{
  const layer=createVolumeLayer();layer.update([{id:'manual',volume:prism}],{low:1,high:3});
  const mesh=layer.group.children[0],positions=mesh.geometry.attributes.position.array;let capArea=0;
  for(let i=0;i<positions.length;i+=9){
    if([positions[i+1],positions[i+4],positions[i+7]].every(y=>y===3))capArea+=Math.abs((positions[i+3]-positions[i])*(positions[i+8]-positions[i+2])-(positions[i+6]-positions[i])*(positions[i+5]-positions[i+2]))/2;
  }
  almost(capArea,7);assert.ok(volumeContainsPosition(prism,{x:.5,y:2,z:3}));assert.ok(!volumeContainsPosition(prism,{x:3,y:2,z:3}));layer.dispose();
});

test('volume/height intersection keeps area points whose marker centers are upstairs',()=>{
  const area={id:'area',kind:'poi',position:{x:1,y:8,z:2},volumes:[box()]},item={id:'item',kind:'loose',position:{x:1,y:8,z:2}};
  const result=filterModePoints([area,item],{mode:'point',low:0,high:2,pointMatch:()=>true,valueMatch:()=>true});
  assert.deepEqual(result.visible,[area]);assert.ok(pointIntersectsHeight(area,5,8));assert.ok(!pointIntersectsHeight(area,6,8));
  assert.ok(regionVisibleOnFloor({...area,floor:'office'},'ground',0,2));
  assert.ok(!regionVisibleOnFloor(area,'all',6,10));
  assert.deepEqual(volumeDisplayPosition(area,0,2),{x:1,y:2,z:2});assert.equal(area.position.y,8);
  const tilted={...area,volumes:[box(([x,y,z])=>[x+y,y,z])]},display=volumeDisplayPosition(tilted,0,2);
  assert.deepEqual(display,{x:3,y:2,z:2});assert.ok(volumeContainsPosition(tilted.volumes[0],display));
});

test('layers deduplicate shared triggers, highlight selection, reuse geometry and flip Z only at gameWorld',()=>{
  const volume=box(),a={id:'a',volumes:[volume]},b={id:'b',volumes:[structuredClone(volume)]},layer=createVolumeLayer();
  layer.update([a,b],{selected:b});assert.equal(layer.group.children.length,2);
  const fill=layer.group.children[0];assert.equal(fill.userData.volumeEntryId,'b');assert.equal(fill.material.opacity,.17);
  layer.update([a,b],{selected:b});assert.equal(layer.group.children[0],fill);
  const world=new THREE.Group();world.scale.set(1,1,-1);world.add(layer.group);world.updateMatrixWorld(true);
  const v=new THREE.Vector3(2,6,4).applyMatrix4(fill.matrixWorld);assert.deepEqual(v.toArray(),[2,6,-4]);
  let disposed=false;fill.geometry.addEventListener('dispose',()=>{disposed=true;});layer.update([],{});assert.equal(disposed,true);assert.equal(layer.group.children.length,0);
});

test('day backgrounds use darker readable frames and lighter fills, with immediate skin-switch refresh',()=>{
  const entry={id:'area',volumes:[box()]},layer=createVolumeLayer();layer.update([entry]);
  const nightFill=layer.group.children[0],nightEdge=layer.group.children[1],nightColor=nightEdge.material.color.clone();
  layer.update([entry],{background:'#e5e7e1'});
  const dayFill=layer.group.children[0],dayEdge=layer.group.children[1];
  assert.notEqual(dayFill,nightFill);assert.ok(dayFill.material.opacity<nightFill.material.opacity);
  assert.ok(dayEdge.material.color.r<nightColor.r&&dayEdge.material.color.g<nightColor.g&&dayEdge.material.color.b<nightColor.b);
  assert.ok(dayEdge.material.opacity>nightEdge.material.opacity);
  layer.dispose();
});

async function fixture(){
  const poi={points:[{id:'poi',kind:'poi',position:{x:1,y:3,z:2},outline:[{x:0,y:0,z:0}]}],sources:{spt:{eftBuild:47965}}};
  const quests={points:[{id:'quest',kind:'poi',quest:true,position:{x:1,y:3,z:2}}],sources:{spt:{eftBuild:47965}}};
  const regions={labels:[{id:'building',kind:'area',position:{x:1,y:3,z:2},arrival:{radius:100,minY:-100,maxY:100}}]};
  const data=mergeMapData({points:[],items:{}},poi,quests);
  const general={version:1,mapId:'factory',eftBuild:47965,baseSha256:await volumeSourceHash(poi),regionBaseSha256:await volumeSourceHash(regions),regionGeometrySha256:geometrySha256,points:{poi:[box()]},regions:{building:[prism]}};
  const task={version:1,mapId:'factory',eftBuild:47965,baseSha256:await volumeSourceHash(quests),points:{quest:[box()]},regions:{}};
  return {data,regions,general,task};
}
const fetcherFor=(general,task)=>async url=>({ok:true,status:200,json:async()=>url.includes('/tasks/')?task:general});

test('sidecars bind both prepared merged sources and regions without overwriting positions or indices',async()=>{
  const {data,regions,general,task}=await fixture(),original=data.points[0],position=structuredClone(original.position),warnings=[];
  assert.deepEqual(await attachMapVolumes({mapId:'factory',data,regions,geometrySha256,fetcher:fetcherFor(general,task),warn:(...args)=>warnings.push(args)}),{points:2,regions:1});
  assert.equal(data.points[0],original);assert.deepEqual(data.points[0].position,position);assert.equal(data.points[1].volumes.length,1);assert.equal(warnings.length,0);
  assert.equal(regionAtPosition(regions.labels,{x:.5,y:2,z:3})?.id,'building');
  assert.equal(regionAtPosition(regions.labels,{x:3,y:2,z:3}),null,'verified footprint replaces the broad proximity circle');
});

test('building volumes reject changed model geometry even when labels and point source match',async()=>{
  const {data,regions,general,task}=await fixture(),warnings=[];
  const result=await attachMapVolumes({mapId:'factory',data,regions,geometrySha256:'2'.repeat(64),fetcher:fetcherFor(general,task),warn:m=>warnings.push(m)});
  assert.equal(result.points,2);assert.equal(result.regions,0);assert.equal(warnings.length,1);assert.equal(regions.labels[0].volumes,undefined);
});

test('sidecars reject wrong source hashes, build, map and malformed volumes while absent optional files stay quiet',async()=>{
  for(const patch of [{baseSha256:'0'.repeat(64)},{eftBuild:1},{mapId:'woods'},{version:2},{points:[]}]){
    const {data,regions,general,task}=await fixture(),warnings=[];Object.assign(general,patch);
    const result=await attachMapVolumes({mapId:'factory',data,regions,fetcher:fetcherFor(general,task),warn:m=>warnings.push(m)});
    assert.equal(result.points,1);assert.equal(result.regions,0);assert.equal(data.points[0].volumes,undefined);assert.ok(data.points[0].outline);assert.equal(warnings.length,1);
  }
  const {data,regions,general,task}=await fixture(),warnings=[];general.points.poi=[{type:'box',corners:[[NaN,0,0]]}];general.regionBaseSha256='wrong';
  const result=await attachMapVolumes({mapId:'factory',data,regions,fetcher:fetcherFor(general,task),warn:m=>warnings.push(m)});assert.equal(result.points,1);assert.equal(result.regions,0);assert.equal(warnings.length,2);
  const fresh=await fixture();warnings.length=0;
  assert.deepEqual(await attachMapVolumes({...fresh,mapId:'factory',fetcher:async()=>({status:404}),warn:m=>warnings.push(m)}),{points:0,regions:0});assert.equal(warnings.length,0);
  assert.deepEqual(await attachMapVolumes({...fresh,mapId:'factory',fetcher:async()=>({status:500,ok:false}),warn:m=>warnings.push(m)}),{points:0,regions:0});assert.equal(warnings.length,2);
});
