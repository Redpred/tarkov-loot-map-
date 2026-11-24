import test from 'node:test';
import assert from 'node:assert/strict';
import {taskPrerequisiteState,taskRequirementRows} from '../../site/task-requirements.js';

test('completed quests satisfy exact completion conditions, not acceptance, failure or elapsed-time conditions',()=>{
  const pre={type:'Quest',taskIds:['a'],status:[4],raw:{}},progress={finished:['a']};
  assert.equal(taskPrerequisiteState(pre,progress).status,'met');assert.equal(taskPrerequisiteState(pre,{finished:[]}).status,'pending');
  assert.equal(taskPrerequisiteState({...pre,status:[2]},progress).status,'unknown');
  assert.equal(taskPrerequisiteState({...pre,status:[5]},progress).status,'unknown');
  assert.equal(taskPrerequisiteState({...pre,raw:{availableAfter:3600}},progress).status,'unknown');
});

test('cumulative counters count unique verified flags and retract when a task is uncompleted',()=>{
  const pre={type:'GlobalVariableValue',text:'商人任务进度至少 2',progressRequirement:{compareMethod:'>=',value:2,contributors:[{taskId:'a',flag:'a',contribution:1},{taskId:'b',flag:'b',contribution:1},{taskId:'alias',flag:'a',contribution:1}],alternatives:[]}};
  const before=JSON.stringify(pre);
  assert.equal(taskPrerequisiteState(pre,{finished:['a','alias']}).count,1);
  assert.equal(taskPrerequisiteState(pre,{finished:['a','b']}).status,'met');
  assert.equal(taskPrerequisiteState(pre,{finished:['a']}).status,'pending');
  assert.ok(taskRequirementRows({prerequisites:[pre]},{finished:['a']})[0].text.includes('已完成 1 / 2'));
  assert.equal(JSON.stringify(pre),before);
});

test('uncertain alternatives cannot manufacture unlocked quests; loyalty requires a recorded level',()=>{
  const pre={progressRequirement:{compareMethod:'>=',value:2,contributors:[{taskId:'a',flag:'a',contribution:1}],alternatives:[{taskIds:['other'],contribution:3}]}};
  assert.equal(taskPrerequisiteState(pre,{finished:['other']}).status,'unknown');
  const loyalty={type:'TraderLoyalty',raw:{target:'trader',value:3,compareMethod:'>='}};
  assert.equal(taskPrerequisiteState(loyalty,{finished:['a','b','c']}).status,'unknown');
  assert.equal(taskPrerequisiteState(loyalty,{loyaltyLevels:{trader:2}}).status,'pending');
  assert.equal(taskPrerequisiteState(loyalty,{loyaltyLevels:{trader:3}}).status,'met');
  assert.equal(taskPrerequisiteState({type:'Level',raw:{value:10}},{finished:['a']}).status,'unknown');
});
