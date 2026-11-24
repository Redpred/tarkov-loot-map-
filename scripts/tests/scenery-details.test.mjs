import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {decorationFamily,smallDecoration,filterGeometry,validateSpans,readFilteredRange} from '../lib/scenery-details.mjs';
import {classifyDecorations} from '../build-scenery-details.mjs';
import {verifyRetainedGeometry} from '../verify-scenery-details.mjs';
import {digest,manifestDigest,bytesOf} from '../lib/geometry-quality.mjs';
import {SCENERY_DETAILS_KEY,readSceneryMode,saveSceneryMode,sceneryEndpoint,loadSceneryDetails} from '../../site/atlas-scenery-details.js';

const map={id:'factory',geometry:'data/atlas/factory-geometry.json',textureBase:'data/atlas/',endpoint:'api/factory-geometry'};
const identity=(x=0)=>[1,0,0,x,0,1,0,0,0,0,1,0];
function fixture(specifications){
  let offset=0;const parts=[],meshes=[];
  const add=value=>{const start=offset,raw=bytesOf(value);parts.push(raw);offset+=raw.length;return start;};
  for(let id=0;id<specifications.length;id++){
    const spec=specifications[id],boxes=spec.boxes||[[0,0,0,1,.1,1]],matrices=spec.matrices||boxes.map((_,n)=>identity(n));
    const mesh={name:spec.name,material:spec.material??id,vertices:4,indices:6,instances:boxes.length,rendererSources:['fixture'],sourceFaceStart:0,sourceFaceCount:2,
      positionOffset:add(Float32Array.from([0,0,0,1,0,0,1,0,1,0,0,1])),uvOffset:add(Float32Array.from([0,0,1,0,1,1,0,1]))};
    if(spec.paint!==false)mesh.paintOffset=add(Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,128,128,0,255]));
    if(spec.index16){mesh.indexComponentType='uint16';mesh.indexOffset=add(Uint16Array.from([0,1,2,0,2,3]));}
    else mesh.indexOffset=add(Uint32Array.from([0,1,2,0,2,3]));
    mesh.matrixOffset=add(Float32Array.from(matrices.flat()));mesh.boundsOffset=add(Float32Array.from(boxes.flat()));meshes.push(mesh);
  }
  const raw=Buffer.concat(parts),manifest={schemaVersion:1,binary:'factory-geometry.bin',sha256:digest(raw),sceneSha256:'a'.repeat(64),bounds:{min:[-3,-1,-3],max:[8,4,8]},coordinateSystem:'Unity XYZ',viewerTransform:{flipZ:true},materials:specifications.map((_,id)=>({tex:'texture'+id})),textures:{},meshes,stats:{bytes:raw.length}};
  return {raw,manifest};
}

async function classifyFixture(t,specifications,alterRows=rows=>rows){
  const f=fixture(specifications),rows=[];
  for(let i=0;i<specifications.length;i++){
    const spec=specifications[i],mesh=f.manifest.meshes[i],matrices=spec.matrices||(spec.boxes||[[0,0,0,1,.1,1]]).map((_,n)=>identity(n));
    for(const matrix of matrices)rows.push({mesh:mesh.name,m:[...matrix,0,0,0,1],gameObjectName:spec.objectName||mesh.name.split('__')[0],root:spec.root||'MapFloor'});
  }
  const sceneRaw=Buffer.from(JSON.stringify({instances:alterRows(rows)}));f.manifest.sceneSha256=digest(sceneRaw);
  const work=path.resolve('work');await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'scenery-details-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),work);assert.ok(path.basename(root).startsWith('scenery-details-test-'));await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'data/atlas'),{recursive:true});
  const sceneFile=path.join(root,'scene.json');await fs.writeFile(sceneFile,sceneRaw);await fs.writeFile(path.join(root,'data/atlas/factory-geometry.bin'),f.raw);
  return {root,f,sceneFile,result:await classifyDecorations({root,map,manifest:f.manifest,sceneFile})};
}

test('only explicitly evidenced small prop families are eligible; structural, generic and interactive names remain',()=>{
  for(const name of ['paper_1__mesh.obj','Paper23_lod0__mesh.obj','Bottle_Baltika_1__x.obj','Wine_Bottle_Broken_2__x.obj','Brick_broken_set_2__x.obj','Reserve_Road_Garbage_A_lod1__x.obj','Garbage_set_02__x.obj'])assert.ok(decorationFamily(name),name);
  for(const name of ['0__534_3_1020.obj','Cube__x.obj','paper_wall_1__x.obj','PaperContainer_1__x.obj','Garbage_container_1__x.obj','garbage_mix4_set_cover__x.obj','BrickWall_1__x.obj','broken_floor__x.obj','terrain_background__x.obj','tree_1__x.obj','chair_1__x.obj','sign_1__x.obj','loot_bottle_1__x.obj','quest_paper_1__x.obj','Barrel_1__x.obj'])assert.equal(decorationFamily(name),null,name);
  const rule=decorationFamily('paper_1');assert.ok(smallDecoration(rule,[0,0,0,1,.1,1]));
  for(const box of [[0,0,0,1,.4,1],[0,0,0,5,.1,1],[0,0,0,-1,.1,1],[0,0,0,1,NaN,1],[0,0,0,1,Infinity,1],[0,1]])assert.equal(smallDecoration(rule,box),false);
});

