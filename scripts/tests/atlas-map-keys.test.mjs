import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildMapKeyIndex,keyDoorView,mapKeySelectionKey,selectedKeyDoorIds,selectedKeyPointIds} from '../../site/atlas-map-keys.js';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {mergeMapData} from '../../site/atlas-runtime.js';
import {createPointSelection,createPointUnionMatcher,checkboxState} from '../../site/atlas-point-selection.js';
import {filterModePoints} from '../../site/atlas-map-filter-data.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
const door=(id,keyId,position={x:1,y:2,z:3},extra={})=>({id,keyId,position,kind:'poi',poiTypes:['locked_door'],...extra});
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));

test('key selection includes positive loose candidates, container pools, forced and nested contents only at valid active positions',()=>{
  const loot=(id,extra={})=>({id,kind:'loose',position:{x:1,y:0,z:1},candidates:[{tpl:'a',weight:1}],...extra});
  const data={pools:{shared:{items:[{tpl:'a',weight:2},{tpl:'b',weight:3}]}},points:[
    door('door-a','a'),door('door-b','b'),loot('loose'),
    loot('pool1',{kind:'container',pool:'shared'}),loot('pool2',{kind:'container',pool:'shared'}),
    loot('forced',{kind:'container',pool:'empty',forcedItems:[{tpl:'a'}]}),
    loot('nested',{candidates:[{tpl:'bag',weight:1,included:[{tpl:'a'}]}]}),
    loot('zero',{candidates:[{tpl:'a',weight:0}]}),loot('negative',{candidates:[{tpl:'a',weight:-1}]}),
    loot('zero-parent',{candidates:[{tpl:'bag',weight:0,included:[{tpl:'a'}]}]}),
    loot('inactive',{active:false}),loot('outside',{outsideClientEnvelope:true}),loot('invalid',{position:{x:NaN,y:0,z:0}}),
    loot('no-position',{position:null}),loot('quest',{kind:'poi',poiTypes:['quest_item'],itemId:'a'}),
    loot('other-key',{candidates:[{tpl:'c'}]})]};
  const before=JSON.stringify(data),index=buildMapKeyIndex(data),selected=new Set([mapKeySelectionKey('a')]);
  assert.deepEqual(index.byKey.get('a').spawns.map(p=>p.id),['loose','pool1','pool2','forced','nested']);
  assert.deepEqual([...selectedKeyPointIds(index,selected)],['door-a','loose','pool1','pool2','forced','nested']);
  selected.add(mapKeySelectionKey('b'));assert.equal(selectedKeyPointIds(index,selected).size,7);
  selected.clear();assert.equal(selectedKeyPointIds(index,selected).size,0);
  assert.equal(index.byKey.has('c'),false);assert.equal(JSON.stringify(data),before);
  const restored=createItemIndex(data,createItemIndex(data).serialize());
  assert.deepEqual(buildMapKeyIndex(data,restored),index);
});

test('persisted key selection unions spawns with other filters while respecting height and clearing',()=>{
  let saved;const storage={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};
  const data={points:[door('door','a'),{id:'key-spawn',kind:'loose',position:{x:0,y:5,z:0},candidates:[{tpl:'a'}]},
    {id:'other',kind:'container',position:{x:0,y:1,z:0}}]};
  const index=buildMapKeyIndex(data);createPointSelection('fixture',{storage}).set(mapKeySelectionKey('a'),true);
  const selection=createPointSelection('fixture',{storage}),ids=selectedKeyPointIds(index,selection.keys);
  const pointMatch=createPointUnionMatcher({keys:p=>ids.has(p.id),types:p=>p.id==='other'||p.id==='key-spawn'});
  assert.deepEqual(filterModePoints(data.points,{mode:'point',low:-10,high:10,pointMatch}).visible.map(p=>p.id),['door','key-spawn','other']);
  assert.deepEqual(filterModePoints(data.points,{mode:'point',low:-10,high:3,pointMatch}).visible.map(p=>p.id),['door','other']);
  selection.clear();assert.equal(selectedKeyPointIds(index,selection.keys).size,0);
});

