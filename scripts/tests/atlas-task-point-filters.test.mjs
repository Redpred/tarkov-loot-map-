import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTaskPointIndex,taskObjectiveKey,taskPointKeys,taskSelectionState,selectTaskObjectives} from '../../site/atlas-task-point-index.js';
import {buildPointTypes,matchesPointTypes} from '../../site/atlas-point-types.js';

const ref=(questId,objectiveId,text,index=0)=>({questId,objectiveId,text,index,name:questId==='q1'?'测试任务':'共享任务',en:'Test Task',items:['marker']});
const point=(id,refs,extra={})=>({id,kind:'poi',quest:true,poiTypes:['quest_beacon'],questObjectives:refs,position:{x:0,y:1,z:0},...extra});
function fixture(){
  const a=ref('q1','same','在吊车处使用 MS2000 标记器标记 BTR 站点',1),b=ref('q1','visit','前往酒店二楼调查指定房间',0),c=ref('q2','same','找到并获取机密文件',0);
  return {items:{marker:{zh:'MS2000 标记器',en:'MS2000 Marker'}},points:[point('a',[a,a]),point('b',[a],{candidate:true}),point('shared',[b,c],{poiTypes:['quest_interact']}),point('outside',[ref('q3','x','场外')],{outsideClientEnvelope:true}),point('missing',[ref('q4','x','无坐标')],{position:null})]};
}
test('task tree groups full objective descriptions under tasks, preserving order and unique point counts',()=>{
  const data=fixture(),index=createTaskPointIndex(data),task=index.byTask.get('q1');
  assert.equal(index.tasks.length,2);assert.equal(index.byKey.size,3);assert.equal(task.count,3);
  assert.deepEqual(task.objectives.map(row=>row.objectiveId),['visit','same']);
  assert.equal(task.objectives[1].label,'在吊车处使用 MS2000 标记器标记 BTR 站点');
  assert.equal(task.objectives[1].count,2);assert.equal(task.objectives[1].candidate,true);
  assert.deepEqual(taskPointKeys(data.points[0]),['quest:q1:same']);
  assert.equal(taskObjectiveKey({questId:'q1'}),null);
});
test('shared objective IDs across tasks remain independently selectable, and shared pins use union semantics',()=>{
  const data=fixture(),{taskIndex:index,members,types}=buildPointTypes(data),selected=new Set();
  assert.equal(types.length,3);assert.equal(types.find(row=>row.key==='quest:q1:same').count,2);
  selectTaskObjectives(index.byTask.get('q1').objectives,selected,true);
  assert.equal(matchesPointTypes(members.get('a'),selected),true);
  assert.equal(matchesPointTypes(members.get('shared'),selected),true);
  selectTaskObjectives([index.byKey.get('quest:q1:visit')],selected,false);
  assert.equal(matchesPointTypes(members.get('shared'),selected),false);
  selectTaskObjectives(index.byTask.get('q2').objectives,selected,true);
  selectTaskObjectives(index.byTask.get('q1').objectives,selected,false);
  assert.equal(matchesPointTypes(members.get('a'),selected),false);
  assert.equal(matchesPointTypes(members.get('shared'),selected),true);
  assert.deepEqual([...selected],['quest:q2:same']);
});
test('parent task checkbox reflects none, partial and complete objective selections without affecting other tasks',()=>{
  const index=createTaskPointIndex(fixture()),rows=index.byTask.get('q1').objectives,selected=new Set(['quest:q2:same']);
  assert.deepEqual(taskSelectionState(rows,selected),{count:0,checked:false,indeterminate:false});
  selectTaskObjectives([rows[0]],selected,true);
  assert.deepEqual(taskSelectionState(rows,selected),{count:1,checked:false,indeterminate:true});
  selectTaskObjectives(rows,selected,true);
  assert.deepEqual(taskSelectionState(rows,selected),{count:2,checked:true,indeterminate:false});
  selectTaskObjectives(rows,selected,false);assert.deepEqual([...selected],['quest:q2:same']);
  assert.equal(taskSelectionState([],selected).checked,false);
});
test('search matches task names, full goal descriptions, English, compatibility characters and combined words',()=>{
  const index=createTaskPointIndex(fixture());
  assert.equal(index.search('测试任务')[0].objectives.length,2);
  assert.equal(index.search('吊车')[0].objectives[0].objectiveId,'same');
  assert.equal(index.search('测试任务 酒店')[0].objectives[0].objectiveId,'visit');
  assert.equal(index.search('ＭＳ２０００ BTR')[0].objectives[0].objectiveId,'same');
  assert.equal(index.search(' tEsT  tAsK ').length,2);
  assert.equal(index.search('q2 same')[0].task.id,'q2');
  assert.equal(index.search('不存在').length,0);assert.equal(index.search('   ').length,0);
});
test('all thirteen current task layers expose every located objective once, with descriptive searchable names',()=>{
  const directory=new URL('../../site/data/tasks/maps/',import.meta.url),files=fs.readdirSync(directory).filter(name=>name.endsWith('.json'));
  assert.equal(files.length,13);
  for(const file of files){
    const data=JSON.parse(fs.readFileSync(new URL(file,directory))),index=createTaskPointIndex(data),expected=new Map();
    for(const point of data.points){
      if(!point.quest||!point.position||point.outsideClientEnvelope)continue;
      for(const ref of point.questObjectives){const key=taskObjectiveKey(ref);assert.ok(key);if(!expected.has(key))expected.set(key,new Set());expected.get(key).add(point.id);}
    }
    assert.equal(index.byKey.size,expected.size,file);
    for(const [key,ids] of expected){
      const row=index.byKey.get(key);assert.deepEqual(row.pointIds,ids,`${file}: ${key}`);
      assert.ok(row.label&&!['安装标记器','调查 / 交互','任务物品','目标描述未收录'].includes(row.label),`${file}: ${row.label}`);
      assert.ok(index.search(row.label).some(entry=>entry.objectives.some(match=>match.key===key)),`${file}: ${key}`);
    }
    for(const task of index.tasks)assert.equal(index.search(task.name).find(entry=>entry.task.id===task.id).objectives.length,task.objectives.length);
  }
});