test('visually ambiguous slab and frame families always remain; taller box piles and larger rubble exceed conservative limits',async t=>{
  for(const name of ['Debris_Concrete_01__reviewed.obj','debris_concrete_02_lod1__reviewed.obj','glass_debris__reviewed.obj','glass_debris_lod0__reviewed.obj'])assert.equal(decorationFamily(name),null,name);
  const fragment=decorationFamily('Brick_broken_set_1');
  assert.ok(smallDecoration(fragment,[0,0,0,1,.2,1]));
  for(const box of [[0,0,0,1.61,.1,.5],[0,0,0,1,.46,.5],[0,0,0,1.5,.3,1]])assert.equal(smallDecoration(fragment,box),false,'length, height and volume each protect larger fragments');
  const litter=decorationFamily('goshan_garbage_10');
  assert.ok(smallDecoration(litter,[0,0,0,1,.4,1]));assert.equal(smallDecoration(litter,[0,0,0,1,.46,1]),false);
  const {result}=await classifyFixture(t,[
    {name:'Debris_Concrete_01__reviewed.obj',boxes:[[0,0,0,.1,.1,.1]]},
    {name:'glass_debris__reviewed.obj',boxes:[[0,0,0,.1,.1,.1]]},
    {name:'goshan_garbage_10__stack.obj',boxes:[[0,0,0,1,.1,1],[2,0,0,3,.6,1]]},
    {name:'Bricks_Rubble__large.obj',boxes:[[0,0,0,1.7,.1,1]]},
    {name:'plaster_debris_group_1__large.obj',boxes:[[0,0,0,1.5,.3,1]]},
    {name:'Brick_broken_1__small.obj',boxes:[[0,0,0,1,.1,1]]},
  ]);
  assert.deepEqual([...result.removed],['Brick_broken_1__small.obj']);
  assert.equal(result.audit.find(row=>row.name==='goshan_garbage_10__stack.obj').oversized,1,'a taller pile retains every instance of its named mesh');
});

test('classification combines every material part before checking object size',async t=>{
  const {result}=await classifyFixture(t,[{name:'paper_1__union.obj',boxes:[[0,0,0,1,.1,1]]},{name:'paper_1__union.obj',boxes:[[0,.25,0,1,.4,1]]},{name:'paper_2__small.obj',boxes:[[0,0,0,1,.1,1]]}]);
  const large=result.audit.find(row=>row.name==='paper_1__union.obj');assert.equal(large.objects,1);assert.equal(large.groups,2);assert.equal(large.oversized,1);assert.equal(large.exclude,false);
  assert.deepEqual([...result.removed],['paper_2__small.obj']);
});

test('one unknown, protected or oversized instance retains the entire same named mesh family',async t=>{
  const names=['paper_1__unknown.obj','paper_2__protected.obj','paper_3__oversized.obj','paper_4__allowed.obj'];
  const {result}=await classifyFixture(t,[
    {name:names[0],boxes:[[0,0,0,1,.1,1],[2,0,0,3,.1,1]]},
    {name:names[1],boxes:[[0,0,0,1,.1,1],[2,0,0,3,.1,1]]},
    {name:names[2],boxes:[[0,0,0,1,.1,1],[2,0,0,7,.1,1]]},
    {name:names[3]},
  ],rows=>rows.filter(row=>!(row.mesh===names[0]&&row.m[3]===1)).map(row=>row.mesh===names[1]&&row.m[3]===1?{...row,gameObjectName:'quest_paper'}:row));
  assert.deepEqual([...result.removed],[names[3]]);
  assert.equal(result.audit.find(row=>row.name===names[0]).unmatched,1);
  assert.equal(result.audit.find(row=>row.name===names[1]).protectedObjects,1);
  assert.equal(result.audit.find(row=>row.name===names[2]).oversized,1);
});

