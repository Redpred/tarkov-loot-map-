import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {validateBuildingCuts,createCutPlan,presetForCutPoint,defaultCutPresets,CUT_GRID} from '../../site/atlas-building-cuts.js';
import {createBuildingCutView} from '../../site/atlas-building-cut-view.js';
import {createBuildingCutUniforms} from '../../site/atlas-building-cut-shader.js';
import {filterModePoints} from '../../site/atlas-map-filter-data.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
const region=(id,minX,maxX,high,extra={})=>({id,name:id,minX,maxX,minZ:0,maxZ:10,cuts:{first:high},...extra});
const profile=regions=>({version:1,map:'test',geometrySha256:'abc',presets:defaultCutPresets(),regions});

test('one floor preset preserves each building elevation and leaves outdoor terrain intact',()=>{
  const view=createBuildingCutView();view.set(profile([region('low',0,10,3),region('hill',20,30,23)]),'first');
  const points=[{id:'low-floor',position:{x:5,y:2,z:5}},{id:'low-roof',position:{x:5,y:7,z:5}},{id:'hill-floor',position:{x:25,y:22,z:5}},{id:'hill-roof',position:{x:25,y:27,z:5}},{id:'outdoors',position:{x:40,y:30,z:5}}];
  for(const mode of ['point','value'])assert.deepEqual(filterModePoints(points,{mode,low:-50,high:100,pointMatch:()=>true,valueMatch:()=>true,heightTest:view.visible}).visible.map(p=>p.id),['low-floor','hill-floor','outdoors']);
  view.set(null,null);assert.equal(points.filter(p=>view.visible(p,-50,100)).length,5,'all and first-person restore full height');
});
test('nested edits and smaller regions use deterministic priority rather than minimum of all cuts',()=>{
  const plan=createCutPlan(profile([region('large',0,30,3),region('small',5,10,8)]),'first');
  assert.equal(plan.highAt({x:7,z:5},100),8);assert.equal(plan.highAt({x:20,z:5},100),3);
  const edited=createCutPlan(profile([region('large',0,30,5,{edited:true}),region('small',5,10,8)]),'first');assert.equal(edited.highAt({x:7,z:5},100),5);
});
test('door navigation selects floors at the target building elevation and preserves a visible preset',()=>{
  const p=profile([region('low',0,10,3),region('hill',20,30,23,{cuts:{first:23,second:26}})]);
  assert.equal(presetForCutPoint(p,{x:25,y:22,z:5}),'first');
  assert.equal(presetForCutPoint(p,{x:25,y:24,z:5}),'second');
  assert.equal(presetForCutPoint(p,{x:25,y:22,z:5},'second'),'second');
  assert.equal(presetForCutPoint(p,{x:40,y:22,z:5}),null);
});
test('cross-boundary task volumes keep visible pieces and place their marker on a visible cap',()=>{
  const view=createBuildingCutView();view.set(profile([region('left',0,5,2),region('right',5,10,6)]),'first');
  const volume={type:'prism',polygon:[{x:1,z:1},{x:9,z:1},{x:9,z:9},{x:1,z:9}],minY:3,maxY:8};
  const point={position:{x:3,y:7,z:5},volumes:[volume]};
  assert.equal(view.visible(point,-50,100),true);
  const clipped=view.clip(volume,-50,100);assert.ok(clipped.faces.length);
  for(const p of clipped.faces.flat())assert.ok(p[0]>=5-1e-6&&p[1]<=6+1e-6&&p[1]>=3-1e-6);
  const p=view.position(point,-50,100);assert.ok(p.x>=5&&p.x<=9&&p.y<=6);assert.ok(view.highAt(p,100)>=p.y);
  view.set(profile([region('both',0,10,2)]),'first');assert.equal(view.visible(point,-50,100),false);
});
test('a full-height edited building can opt out of a surrounding area cut',()=>{
  const view=createBuildingCutView(),point={position:{x:7,y:15,z:5}};
  view.set(profile([region('area',0,30,3),region('building',5,10,100,{edited:true})]),'first');
  assert.equal(view.visible(point,-50,100),true);
  assert.equal(view.visible({position:{x:20,y:15,z:5}},-50,100),false);
});
test('overlapping profile limits fail explicitly instead of truncating GPU candidates',()=>{
  assert.throws(()=>createCutPlan(profile(Array.from({length:129},(_,i)=>region('r'+i,0,10,i))),'first'),/重叠/);
});
test('profile imports reject different maps, source versions, nonfinite cuts and inverted bounds',()=>{
  const valid=profile([region('a',0,10,3)]),identity={map:'test',geometrySha256:'abc'};
  assert.equal(validateBuildingCuts(valid,identity).regions.length,1);
  for(const data of [{...valid,map:'other'},{...valid,geometrySha256:'old'},profile([region('a',10,0,3)]),profile([region('a',0,10,NaN)]),profile([region('a',0,10,3),region('a',10,20,3)])])assert.throws(()=>validateBuildingCuts(data,identity));
});
test('all 13 seed maps bind current geometry, stay finite and include editable first-floor areas',()=>{
  for(const map of Object.values(ATLAS_MAPS)){
    const manifest=read('site/'+map.geometry),p=validateBuildingCuts(read(`site/data/building-cuts/${map.id}.json`),{map:map.id,geometrySha256:manifest.sourceGeometrySha256||manifest.sha256});
    assert.ok(p.regions.some(r=>Number.isFinite(r.cuts.first)),map.id);
    for(const preset of p.presets)assert.doesNotThrow(()=>createCutPlan(p,preset.id));
    for(const r of p.regions)for(const h of Object.values(r.cuts))assert.ok(h>=manifest.bounds.min[1]&&h<=manifest.bounds.max[1],`${map.id}/${r.name}: ${h}`);
  }
});
test('building seeds exclude aeration soil and do not label explicit basement shells as first floor',()=>{
  for(const map of Object.values(ATLAS_MAPS))for(const r of read(`site/data/building-cuts/${map.id}.json`).regions){
    const names=r.source?.structureNames;
    if(!names?.length)continue;
    assert.ok(!names.every(n=>/^Lighthouse_Aeration_Soil_/i.test(n)),`${map.id}/${r.id}: outdoor soil must not become a house`);
    if(names.every(n=>/basement|underground/i.test(n)))assert.equal(r.cuts.first,undefined,`${map.id}/${r.id}: explicit underground geometry`);
  }
});
test('GPU lookup tables match independent CPU region containment including Unity Z reversal',()=>{
  const data=read('site/data/building-cuts/reserve.json'),plan=createCutPlan(data,'first'),gpu=createBuildingCutUniforms();gpu.set(plan,true);const u=gpu.uniforms;
  const shaderLookup=(x,viewZ)=>{
    const z=-viewZ,b=u.buildingCutBounds.value;if(x<b.x||z<b.y||x>b.z||z>b.w)return 1000;
    const cx=Math.min(CUT_GRID-1,Math.floor((x-b.x)/(b.z-b.x)*CUT_GRID)),cz=Math.min(CUT_GRID-1,Math.floor((z-b.y)/(b.w-b.y)*CUT_GRID)),c=u.buildingCutCells.value.image.data,ids=u.buildingCutIds.value.image.data,r=u.buildingCutRects.value.image.data,offset=(cz*CUT_GRID+cx)*4;
    for(let i=0;i<c[offset+1];i++){const id=ids[(c[offset]+i)*4],k=id*8;if(x>=r[k]&&z>=r[k+1]&&x<=r[k+2]&&z<=r[k+3])return r[k+4];}return 1000;
  };
  for(let x=-290;x<300;x+=7.137)for(let z=-270;z<220;z+=9.127)assert.ok(Math.abs(shaderLookup(x,-z)-plan.highAt({x,z},1000))<1e-4);
  assert.ok(plan.highAt({x:-8,z:180},1000)>20,'hilltop Dome remains above low buildings');assert.ok(plan.highAt({x:-65,z:-30},1000)<0,'medical building uses its own elevation');gpu.dispose();
});
