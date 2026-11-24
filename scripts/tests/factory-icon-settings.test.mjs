import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {emptySettings,pointSettingKey,typeSettingKey,validateSettings,resolveMarker,editTypeAcrossMaps,saveMapIconSettings,readMapIconSettings} from '../../site/factory-icon-settings.js';
import {classifyPointMarker} from '../../site/factory-marker-rules.js';
import {candidatesFor} from '../../site/factory-data.js';
const root=path.resolve(import.meta.dirname,'../..');
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const entries={medical:{name:'医疗',file:'medical.svg'},a:{name:'A',file:'a.svg'},b:{name:'B',file:'b.svg'}};
const base={key:'medical',mode:'category',label:'医疗',description:'候选物资'};
const p={kind:'loose',sourceId:'same-scene-id',position:{x:1,y:2,z:3}};
test('multi-map category edits preserve independent overrides and never touch unselected maps',()=>{
  const original={factory:emptySettings(),streets:emptySettings(),labs:emptySettings()};
  original.factory.points[pointSettingKey(p)]='b';original.streets.types['category:other']='b';
  const batch=editTypeAcrossMaps(original,['factory','streets'],'category:medical','a');
  assert.deepEqual(Object.keys(batch),['factory','streets']);assert.equal(batch.factory.points[pointSettingKey(p)],'b');assert.equal(batch.streets.types['category:other'],'b');assert.deepEqual(original.factory.types,{});
  const reset=editTypeAcrossMaps(batch,['factory'],'category:medical',null);assert.deepEqual(reset.factory.types,{});assert.equal(reset.factory.points[pointSettingKey(p)],'b');
  const stored=new Map(),storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  const maps=Object.fromEntries(Object.keys(original).map(id=>[id,{settingsKey:id}]));saveMapIconSettings(storage,batch,maps,entries);
  assert.deepEqual(readMapIconSettings(storage,maps.streets,entries),batch.streets);assert.equal(storage.getItem('labs'),null);
  const before=new Map(stored);let writes=0;storage.setItem=(key,value)=>{if(++writes===2)throw new Error('quota');stored.set(key,value);};
  assert.throws(()=>saveMapIconSettings(storage,{factory:emptySettings(),streets:emptySettings()},maps,entries),/无法保存/);assert.deepEqual(stored,before);
});
test('single-point overrides take precedence, reset inherits the type, settings round-trip',()=>{
  const settings=emptySettings(),typeKey=typeSettingKey(p,base),pointKey=pointSettingKey(p);
  settings.types[typeKey]='a';settings.points[pointKey]='b';
  const decoded=validateSettings(JSON.parse(JSON.stringify(settings)),entries);
  assert.equal(resolveMarker(p,base,decoded,entries).key,'b');
  delete decoded.points[pointKey];assert.equal(resolveMarker(p,base,decoded,entries).key,'a');
  delete decoded.types[typeKey];assert.deepEqual(resolveMarker(p,base,decoded,entries),base);
});
test('legacy inventory overrides cannot show a specific item on multi-root points; single-item settings still work',()=>{
  const settings=emptySettings(),withGame={...entries,inventory:{file:'item.webp'}};settings.points[pointSettingKey(p)]='inventory';
  assert.equal(resolveMarker(p,base,settings,withGame).key,'medical');
  assert.equal(resolveMarker(p,{...base,mode:'item'},settings,withGame).key,'inventory');
  assert.equal(settings.points[pointSettingKey(p)],'inventory');
});
test('import rejects unknown assets, malformed groups, old versions and inherited object keys',()=>{
  for(const value of [{...emptySettings(),version:2},{...emptySettings(),types:[]},{...emptySettings(),types:{'category:medical':'missing'}},{...emptySettings(),types:{'category:medical':'toString'}}])assert.throws(()=>validateSettings(value,entries));
});
test('stable keys separate repeated quest scene IDs and survive list reordering',()=>{
  const data=load('site/data/factory-atlas.json');
  const keys=data.points.map(pointSettingKey);assert.equal(new Set(keys).size,data.points.length);
  assert.equal(pointSettingKey({...p,id:'old',index:1}),pointSettingKey({...p,id:'new',index:999}));
  assert.notEqual(pointSettingKey(p),pointSettingKey({...p,position:{...p.position,x:2}}));
});
test('downloaded catalogue images are local, intact and mapped to their own item IDs',()=>{
  const catalog=load('site/data/icons/items/manifest.json'),extras=load('site/data/icons/items/spt-extras.json');
  assert.equal(catalog.downloaded,catalog.total);assert.deepEqual(catalog.failures,[]);assert.deepEqual(extras.errors,[]);
  for(const manifest of [catalog,extras])for(const [id,key] of Object.entries(manifest.items)){
    const entry=manifest.entries[key];assert.equal(entry.tpl,id);assert.equal(entry.file,`data/icons/items/${id}.webp`);
    const bytes=fs.readFileSync(path.join(root,'site',entry.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  }
});
test('factory candidate coverage is complete and all automatic marker keys resolve',()=>{
  const data=load('site/data/factory-atlas.json'),base=load('site/data/icons/factory/manifest.json'),catalog=load('site/data/icons/items/manifest.json'),extras=load('site/data/icons/items/spt-extras.json');
  const manifest={items:{...base.items,...catalog.items,...extras.items},entries:{...base.entries,...catalog.entries,...extras.entries}};
  for(const p of data.points){
    assert.ok(manifest.entries[classifyPointMarker(p,data,manifest).key]);
    for(const candidate of candidatesFor(p,data))if(candidate.weight==null||candidate.weight>0)assert.ok(manifest.items[candidate.tpl],`${candidate.tpl}: ${data.items[candidate.tpl]?.zh}`);
  }
  for(const key of ['crate','technical-crate','safe','duffle','jacket','medbag','grenade-box','toolbox','drawer','weapon-box','body','mixed','other']){
    assert.equal(base.entries[key].source,'project-svg-symbol');assert.match(base.entries[key].file,/\.svg$/);
  }
});
