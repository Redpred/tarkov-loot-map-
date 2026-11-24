import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clusterScreenPoints} from '../../site/atlas-clusters.js';
import {createPointFilter,pointMatches,candidatesFor} from '../lib/factory-data.mjs';
import {createMaterialLibrary} from '../../site/factory-materials.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {emptySettings,pointSettingKey,validateSettings} from '../../site/factory-icon-settings.js';

const sample=()=>({items:{gpu:{zh:'显示卡',en:'GPU',category:'电子'},attachment:{zh:'配件',en:'Attachment',category:'配件'},medicine:{zh:'医疗包',en:'Medical kit',category:'医疗'},ammo:{zh:'弹药盒',en:'Ammo box',category:'弹药'},crate:{zh:'箱子',en:'Crate',category:'容器'}},pools:{shared:{items:[{tpl:'gpu',weight:1,included:[{tpl:'attachment'}]},{tpl:'medicine',weight:0}]}},points:[{id:'a',sourceId:'loose-a',kind:'loose',candidates:[{tpl:'ammo',weight:1}]},{id:'b',sourceId:'scene-container',kind:'container',containerTpl:'crate',pool:'shared',forcedItems:[{tpl:'medicine'}]},{id:'c',sourceId:'scene-other',kind:'container',containerTpl:'crate',pool:'shared'}]});

test('screen clusters retain every point and expand when zoomed apart',()=>{
  const points=Array.from({length:50},(_,id)=>({id}));
  const near=points.map((point,i)=>({point,x:i*.1,y:5}));
  const clusters=clusterScreenPoints(near,26);assert.equal(clusters.length,1);assert.equal(clusters[0].members.length,50);
  assert.equal(new Set(clusters.flatMap(c=>c.members)).size,50);
  assert.equal(clusterScreenPoints(near.map((p,i)=>({...p,x:i*40})),26).length,50);
});
test('street and factory customizations have independent persistent storage',()=>{
  assert.notEqual(ATLAS_MAPS.streets.settingsKey,ATLAS_MAPS.factory.settingsKey);
  assert.equal(ATLAS_MAPS.factory.settingsKey,'factory-marker-icons-v1');
});

test('custom icon exports can round-trip overrides for every synthetic point',()=>{
  const data=sample();
  const settings=emptySettings();
  for(const point of data.points)settings.points[pointSettingKey(point)]='map-icon';
  const exported=JSON.stringify(settings,null,2);
  assert.ok(Buffer.byteLength(exported)<4*1024*1024);
  assert.deepEqual(validateSettings(JSON.parse(exported),{'map-icon':{}}),settings);
});
test('optimized street search agrees with root, attached, category and scene-ID matching',()=>{
  const data=sample();
  assert.ok(data.points.filter(createPointFilter(data,'显示卡')).length>0);
  for(const [query,category] of [['',''],['显示卡',''],['attachment',''],['','医疗'],['盒','弹药'],['scene-container','']]){
    const match=createPointFilter(data,query,category);
    assert.deepEqual(data.points.filter(match).map(p=>p.id),data.points.filter(p=>pointMatches(p,data,query,category)).map(p=>p.id));
  }
  const forced=data.points.find(p=>p.kind==='container'&&p.forcedItems?.length);
  assert.ok(candidatesFor(forced,data).some(c=>c.forced&&c.weight===null&&c.tpl===forced.forcedItems[0].tpl));
});
test('streamed materials share textures and release them only after the last sector leaves',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync;let loads=0,disposed=0;
  THREE.TextureLoader.prototype.loadAsync=async()=>{loads++;const t=new THREE.Texture();t.addEventListener('dispose',()=>disposed++);return t;};
  try{
    const library=createMaterialLibrary({textures:{shared:{file:'shared.webp'}},materials:[{tex:'shared'},{tex:'shared'}]},{low:{value:0},high:{value:4}},'data/atlas/streets/');
    const a=await library.acquire([0]),b=await library.acquire([0,1]);
    assert.equal(loads,1);assert.equal(a.get(0),b.get(0));
    library.release([0]);assert.equal(disposed,0);
    library.release([0,1]);assert.equal(disposed,1);
    await library.acquire([0]);assert.equal(loads,2);library.dispose();assert.equal(disposed,2);
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