test('all 13 real maps match key spawn candidates exactly with fresh and prepared item indexes, without source changes',()=>{
  let keyCount=0,spawnCount=0;
  for(const map of Object.values(ATLAS_MAPS)){
    const data=mergeMapData(read('site/'+map.data),read(`site/data/${map.id}-pois.json`)),before=JSON.stringify(data);
    const items=createItemIndex(data),index=buildMapKeyIndex(data,items);
    const restored=buildMapKeyIndex(data,createItemIndex(data,items.serialize()));
    assert.deepEqual(restored,index,map.id);keyCount+=index.entries.length;
    for(const entry of index.entries){
      const candidates=data.points.filter(p=>['loose','container'].includes(p.kind)&&p.active!==false&&!p.outsideClientEnvelope&&p.position&&['x','y','z'].every(a=>Number.isFinite(p.position[a])))
        .filter(p=>{const rows=p.kind==='loose'?p.candidates:[...(data.pools?.[p.pool]?.items||[]),...(p.forcedItems||[])];
          return (rows||[]).some(c=>(c.weight==null||c.weight>0)&&(c.tpl===entry.keyId||c.included?.some(i=>i.tpl===entry.keyId)));});
      assert.deepEqual(entry.spawns.map(p=>p.id),[...new Set(candidates.map(p=>p.id))],map.id+'/'+entry.keyId);
      const ids=selectedKeyPointIds(index,new Set([mapKeySelectionKey(entry.keyId)]));
      assert.equal(ids.size,new Set([...entry.doors,...entry.spawns].map(p=>p.id)).size);spawnCount+=entry.spawns.length;
    }
    assert.equal(JSON.stringify(data),before,map.id);
  }
  assert.ok(keyCount>=200);assert.ok(spawnCount>100);
});

test('key leaves persist, select all distinct doors, union with other types and clear without hidden targets',()=>{
  let saved;const storage={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};
  const data={points:[door('lower','a'),door('upper','a',{x:2,y:5,z:4}),door('other','b'),{id:'loot',kind:'loose',position:{x:0,y:0,z:0}}]};
  const index=buildMapKeyIndex(data),keys=index.entries.map(e=>mapKeySelectionKey(e.keyId));
  let selection=createPointSelection('fixture',{storage});selection.set(mapKeySelectionKey('a'),true);
  selection=createPointSelection('fixture',{storage});
  assert.deepEqual(checkboxState(keys,selection.keys),{checked:false,indeterminate:true});
  const ids=selectedKeyDoorIds(index,selection.keys);assert.deepEqual([...ids],['lower','upper']);
  const match=createPointUnionMatcher({types:p=>p.id==='loot',keys:p=>ids.has(p.id)});
  assert.deepEqual(data.points.filter(match).map(p=>p.id),['lower','upper','loot']);
  assert.deepEqual(filterModePoints(data.points,{mode:'value',low:-10,high:10,pointMatch:match,valueMatch:()=>false}).visible,[]);
  selection.setMany(keys,true);assert.equal(selectedKeyDoorIds(index,selection.keys).size,3);
  selection.clear();assert.equal(selectedKeyDoorIds(index,selection.keys).size,0);
});

test('each real map key selects precisely its own canonical door coordinates without modifying source records',()=>{
  for(const map of Object.values(ATLAS_MAPS)){
    const data=read(`site/data/${map.id}-pois.json`),before=JSON.stringify(data),index=buildMapKeyIndex(data);
    for(const entry of index.entries){
      const ids=selectedKeyDoorIds(index,new Set([mapKeySelectionKey(entry.keyId)]));
      assert.deepEqual([...ids],entry.doors.map(p=>p.id),map.id+'/'+entry.keyId);
      assert.ok(data.points.filter(p=>ids.has(p.id)).every(p=>p.keyId===entry.keyId));
    }
    assert.equal(JSON.stringify(data),before);
  }
});

