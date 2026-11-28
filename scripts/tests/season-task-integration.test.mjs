import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applySeasonSupplement} from '../lib/season-task-supplement.mjs';
import {createTaskStore,TASK_STORE_KEY} from '../../site/task-store.js';
import {taskPrerequisiteState} from '../../site/task-requirements.js';
import {matchesTaskCategory} from '../../site/task-presentation.js';
import {createTaskMapIndex} from '../../site/task-map-index.js';
import {objectivePreparation} from '../../site/task-preparation.js';
import {rebindTaskVolumes} from '../lib/task-volume-binding.mjs';

const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const catalog=read('site/data/tasks/catalog.json'),supplement=read('data/tasks/20261019-season-flow/supplement.json');
const task=label=>catalog.tasks.find(t=>t.flowLabel===label);
const maps=Object.fromEntries(catalog.maps.map(m=>[m.id,read(`site/data/tasks/maps/${m.id}.json`)]));
test('31 shared records, 28 additions, stable quest IDs and valid objective maps',()=>{
  assert.equal(catalog.tasks.length,550);assert.equal(new Set(catalog.tasks.map(t=>t.id)).size,550);
  const flow=catalog.tasks.filter(t=>t.seasonFlowId);assert.equal(flow.length,31);
  assert.equal(flow.filter(t=>t.seasonId).length,20);
  for(const t of flow){
    assert.equal(new Set(t.objectives.map(o=>o.id)).size,t.objectives.length);
    for(const m of [...t.mapIds,...t.objectives.flatMap(o=>o.mapIds)])assert.ok(maps[m],`${t.name}: ${m}`);
    for(const p of t.prerequisites)for(const id of p.taskIds||[])assert.ok(catalog.tasks.some(t=>t.id===id),id);
  }
  assert.equal(matchesTaskCategory(task('B01'),'seasonal',{overview:true}),true);
  assert.equal(matchesTaskCategory(task('B01'),task('B01').traderId,{overview:true}),true);
});
test('SPT conditions and all original objective IDs survive normalization; corrected fields win over old text',()=>{
  const original=read('work/season-complete-flow-20261019/spt-lightkeeper-chain.json');
  for(const source of original){const t=catalog.tasks.find(t=>t.id===source.id);assert.deepEqual(t.conditions,source.conditions);assert.deepEqual(t.objectives.map(o=>o.id),source.conditions.AvailableForFinish.map(c=>c.id));}
  assert.equal(task('B02').objectives[1].count,1);
  assert.equal(task('B08').objectives[0].count,2);
  assert.equal(task('B09').objectives[0].foundInRaid,false);
  assert.ok(task('B09').objectives[0].text.includes('不要求战局中找到'));
  assert.equal(task('B02').prerequisites[0].raw.availableAfter,600);
  assert.equal(task('B04').prerequisites[0].taskId,task('B03').id);
});
test('OR branches, explicitly accepted states, waits, and independent stage ordering',()=>{
  const branch=task('A12').prerequisites[0];
  for(const id of [task('A10').id,task('A11').id])assert.equal(taskPrerequisiteState(branch,{finished:[id]}).status,'met');
  assert.equal(taskPrerequisiteState(branch,{finished:[]}).status,'pending');
  const accept=task('B07').prerequisites[0];
  assert.equal(taskPrerequisiteState(accept,{selected:[task('B06').id]}).status,'unknown');
  assert.equal(taskPrerequisiteState(accept,{accepted:[task('B06').id]}).status,'met');
  assert.equal(taskPrerequisiteState(task('B02').prerequisites[0],{finished:[task('B01').id]}).status,'unknown');
  assert.ok(!task('B01').dependencies.includes(task('A14').id));
  assert.deepEqual(task('C03').dependencies,[task('C02').id]);
  assert.deepEqual(task('C01').mapIds,['shoreline','lighthouse','reserve','woods']);
  assert.ok(task('C02').objectives[3].text.includes('集装箱'));
});
test('old v1 progress and map overrides persist when acceptance is added and completion is undone',()=>{
  const t=task('B01'),o=t.objectives[0].id;
  const prior={version:1,selected:[t.id,'legacy-q'],finished:[],completed:{[t.id]:[o]},hidden:{customs:{'legacy-q':['legacy-o']}},shown:{},disabled:{},mapEnabled:{woods:false},loyaltyLevels:{[t.traderId]:3}};
  let value=JSON.stringify(prior);const storage={getItem:()=>value,setItem:(key,v)=>{assert.equal(key,TASK_STORE_KEY);value=v;}};
  const a=createTaskStore({storage,eventTarget:new EventTarget()});a.setTaskAccepted(t.id,true);
  assert.deepEqual(a.getState().selected,prior.selected);
  a.setTaskCompleted(t.id,true);a.setTaskCompleted(t.id,false);
  const b=createTaskStore({storage,eventTarget:new EventTarget()});
  const expected={...prior,selected:['legacy-q']};
  for(const [key,entry] of Object.entries(expected))assert.deepEqual(b.getState()[key],entry);
  assert.ok(b.isTaskAccepted(t.id));assert.ok(b.isCompleted(t.id,o));a.destroy();b.destroy();
});
test('only four direct client targets are added; ordinary loot and enemy candidates are not inferred for this flow',()=>{
  const points=Object.values(maps).flatMap(m=>m.points).filter(p=>p.seasonSupplement);
  assert.equal(points.length,4);assert.equal(new Set(points.map(p=>p.id)).size,4);
  const evidence=read('work/season-inspection-20261014/season-evidence.json').taskObjects;
  for(const p of points){const e=evidence.find(x=>x.objectId===p.sourceId);assert.deepEqual(p.position,e.position);assert.equal(p.questObjectives[0].objectiveId,e.conditionId);}
  const t=task('A06'),tpl=t.objectives[0].itemIds[0],data={points:[{id:'ordinary',position:{x:0,y:0,z:0},candidates:[{tpl}]}]};
  const index=createTaskMapIndex({catalog:{tasks:[t]},data,mapId:'woods',itemIndex:{matches:()=>true}});
  assert.deepEqual(index.entries([t.id]),[]);
  const direct=createTaskMapIndex({catalog,data:maps.customs,mapId:'customs',itemIndex:{matches:()=>false}}).entries([task('A13').id])[0];
  assert.equal(direct.objectives.reduce((n,o)=>n+o.points.size,0),2);
});
test('merge is idempotent; new placement/equipment requirements produce preparation without pickup inflation',()=>{
  const manifest=catalog.source.supplements.find(x=>x.id===supplement.id);
  const one=applySeasonSupplement(catalog,maps,{data:supplement,manifestSha256:manifest.manifestSha256});
  const two=applySeasonSupplement(one.catalog,one.mapLayers,{data:supplement,manifestSha256:manifest.manifestSha256});
  assert.deepEqual(one,two);
  assert.equal(task('A03').objectives.flatMap(objectivePreparation).reduce((n,x)=>n+x.quantity,0),6);
  assert.equal(task('A05').objectives.flatMap(objectivePreparation).length,0);
  assert.equal(task('B04').objectives.flatMap(objectivePreparation).reduce((n,x)=>n+x.quantity,0),4);
  assert.equal(task('P03').objectives.flatMap(objectivePreparation).reduce((n,x)=>n+x.quantity,0),3);
});
test('verified volumes survive marker additions but reject moved originals or unverified shapes',()=>{
  const sidecar=read('site/data/tasks/volumes/customs.json'),current=maps.customs;
  assert.deepEqual(rebindTaskVolumes(sidecar,current,current),sidecar);
  const added=structuredClone(current);added.points.push({id:'new-marker',position:{x:0,y:0,z:0}});
  assert.deepEqual(rebindTaskVolumes(sidecar,current,added).points,sidecar.points);
  const moved=structuredClone(current);moved.points[0].position.x+=1;
  assert.throws(()=>rebindTaskVolumes(sidecar,current,moved),/Task point changed/);
  added.points.at(-1).outline=[{x:0,z:0},{x:1,z:0},{x:0,z:1}];
  assert.throws(()=>rebindTaskVolumes(sidecar,current,added),/Missing verified task volume/);
});
