import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskMapIndex} from '../../site/task-map-index.js';
import {createTaskStore} from '../../site/task-store.js';
const point=(id,extra={})=>({id,kind:'loose',position:{x:1,y:2,z:3},candidates:[{tpl:'a',weight:1}],...extra});
const goal=(id,type,extra={})=>({id,type,itemIds:['a'],mapIds:[],raw:{conditionType:type},...extra});
function fixture(objectives,points){const task={id:'task1',objectives};const index=createTaskMapIndex({catalog:{tasks:[task]},data:{points,items:{a:{zh:'物品'}}},mapId:'factory'});return{index,entries:index.entries(['task1'])};}
test('collection uses obtainable candidates; excludes plant/equipment/sale and invalid points',()=>{
  const p=point('loot'),zero=point('zero',{candidates:[{tpl:'a',weight:0}]}),out=point('outside',{outsideClientEnvelope:true});
  const {entries}=fixture([goal('find','FindItem'),goal('sell','SellItemToTrader'),goal('plant','LeaveItemAtLocation')],[p,zero,out]);
  assert.equal(entries[0].objectives.length,1);assert.deepEqual([...entries[0].objectives[0].points],[p]);
});
test('exact quest references remain scoped to task and objective; collection can exist on another map',()=>{
  const exact=point('zone',{kind:'poi',quest:true,poiTypes:['quest_zone'],questObjectives:[{questId:'task1',objectiveId:'zone'}]});
  const other=point('other',{kind:'poi',quest:true,poiTypes:['quest_zone'],questObjectives:[{questId:'task2',objectiveId:'zone'}]});
  const {entries}=fixture([goal('zone','CounterCreator'),goal('collect','HandoverItem',{mapIds:['streets']})],[exact,other,point('loot')]);
  assert.deepEqual([...entries[0].objectives[0].points],[exact]);assert.equal(entries[0].objectives[1].points.size,1);
});
test('kill goals use matching enemy candidates and never invent PMC kill positions',()=>{
  const scav=point('scav',{kind:'poi',poiTypes:['scav_ai']}),boss=point('boss',{kind:'poi',poiTypes:['boss'],boss:'bossTagilla'});
  const k=(id,target,roles=[])=>goal(id,'CounterCreator',{mapIds:['factory'],raw:{conditionType:'CounterCreator',counter:{conditions:[{conditionType:'Kills',target,savageRole:roles}]}}});
  const {entries}=fixture([k('scav','Savage'),k('pmc','AnyPmc'),k('boss','Savage',['bossTagilla'])],[scav,boss]);
  const rows=entries[0].objectives;assert.deepEqual([...rows[0].points],[scav]);assert.equal(rows[1].points.size,0);assert.deepEqual([...rows[2].points],[boss]);
});
test('shared positions survive one disabled goal; completion hides goal until explicitly shown',()=>{
  const p=point('loot');const{index,entries}=fixture([goal('a','FindItem'),goal('b','HandoverItem')],[p]);
  const store=createTaskStore({storage:null,eventTarget:null});store.toggleTask('task1',true);
  assert.deepEqual([...index.active(entries,store)],[p]);store.setCompleted('task1','a',true);assert.equal(index.active(entries,store).size,1);
  store.setObjectiveVisible('factory','task1','b',false);assert.equal(index.active(entries,store).size,0);
  store.setObjectiveVisible('factory','task1','a',true);assert.equal(index.active(entries,store).size,1);
  store.setTaskVisible('factory','task1',false);assert.equal(index.active(entries,store).size,0);
  store.destroy();
});