test('functional scene roots and structural renderer names protect props; stale scene provenance is rejected',async t=>{
  const {root,f,sceneFile,result}=await classifyFixture(t,[{name:'paper_1__x.obj',root:'loot_interactive_group'},{name:'paper_2__x.obj',objectName:'floor_piece'},{name:'paper_3__x.obj',root:'Floor_2'}]);
  assert.deepEqual([...result.removed],['paper_3__x.obj']);
  await fs.appendFile(sceneFile,' ');
  await assert.rejects(classifyDecorations({root,map,manifest:f.manifest,sceneFile}),/Scene metadata source mismatch/);
});

test('filtering preserves exact coordinates, UVs, paint, indices, transforms, bounds and material metadata in compact ranges',()=>{
  const source=fixture([{name:'wall',index16:true,paint:false},{name:'paper_1__remove',material:2},{name:'floor',boxes:[[0,0,0,1,.1,1],[2,0,0,3,.1,1]]},{name:'paper_2__remove',paint:false},{name:'ladder',index16:true}]);
  const removed=new Set(['paper_1__remove','paper_2__remove']),original=Buffer.from(source.raw),metadata=structuredClone(source.manifest);
  const result=filterGeometry(source.manifest,source.raw,removed);
  validateSpans(result.spans,result.bytes.length,source.raw.length);
  assert.ok(Buffer.concat(result.spans.map(([,start,length])=>source.raw.subarray(start,start+length))).equals(result.bytes));
  verifyRetainedGeometry(source.manifest,source.raw,result.manifest,result.bytes,removed);
  assert.deepEqual(result.omitted,[1,3]);assert.deepEqual(result.manifest.materialIds,[0,2,4]);
  assert.ok(source.raw.equals(original));assert.deepEqual(source.manifest,metadata,'source not modified');
  const corrupted=Buffer.from(result.bytes);corrupted[result.manifest.meshes[1].matrixOffset]^=1;
  assert.throws(()=>verifyRetainedGeometry(source.manifest,source.raw,result.manifest,corrupted,removed),/exact retained matrices/);
});

test('unchanged chunks keep exact bytes and original cache route, even with trailing padding',()=>{
  const source=fixture([{name:'wall',paint:false}]);source.raw=Buffer.concat([source.raw,Buffer.alloc(4,9)]);source.manifest.sha256=digest(source.raw);source.manifest.stats.bytes=source.raw.length;
  const result=filterGeometry(source.manifest,source.raw,new Set());assert.equal(result.bytes,source.raw);assert.equal(result.manifest.sha256,source.manifest.sha256);assert.deepEqual(result.spans,[[0,0,source.raw.length]]);
  verifyRetainedGeometry(source.manifest,source.raw,result.manifest,result.bytes,new Set());
  assert.equal(sceneryEndpoint('/api/factory-geometry/medium/simple',{decorationFilter:{removedMeshes:0}}),'/api/factory-geometry/medium');
  assert.equal(sceneryEndpoint('/api/woods-geometry/simple/s_0_0',{decorationFilter:{removedMeshes:2}}),'/api/woods-geometry/simple/s_0_0');
});

test('malformed overlapping, truncated and unsupported mesh spans fail closed',()=>{
  const source=fixture([{name:'wall'},{name:'paper_1'}]);
  for(const corrupt of [m=>m.meshes[0].uvOffset=0,m=>m.meshes[0].positionOffset=1,m=>m.meshes[1].positionOffset=0,m=>m.meshes[1].boundsOffset=source.raw.length]){
    const manifest=structuredClone(source.manifest);corrupt(manifest);assert.throws(()=>filterGeometry(manifest,source.raw,new Set(['paper_1'])),/layout|Overlapping|truncated/);
  }
  for(const [spans,total,size] of [[[[1,0,8]],8,16],[[[0,0,8],[8,4,8]],16,16],[[[0,-1,8]],8,16],[[[0,12,8]],8,16],[[[0,0,0]],8,16],[[[0,0,4]],8,16],[[[0,0,8.5]],8,16],[[[0,0,8,1]],8,16],[[[0,0,8]],8,4],[[[0,0,8]],0,16]])assert.throws(()=>validateSpans(spans,total,size),/Invalid|Incomplete/);
});

test('random-access range reading crosses gaps, handles short source reads and catches truncation',async()=>{
  const source=Buffer.from('0123456789abcdefghijklmnop'),spans=[[0,0,4],[4,9,6],[10,22,4]],expected=Buffer.from('01239abcde mnop'.replace(' ',''));
  validateSpans(spans,14,source.length);
  const handle={async read(output,destination,length,position){const count=Math.min(length,2,source.length-position);source.copy(output,destination,position,position+count);return {bytesRead:count};}};
  for(const [offset,length] of [[0,14],[2,9],[9,8],[13,10]])assert.ok((await readFilteredRange(handle,spans,offset,length,14)).equals(expected.subarray(offset,offset+length)));
  await assert.rejects(readFilteredRange({read:async()=>({bytesRead:0})},spans,0,1,14),/Incomplete source read/);
});