test('key list groups only exact door keys, never loot keys or unrelated required items',()=>{
  const data={items:{key:{zh:'门钥匙'},lootKey:{zh:'掉落钥匙'}},points:[door('a','key'),door('b','key',{x:2,y:-3,z:4}),{id:'loot',kind:'loose',position:{x:1,y:2,z:3},candidates:[{tpl:'lootKey'}]},door('quest','questKey',undefined,{poiTypes:['quest_item']}),door('weapon','gun',undefined,{poiTypes:['stationary']})]};
  const before=JSON.stringify(data),index=buildMapKeyIndex(data);
  assert.equal(index.entries.length,1);assert.equal(index.entries[0].name,'门钥匙');assert.deepEqual(index.entries[0].doors.map(p=>p.id),['b','a']);assert.equal(JSON.stringify(data),before);
});

test('shared scene variants collapse while distinct doors at other heights remain available',()=>{
  const data={points:[door('day','key'),door('night','key'),door('upper','key',{x:1,y:5,z:3}),door('alternative','otherKey')]};
  const index=buildMapKeyIndex(data);assert.equal(index.byKey.get('key').doors.length,2);assert.equal(index.byKey.get('otherKey').doors.length,1);
});

test('inactive, outside, malformed and keyless records do not create navigable targets',()=>{
  const data={points:[door('a',''),door('b',null),door('c',123),door('d','key',null),door('e','key',{x:NaN,y:1,z:2}),door('f','key',undefined,{active:false}),door('g','key',undefined,{outsideClientEnvelope:true})]};
  assert.deepEqual(buildMapKeyIndex(data).entries,[]);
});

test('door navigation selects its actual floor and removes overhead geometry without clipping the target',()=>{
  const bands=[{id:'lower',min:-10,max:3},{id:'upper',min:3,max:10},{id:'high',min:10,max:160}],map={maxHeight:160};
  assert.deepEqual(keyDoorView(door('a','k',{x:0,y:2.8,z:0}),bands,map),{band:'lower',cut:3});
  assert.deepEqual(keyDoorView(door('a','k',{x:0,y:3,z:0}),bands,map),{band:'upper',cut:5});
  assert.deepEqual(keyDoorView(door('a','k',{x:0,y:34,z:0}),bands,map),{band:'high',cut:36});
  assert.deepEqual(keyDoorView(door('a','k',{x:0,y:200,z:0}),bands,map),{band:'all',cut:202});
});

test('all 13 generated maps expose every recorded keyed door with unchanged Unity coordinates',()=>{
  let keys=0,doors=0;
  const iconFiles=['site/data/icons/factory/manifest.json','site/data/icons/items/manifest.json','site/data/icons/items/spt-extras.json'].map(read);
  const icons=Object.assign({},...iconFiles.map(m=>m.items)),entries=Object.assign({},...iconFiles.map(m=>m.entries));
  const missing=[];
  for(const map of Object.values(ATLAS_MAPS)){
    const data=read(`site/data/${map.id}-pois.json`),index=buildMapKeyIndex(data);keys+=index.entries.length;
    const targets=index.entries.flatMap(e=>e.doors);doors+=targets.length;
    for(const point of data.points.filter(p=>p.poiTypes.includes('locked_door')&&p.keyId)){
      const entry=index.byKey.get(point.keyId);assert.ok(entry,`${map.id}/${point.keyId}`);
      assert.ok(entry.doors.some(p=>JSON.stringify(p.position)===JSON.stringify(point.position)));
      const view=keyDoorView(point,map.heightBands,map),band=map.heightBands.find(b=>b.id===view.band);
      assert.ok(view.cut>point.position.y);assert.ok(!band||band.min<=point.position.y);
    }
    for(const entry of index.entries){
      assert.ok(entry.name);const file=entries[icons[entry.keyId]]?.file;
      if(file)assert.ok(fs.existsSync(new URL('../../site/'+file,import.meta.url)),file);else missing.push(entry.keyId);
    }
  }
  assert.ok(keys>=200);assert.ok(doors>=230);
  // The source contains one internal City key with no published item image;
  // the UI uses an explicit key outline, never another item's image.
  assert.deepEqual(missing,['63a39e0f64283b5e9c56b282']);
});
