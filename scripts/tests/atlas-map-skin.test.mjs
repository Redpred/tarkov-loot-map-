import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_SKIN_KEY,validateMapSkin,mapSkinPalette,createMapSkinController} from '../../site/atlas-map-skin.js';

function environment(initial){
  const values=new Map(initial===undefined?[]:[[MAP_SKIN_KEY,initial]]),writes=[],changes=[],events=new EventTarget();
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,value]);values.set(key,value);}};
  const controller=createMapSkinController({storage,events,onChange:(skin,palette)=>changes.push({skin,background:palette.background})});
  return {controller,storage,values,writes,changes,events};
}
test('new visitors and invalid saved preferences use the exact original night background',()=>{
  for(const value of [undefined,null,'','dark','auto','DAY',{},0]){
    assert.equal(validateMapSkin(value),'night');
    const env=environment(value);assert.equal(env.controller.skin,'night');
    assert.deepEqual(env.changes,[{skin:'night',background:'#101820'}]);assert.equal(env.writes.length,0);
  }
  assert.equal(validateMapSkin('day'),'day');assert.equal(mapSkinPalette('day').background,'#e5e7e1');
});
test('switching updates immediately and a fresh map reads the same choice without changing unrelated settings',()=>{
  const env=environment();env.values.set('factory-view-settings-v1','camera preferences');
  env.controller.toggle();assert.equal(env.controller.skin,'day');assert.equal(env.changes.at(-1).background,'#e5e7e1');
  const next=createMapSkinController({storage:env.storage,events:new EventTarget()});assert.equal(next.skin,'day');
  next.toggle();assert.equal(next.skin,'night');assert.equal(env.values.get(MAP_SKIN_KEY),'night');
  assert.equal(env.values.get('factory-view-settings-v1'),'camera preferences');
});
test('restoring defaults returns to night and repeating the same selection does not redraw',()=>{
  const env=environment('day');env.controller.set('night');assert.equal(env.controller.skin,'night');
  const count=env.changes.length;env.controller.set('night');assert.equal(env.changes.length,count);assert.equal(env.values.get(MAP_SKIN_KEY),'night');
});
test('cross-tab changes, removal and clear synchronize without echoing writes',()=>{
  const env=environment(),fire=(key,newValue,storageArea=env.storage)=>env.events.dispatchEvent(Object.assign(new Event('storage'),{key,newValue,storageArea}));
  fire('other','day');assert.equal(env.controller.skin,'night');fire(MAP_SKIN_KEY,'day',{});assert.equal(env.controller.skin,'night');
  fire(MAP_SKIN_KEY,'day');assert.equal(env.controller.skin,'day');fire(MAP_SKIN_KEY,null);assert.equal(env.controller.skin,'night');
  fire(MAP_SKIN_KEY,'day');fire(null,null);assert.equal(env.controller.skin,'night');assert.equal(env.writes.length,0);
});
test('blocked preference storage still allows day/night switching for the current visit',()=>{
  const changes=[],controller=createMapSkinController({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},onChange:skin=>changes.push(skin)});
  controller.toggle();assert.equal(controller.skin,'day');controller.toggle();assert.equal(controller.skin,'night');assert.deepEqual(changes,['night','day','night']);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('access denied');}});
    const privateMode=createMapSkinController();privateMode.toggle();assert.equal(privateMode.skin,'day');
  }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