test('scenery preference defaults to full, survives storage failures and rejects unexpected values',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(readSceneryMode(storage),'full');assert.equal(saveSceneryMode('simple',storage),true);assert.equal(values.get(SCENERY_DETAILS_KEY),'simple');assert.equal(readSceneryMode(storage),'simple');
  values.set(SCENERY_DETAILS_KEY,'unknown');assert.equal(readSceneryMode(storage),'full');
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};assert.equal(readSceneryMode(blocked),'full');assert.equal(saveSceneryMode('simple',blocked),false);
});

function selectionFixture(streamed=false){
  const f=fixture([{name:'wall'},{name:'paper_1'}]),out=filterGeometry(f.manifest,f.raw,new Set(['paper_1'])),quality='medium';
  const source=streamed?{...f.manifest,sectors:[{id:'s_0_0',file:'sectors/s_0_0.json',sha256:f.manifest.sha256,bounds:f.manifest.bounds,materialIds:[0,1],stats:f.manifest.stats}]}:f.manifest;
  const hash=manifestDigest(source),detail={...out.manifest,decorationFilter:{recipeVersion:1,sourceManifestSha256:hash,sourceGeometrySha256:f.manifest.sha256,sourceBytes:f.raw.length,removedMeshes:1,spans:out.spans}};
  const manifest=streamed?{...source,sectors:[{...detail,id:'s_0_0',file:'sectors/s_0_0.json'}],decorationFilter:{recipeVersion:1,sourceManifestSha256:hash}}:detail;
  const catalog={schemaVersion:1,recipeVersion:1,mapId:map.id,sceneSha256:source.sceneSha256,sourceManifestSha256:hash,variants:{[quality]:{file:quality+'/manifest.json',sourceManifestSha256:hash,manifestSha256:manifestDigest(manifest),runtime:{geometry:{}},stats:{bytes:out.bytes.length}}}};
  const geometry={manifest:source,quality,base:'/data/geometry-quality/factory/medium/',endpoint:'/api/factory-geometry/medium'};
  return {source,manifest,catalog,geometry,map:{...map,streamed},fetcher:async url=>({ok:true,json:async()=>String(url).endsWith('/medium/manifest.json')?manifest:catalog})};
}

test('selector binds derived scene to selected tier and exact manifest; stale or missing assets fall back to full',async()=>{
  for(const streamed of [false,true]){
    const valid=selectionFixture(streamed);const chosen=await loadSceneryDetails(valid.geometry,valid.map,'simple',{fetcher:valid.fetcher});assert.equal(chosen.scenery,'simple');assert.equal(chosen.manifest,valid.manifest);assert.equal(chosen.endpoint,'/api/factory-geometry/medium/simple');
    let requested=false;const full=await loadSceneryDetails(valid.geometry,valid.map,'full',{fetcher:()=>{requested=true;throw Error();}});assert.equal(full.scenery,'full');assert.equal(requested,false);
    for(const change of [f=>f.catalog.mapId='other',f=>f.catalog.sceneSha256='b'.repeat(64),f=>f.catalog.variants.medium.sourceManifestSha256='b'.repeat(64),f=>f.catalog.variants.medium.file='../manifest.json',f=>f.manifest.bounds.min[0]-=1]){
      const f=selectionFixture(streamed);change(f);const result=await loadSceneryDetails(f.geometry,f.map,'simple',{fetcher:f.fetcher});assert.equal(result.scenery,'full');assert.equal(result.manifest,f.source);assert.match(result.sceneryWarning,/完整场景/);
    }
    const unavailable=await loadSceneryDetails(valid.geometry,valid.map,'simple',{fetcher:async()=>({ok:false,status:404})});assert.equal(unavailable.scenery,'full');assert.match(unavailable.sceneryReason,/404/);
  }
});

test('selector rejects modified associations, partition bounds and duplicate IDs even when derived fingerprint is refreshed',async()=>{
  for(const change of [f=>f.manifest.materials=[{tex:'other'}],f=>f.manifest.viewerTransform={flipZ:false},f=>f.manifest.sectors[0].bounds={min:[0,0,0],max:[1,1,1]},f=>f.manifest.sectors.push(structuredClone(f.manifest.sectors[0])),f=>f.manifest.sectors[0].decorationFilter.sourceGeometrySha256='c'.repeat(64)]){
    const f=selectionFixture(true);change(f);f.catalog.variants.medium.manifestSha256=manifestDigest(f.manifest);
    const result=await loadSceneryDetails(f.geometry,f.map,'simple',{fetcher:f.fetcher});assert.equal(result.scenery,'full');assert.match(result.sceneryWarning,/完整场景/);
  }
});
