import test from 'node:test';
import assert from 'node:assert/strict';
import {pageRoute,pageAction,plainPageClick} from '../../site/atlas-page-routes.js';
import {ATLAS_MAPS,atlasMapHref} from '../../site/atlas-maps.js';
import {mapInterfaceKey,readPagePreferences,savePagePreferences} from '../../site/atlas-page-session.js';

test('independent page choices merge into the latest valid local record',()=>{
  const mapKey=mapInterfaceKey('factory'),values=new Map([[mapKey,'[1,2,3]']]);
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.deepEqual(readPagePreferences(mapKey,storage),{});
  assert.equal(savePagePreferences(mapKey,{settingsTab:'resources'},storage),true);
  assert.equal(savePagePreferences(mapKey,{geometry:false,search:''},storage),true);
  assert.deepEqual(readPagePreferences(mapKey,storage),{settingsTab:'resources',geometry:false,search:''});
  assert.deepEqual(readPagePreferences(mapInterfaceKey('woods'),storage),{});
  assert.equal(savePagePreferences(mapKey,{geometry:true},null),false);
  assert.deepEqual(readPagePreferences(mapKey,{getItem(){throw Error('blocked');}}),{});
});

const base='http://127.0.0.1:4175/streets.html';
test('home, tasks and all 13 map routes work at root and under a subdirectory',()=>{
  for(const prefix of ['http://127.0.0.1:4175/','https://example.com/maps/']){
    assert.equal(pageRoute(prefix,prefix+'streets.html').kind,'home');
    assert.equal(pageRoute('index.html',prefix+'streets.html').kind,'home');
    assert.equal(pageRoute('tasks.html?map=streets&task=abc',prefix+'streets.html').kind,'tasks');
    for(const id of Object.keys(ATLAS_MAPS))assert.equal(pageRoute(atlasMapHref(id),prefix+'streets.html').mapId,id);
  }
});
test('same map resumes with task deep link intact; another map uses normal navigation',()=>{
  const options={base,mapId:'streets'};
  const route=pageAction('streets.html?myTasks=1&task=abc',options);
  assert.equal(route.action,'resume');assert.equal(route.url.searchParams.get('task'),'abc');
  assert.equal(pageAction('tasks.html?map=streets',options).action,'overlay');
  assert.equal(pageAction('index.html',options).action,'overlay');
  assert.equal(pageAction('map.html?map=woods',options).action,'navigate');
});
test('external origins, unsupported pages, invalid map IDs and sibling sites are excluded',()=>{
  for(const value of ['https://example.com/streets.html','http://127.0.0.1:4185/streets.html','javascript:alert(1)','viewer.html?map=streets','map.html?map=unknown','map.html?map=__proto__','/editor/index.html'])assert.equal(pageRoute(value,base),null,value);
  assert.equal(pageRoute('../index.html','https://example.com/maps/streets.html'),null);
});
test('modified clicks, downloads and same-document anchors keep browser behavior',()=>{
  const event={button:0},link={target:'',hasAttribute:()=>false,getAttribute:()=> 'tasks.html'};
  assert.equal(plainPageClick(event,link),true);
  for(const change of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(plainPageClick({...event,...change},link),false);
  assert.equal(plainPageClick(event,{...link,target:'_blank'}),false);
  assert.equal(plainPageClick(event,{...link,hasAttribute:()=>true}),false);
  assert.equal(plainPageClick(event,{...link,getAttribute:()=> '#section'}),false);
});
