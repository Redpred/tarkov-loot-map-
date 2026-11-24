import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskStore,validateTaskState,TASK_STORE_KEY} from '../../site/task-store.js';
const memory=()=>{const m=new Map();return {getItem:key=>m.get(key)||null,setItem:(key,value)=>m.set(key,value)};};
test('task choices and completed objectives persist across page instances without losing other writes',()=>{
  const storage=memory(),bus=new EventTarget(),a=createTaskStore({storage,eventTarget:bus}),b=createTaskStore({storage,eventTarget:bus});
  a.toggleTask('task-a',true);b.setCompleted('task-a','objective-a',true);
  assert.equal(a.isSelected('task-a'),true);assert.equal(a.isCompleted('task-a','objective-a'),true);
  a.toggleTask('task-a',false);a.toggleTask('task-a',true);
  assert.equal(b.isCompleted('task-a','objective-a'),true);
  const reopened=createTaskStore({storage,eventTarget:new EventTarget()});
  assert.deepEqual(reopened.getState().selected,['task-a']);assert.equal(reopened.isCompleted('task-a','objective-a'),true);
  a.destroy();b.destroy();reopened.destroy();
});
test('map visibility is independent per task/objective/map, and completion hides an objective until explicitly shown',()=>{
  const s=createTaskStore({storage:memory()});s.toggleTask('q',true);
  assert.equal(s.mapEnabled('factory'),true);s.setCompleted('q','o',true);
  assert.equal(s.objectiveVisible('factory','q','o'),false);
  s.setObjectiveVisible('factory','q','o',true);assert.equal(s.objectiveVisible('factory','q','o'),true);
  assert.equal(s.objectiveVisible('streets','q','o'),false);
  s.setTaskVisible('factory','q',false);assert.equal(s.taskVisible('factory','q'),false);assert.equal(s.taskVisible('streets','q'),true);
  s.setMapEnabled('factory',false);assert.equal(s.mapEnabled('factory'),false);
  s.setCompleted('q','o',false);s.setCompleted('q','o',true);assert.equal(s.objectiveVisible('factory','q','o'),false);
});
test('invalid stored data, duplicate IDs and prototype-like keys cannot corrupt progress',()=>{
  const state=validateTaskState(JSON.parse('{"version":1,"selected":["q","q",null],"completed":{"__proto__":["x"],"q":["o","o"]},"mapEnabled":{"factory":true,"bad":"false"}}'));
  assert.deepEqual(state.selected,['q']);assert.deepEqual(state.completed,{q:['o']});assert.deepEqual(state.mapEnabled,{factory:true});
  const storage=memory();storage.setItem(TASK_STORE_KEY,'not json');const s=createTaskStore({storage});s.toggleTask('q',true);assert.equal(s.isSelected('q'),true);
  s.toggleTask('__proto__',true);assert.deepEqual(s.getState().selected,['q']);
});
test('storage failure keeps current progress usable and reports that it is not persistent',()=>{
  const s=createTaskStore({storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');}}});
  s.toggleTask('q',true);s.setCompleted('q','o',true);assert.equal(s.isSelected('q'),true);assert.equal(s.isCompleted('q','o'),true);assert.equal(s.getStatus().persistent,false);
});

test('whole-task completion syncs, hides map goals and restores partial progress on undo',()=>{
  const storage=memory(),bus=new EventTarget(),a=createTaskStore({storage,eventTarget:bus}),b=createTaskStore({storage,eventTarget:bus});
  a.toggleTask('q',true);a.setCompleted('q','o1',true);a.setObjectiveVisible('factory','q','o2',true);
  a.setTaskCompleted('q',true);assert.equal(b.isTaskCompleted('q'),true);assert.equal(b.isCompleted('q','o2'),true);
  assert.equal(b.objectiveVisible('factory','q','o2'),false);assert.deepEqual(b.getState().completed,{q:['o1']});
  const reopened=createTaskStore({storage,eventTarget:new EventTarget()});assert.equal(reopened.isTaskCompleted('q'),true);
  b.setTaskCompleted('q',false);assert.equal(a.isCompleted('q','o1'),true);assert.equal(a.isCompleted('q','o2'),false);assert.equal(a.isSelected('q'),true);
  a.setCompleted('q','o2',true);assert.equal(a.isTaskCompleted('q'),false,'objective checklists do not mean submitted quests');
  a.destroy();b.destroy();reopened.destroy();
});

test('old stores migrate additively and invalid completed-task/loyalty records are discarded',()=>{
  const old=validateTaskState({version:1,selected:['q'],completed:{q:['o']}});assert.deepEqual(old.finished,[]);assert.deepEqual(old.loyaltyLevels,{});assert.deepEqual(old.completed,{q:['o']});
  const s=createTaskStore({storage:memory()});s.setTaskCompleted('__proto__',true);s.setLoyaltyLevel('trader',5);assert.deepEqual(s.getState().finished,[]);assert.deepEqual(s.getState().loyaltyLevels,{});
  s.setLoyaltyLevel('trader',3);s.setTaskCompleted('q',true);assert.deepEqual(s.getState().loyaltyLevels,{trader:3});s.setLoyaltyLevel('trader',null);assert.deepEqual(s.getState().loyaltyLevels,{});
});
