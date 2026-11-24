import test from 'node:test';
import assert from 'node:assert/strict';
import {createLootMatcher,filterMapPoints} from '../../site/atlas-map-filter-data.js';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {createMapMarketSession} from '../../site/atlas-map-market.js';
import {createPointValuation,pointMatches,pointValuePreferences} from '../../site/atlas-point-values.js';

const data={items:{cheap:{zh:'螺丝',en:'Screw'},expensive:{zh:'显卡',en:'Graphics card'},box:{zh:'工具箱',en:'Toolbox'}},pools:{pool:{items:[{tpl:'cheap',weight:1},{tpl:'expensive',weight:1}]}},points:[
  {id:'both',kind:'loose',sourceId:'loot-both',position:{x:0,y:0,z:0},candidates:[{tpl:'cheap',weight:1},{tpl:'expensive',weight:1}]},
  {id:'box',kind:'container',sourceId:'box',position:{x:1,y:0,z:0},containerTpl:'box',pool:'pool'},
  {id:'upper',kind:'loose',sourceId:'upper',position:{x:0,y:10,z:0},candidates:[{tpl:'expensive',weight:1}]},
  {id:'quest',kind:'poi',position:{x:0,y:0,z:0},quest:true,poiTypes:['quest_visit']},
  {id:'outside',kind:'loose',position:{x:0,y:0,z:0},outsideClientEnvelope:true,candidates:[]},
  {id:'missing',kind:'loose',position:null,candidates:[]}
]};
const index=createItemIndex(data),base={data,index,types:()=>true};
test('target, exact search and unit price intersect on the same candidate, not different items in one pool',()=>{
  const priceIds=new Set(['expensive']);
  const cheap=createLootMatcher({...base,selection:{targets:[{tpl:'cheap',enabled:true}]},priceIds});
  assert.equal(cheap(data.points[0]),false);assert.equal(cheap(data.points[1]),false);
  const expensive=createLootMatcher({...base,selection:{targets:[{tpl:'cheap',enabled:true},{tpl:'expensive',enabled:true}]},priceIds});
  assert.equal(expensive(data.points[0]),true);assert.equal(expensive(data.points[1]),true);
  assert.equal(createLootMatcher({...base,query:'螺丝',priceIds})(data.points[0]),false);
  assert.equal(createLootMatcher({...base,query:'工具箱',priceIds})(data.points[1]),true);
  assert.equal(createLootMatcher({...base,selection:{exactSearch:true,itemIds:['cheap']},priceIds})(data.points[0]),false);
});
test('explicit empty target or price selections match nothing; absent constraints match all loot',()=>{
  assert.equal(createLootMatcher(base)(data.points[0]),true);
  assert.equal(createLootMatcher({...base,selection:{targets:[{tpl:'cheap',enabled:false}]}})(data.points[0]),false);
  assert.equal(createLootMatcher({...base,priceIds:new Set()})(data.points[0]),false);
  assert.equal(createLootMatcher(base)(data.points[3]),false);
  assert.equal(createLootMatcher({...base,types:()=>false})(data.points[0]),false);
});
test('auxiliary layers survive loot constraints, share height, and deduplicate overlapping positions',()=>{
  const auxiliary=p=>['both','upper','quest','outside','missing'].includes(p.id);
  const result=filterMapPoints(data.points,{low:-1,high:5,loot:createLootMatcher(base),auxiliary});
  assert.deepEqual(result.visible.map(p=>p.id),['both','box','quest']);
  assert.equal(result.lootIds.size,2);assert.equal(result.auxIds.size,1);assert.equal(result.overlap,1);
  const empty=filterMapPoints(data.points,{low:-1,high:5,loot:()=>false,auxiliary});
  assert.deepEqual(empty.visible.map(p=>p.id),['both','quest']);assert.equal(empty.auxIds.size,2);
});
test('target narrowing leaves the whole-point expected value and tier unchanged',()=>{
  const model={models:{m:{stock:1,coefficients:[['cheap',.9],['expensive',.1]],issues:[]}},points:{both:{model:'m',probability:.5,issues:[]}}};
  const values=createPointValuation(model,{items:{cheap:{trader:{priceRUB:1000}},expensive:{trader:{priceRUB:100000}}}});
  const prefs=pointValuePreferences({thresholds:[10000,40000,100000],tiers:[0]});
  const match=createLootMatcher({...base,selection:{exactSearch:true,itemIds:['expensive']},pointMatches:p=>pointMatches(p,values.get(p.id),prefs)});
  assert.equal(match(data.points[0]),true);assert.equal(values.get('both').expected,5450);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('global mode changes discard stale responses and details reuse the same snapshot',async()=>{
  const first=deferred(),second=deferred();let calls=0;const session=createMapMarketSession({client:{load:mode=>{calls++;return mode==='pve'?second.promise:first.promise;}}});
  const observed=[];session.subscribe(s=>observed.push([s.mode,s.status,s.market?.fetchedAt]));
  const a=session.load('regular'),b=session.load('pve');await Promise.resolve();
  second.resolve({mode:'pve',fetchedAt:'new',items:{}});await b;
  first.resolve({mode:'regular',fetchedAt:'old',items:{}});await a;
  assert.equal(session.state.mode,'pve');assert.equal(session.state.market.fetchedAt,'new');
  const cached=await session.ensure();assert.strictEqual(cached,session.state.market);await session.load('pve');assert.equal(calls,2);
  assert.equal(observed.some(r=>r[2]==='old'),false);
});
test('refresh failure clears previous market; retry is explicit and listeners can detach',async()=>{
  let fail=false,calls=0,notifications=0;const session=createMapMarketSession({client:{load:async mode=>{calls++;if(fail)throw new Error('offline');return {mode,items:{}};}}});
  const off=session.subscribe(()=>notifications++);await session.ensure();assert.equal(session.state.status,'ready');off();const before=notifications;
  fail=true;await session.load('regular',{reload:true});assert.equal(session.state.status,'error');assert.equal(session.state.market,null);assert.equal(notifications,before);
  await session.ensure();assert.equal(calls,2);fail=false;await session.load();assert.equal(session.state.status,'ready');
});
