import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {createHeightRange,heightPresetsFor,heightPresetAbove} from '../../site/atlas-height-range.js';
import {filterModePoints} from '../../site/atlas-map-filter-data.js';
import {regionVisibleOnFloor} from '../../site/atlas-region-labels.js';

const read=path=>JSON.parse(fs.readFileSync(new URL('../../site/'+path,import.meta.url)));

test('requested presets are exact, ordered and cumulative inside each real model range; all other maps have only all',()=>{
  const expected={factory:[['三层',10.4],['二层',6.85],['一层',3.28],['地下',-.86]],interchange:[['二楼',39.45],['一楼',30.2],['室外与车库',25.1]],reserve:[['三楼',1.62],['二楼',-1.47],['一楼',-4.25],['地下上层',-8.58],['地下中心',-11.98]]};
  for(const map of Object.values(ATLAS_MAPS)){
    const presets=heightPresetsFor(map.id),range=createHeightRange(read(map.geometry).bounds);
    assert.deepEqual(presets.map(p=>[p.name,p.max]),expected[map.id]||[],map.id);
    for(const preset of presets)assert.deepEqual(range.bounds(range.preset(preset)),{low:range.min,high:preset.max});
    assert.equal(range.preset(),range.max);
    assert.equal(heightPresetAbove(presets,range.max),undefined);
    for(const preset of presets){
      assert.equal(heightPresetAbove(presets,preset.max-.01)?.id,preset.id);
      const next=heightPresetAbove(presets,preset.max);
      assert.ok(!next||next.max>preset.max,'exiting first person never clips the player at a boundary');
    }
  }
});

test('all 13 maps use complete retained model bounds for the slider, all preset and custom cuts',()=>{
  for(const map of Object.values(ATLAS_MAPS)){
    const manifest=read(map.geometry),range=createHeightRange(manifest.bounds);
    assert.equal(range.min,manifest.bounds.min[1],map.id);
    assert.equal(range.max,manifest.bounds.max[1],map.id);
    assert.deepEqual(range.bounds(range.preset()),{low:manifest.bounds.min[1],high:manifest.bounds.max[1]},`${map.id}: all`);
    for(const band of [null,...map.heightBands]){
      const cut=range.preset(band),bounds=range.bounds(cut);
      assert.equal(bounds.low,manifest.bounds.min[1],`${map.id}: ${band?.id||'all'}`);
      assert.ok(bounds.high>=bounds.low&&bounds.high<=manifest.bounds.max[1]);
    }
    for(const cut of [range.min-100,range.min,range.min+.123456,range.max,range.max+100]){
      assert.equal(range.bounds(cut).low,range.min);
      assert.ok(range.bounds(cut).high>=range.min);
      assert.ok(range.bounds(cut).high<=range.max);
      assert.equal(range.bounds(cut,true).low,range.min);
      assert.ok(range.bounds(cut,true).high>manifest.bounds.max[1]);
    }
  }
});

test('ground and higher presets retain lower selected points in both filtering modes',()=>{
  const map=ATLAS_MAPS.factory,data=read(map.data),range=createHeightRange(read(map.geometry).bounds);
  const ground=map.heightBands.find(b=>b.id==='ground');
  for(const mode of ['point','value']){
    const filter=bounds=>filterModePoints(data.points,{mode,...bounds,pointMatch:()=>true,valueMatch:()=>true}).visible;
    const selected=filter(range.bounds(range.preset(ground)));
    assert.ok(selected.some(p=>p.position.y<ground.min),'ground preset includes basement points');
    const old=filter({low:ground.min,high:ground.max});
    assert.ok(selected.length>old.length);
    let previous=new Set();
    for(const cut of [range.min,-.75,3.25,6.75,10,range.max]){
      const points=filter(range.bounds(cut)),ids=new Set(points.map(p=>p.id));
      for(const id of previous)assert.ok(ids.has(id),'raising upper cut must not drop lower points');
      assert.ok(points.every(p=>p.position.y>=range.min&&p.position.y<cut));
      previous=ids;
    }
  }
});

test('height limits remove empty old slider ranges without truncating lower retained models',()=>{
  const ice=createHeightRange(read(ATLAS_MAPS.icebreaker.geometry).bounds);
  assert.ok(ice.min>0);assert.equal(ice.clamp(-80),ice.min);
  assert.equal(ATLAS_MAPS.icebreaker.heightBands.filter(b=>b.max>ice.min).some(b=>b.id==='underground'),false);
  const woods=createHeightRange(read(ATLAS_MAPS.woods.geometry).bounds);
  assert.ok(woods.min<ATLAS_MAPS.woods.minHeight,'retain real geometry below the old manual minimum');
  const factory=createHeightRange(read(ATLAS_MAPS.factory.geometry).bounds);
  assert.equal(factory.clamp(3.25),3.25,'fractional model minimum must not shift an exact preset');
  assert.throws(()=>createHeightRange({}),/高度范围/);
});

test('model maxima trim empty top margins and expand old ceilings that cut off retained buildings',()=>{
  for(const id of ['factory','icebreaker','streets','ground_zero']){
    const map=ATLAS_MAPS[id],bounds=read(map.geometry).bounds,range=createHeightRange(bounds);
    assert.equal(range.clamp(range.max+1000),bounds.max[1]);
    assert.equal(range.preset({max:range.max+1000}),bounds.max[1]);
    assert.equal(range.bounds(range.preset()).high,bounds.max[1]);
    assert.equal(range.max>map.maxHeight,['streets','ground_zero'].includes(id));
  }
  for(const bounds of [{min:[0,1,0]},{min:[0,1,0],max:[0,NaN,0]},{min:[0,1,0],max:[0,0,0]}])assert.throws(()=>createHeightRange(bounds),/高度范围/);
});

test('height-only region labels keep basement context under ground and upper presets',()=>{
  const map=ATLAS_MAPS.factory,range=createHeightRange(read(map.geometry).bounds);
  const labels=read('data/factory-regions.json').labels;
  const basement=labels.find(l=>l.en==='Underground Stash'),office=labels.find(l=>l.en==='Main Office');
  const ground=range.bounds(3.25),upper=range.bounds(40);
  assert.equal(regionVisibleOnFloor(basement,'all',ground.low,ground.high),true);
  assert.equal(regionVisibleOnFloor(basement,'all',upper.low,upper.high),true);
  assert.equal(regionVisibleOnFloor(office,'all',ground.low,ground.high),false);
  assert.equal(regionVisibleOnFloor(office,'all',upper.low,upper.high),true);
});
