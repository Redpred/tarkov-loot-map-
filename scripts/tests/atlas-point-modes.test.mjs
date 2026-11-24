import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPointSelection,checkboxState,createFilterMode,createPointUnionMatcher,objectiveSelectionKey,syncTaskObjectives} from '../../site/atlas-point-selection.js';
import {filterModePoints,createLootMatcher} from '../../site/atlas-map-filter-data.js';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {selectedAmmoIds,ammoSelectionKey} from '../../site/atlas-ammo-tree.js';
import {buildAmmoGroups} from '../../site/atlas-ammo-search.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {mergeMapData} from '../../site/atlas-runtime.js';
import {buildPointTypes,matchesPointTypes} from '../../site/atlas-point-types.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
const point=(id,kind='loose',y=0)=>({id,kind,position:{x:0,y,z:0}});
test('point choices form a union across loot, item, ammunition, tasks and keys; no selection means no points',()=>{
 const points=['category','item','ammo','task','key','none'].map(id=>point(id,id==='task'||id==='key'?'poi':'loose'));
 const options={types:p=>p.id==='category',items:p=>p.id==='item',ammo:p=>p.id==='ammo',tasks:p=>p.id==='task',keyId:'key'};
 assert.deepEqual(points.filter(createPointUnionMatcher(options)).map(p=>p.id),['category','item','ammo','task','key']);
 assert.equal(points.filter(createPointUnionMatcher()).length,0);
});
test('the result tab preserves the most recent filter mode and both sets of choices',()=>{
 const mode=createFilterMode();assert.equal(mode.mode,'point');mode.select('value');mode.select('list');assert.equal(mode.mode,'value');assert.equal(mode.tab,'list');mode.select('point');mode.select('list');assert.equal(mode.mode,'point');
});
test('value mode excludes all point-only overlays; point mode ignores prices and deduplicates shared membership',()=>{
 const points=[point('a'),point('b','container'),point('task','poi'),point('outside'),point('upper','poi',10)];points[3].outsideClientEnvelope=true;
 const pointMatch=createPointUnionMatcher({types:p=>p.id==='a',items:p=>p.id==='a',tasks:p=>p.kind==='poi'});
 const options={low:0,high:10,pointMatch,valueMatch:p=>p.id==='b'};
 const selected=filterModePoints(points,{...options,mode:'point'});assert.deepEqual(selected.visible.map(p=>p.id),['a','task']);assert.equal(selected.lootIds.size,1);assert.equal(selected.auxIds.size,1);
 assert.deepEqual(filterModePoints(points,{...options,mode:'value'}).visible.map(p=>p.id),['b']);
 assert.deepEqual(filterModePoints(points,{...options,mode:'value',valueMatch:()=>false}).visible,[]);
});
test('parent checkboxes batch leaves and become partial after one leaf is removed',()=>{
 const selection=createPointSelection('test',{storage:null}),ids=['ammo:a','ammo:b'];selection.setMany(ids,true);assert.deepEqual(checkboxState(ids,selection.keys),{checked:true,indeterminate:false});selection.set(ids[0],false);assert.deepEqual([...selection.keys],['ammo:b']);assert.deepEqual(checkboxState(ids,selection.keys),{checked:false,indeterminate:true});selection.setMany(ids,false);assert.deepEqual(checkboxState(ids,selection.keys),{checked:false,indeterminate:false});
});
test('per-map selections persist including an intentional empty set and tolerate unavailable storage',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};const a=createPointSelection('a',{storage});a.set('loose:medical',true);a.knownTasks.add('task');a.changed();assert.equal(createPointSelection('a',{storage}).keys.has('loose:medical'),true);assert.equal(createPointSelection('b',{storage}).keys.size,0);a.clear();assert.equal(createPointSelection('a',{storage}).keys.size,0);assert.equal(createPointSelection('a',{storage}).knownTasks.has('task'),true);
 const b=createPointSelection('b',{storage:{getItem(){throw Error();},setItem(){throw Error();}}});b.set('poi:extract',true);assert.equal(b.keys.size,1);
});
test('ammunition selection unions verified rounds and boxes without selecting siblings or inserting parent keys',()=>{
 const groups=[{items:[{tpl:'round',searchIds:['round','box']},{tpl:'other',searchIds:['other']}]}],selected=new Set([ammoSelectionKey(groups[0].items[0])]);assert.deepEqual([...selectedAmmoIds(groups,selected)],['round','box']);selected.add('ammo:other');assert.deepEqual([...selectedAmmoIds(groups,selected)],['round','box','other']);
 assert.notEqual(objectiveSelectionKey('task1','same'),objectiveSelectionKey('task2','same'));
});
test('task completion hides newly finished goals across reloads while preserving explicit display choices',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};let s=createPointSelection('factory',{storage});const key=objectiveSelectionKey('task','goal');
 syncTaskObjectives(s,'task',[{key,complete:false,visible:true}]);s.changed();assert.ok(s.keys.has(key));
 s=createPointSelection('factory',{storage});syncTaskObjectives(s,'task',[{key,complete:true,visible:false}]);s.changed();assert.ok(!s.keys.has(key));
 s.set(key,true);s=createPointSelection('factory',{storage});syncTaskObjectives(s,'task',[{key,complete:true,visible:false}]);assert.ok(s.keys.has(key));
 s.set(key,false);syncTaskObjectives(s,'task',[{key,complete:false,visible:true}]);assert.ok(!s.keys.has(key));
});
test('value mode retains unit-price and whole-point intersection independently of point selections',()=>{
 const p={...point('p'),candidates:[{tpl:'cheap',weight:1},{tpl:'costly',weight:1}]},data={items:{cheap:{zh:'便宜'},costly:{zh:'贵重'}},points:[p],pools:{}};const index=createItemIndex(data);
 const match=createLootMatcher({data,index,types:()=>true,priceIds:new Set(['costly']),pointMatches:()=>false});assert.equal(match(p),false);
 assert.equal(createLootMatcher({data,index,types:()=>true,priceIds:new Set(['costly']),pointMatches:()=>true})(p),true);
});
test('all thirteen maps support exact ammo unions and retain every eligible point under union selection',()=>{
 const catalog=read('site/data/ammo-catalog.json');
 for(const map of Object.values(ATLAS_MAPS)){
  const data=mergeMapData(read('site/'+map.data),read(`site/data/${map.id}-pois.json`),read(`site/data/tasks/maps/${map.id}.json`)),index=createItemIndex(data),groups=buildAmmoGroups(catalog,index),taxonomy=buildPointTypes(data);
  const selected=new Set(taxonomy.types.map(t=>t.key)),types=p=>matchesPointTypes(taxonomy.members.get(p.id)||[],selected),match=createPointUnionMatcher({types});
  const expected=data.points.filter(p=>p.position&&!p.outsideClientEnvelope);assert.equal(filterModePoints(data.points,{mode:'point',pointMatch:match,valueMatch:()=>false}).visible.length,expected.length,map.id);
  for(const group of groups){const selected=new Set(group.items.map(ammoSelectionKey)),ids=selectedAmmoIds(groups,selected);assert.deepEqual(ids,new Set(group.items.flatMap(i=>i.searchIds)),map.id);for(const id of ids)assert.ok(index.byId.has(id));}
 }
});
