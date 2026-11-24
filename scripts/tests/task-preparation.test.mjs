import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {objectivePreparation,preparationGroups} from '../../site/task-preparation.js';
const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
const catalog=read('site/data/tasks/catalog.json'),extra=read('site/data/tasks/preparation-items.json');
const c={...catalog,items:{...extra.items,...catalog.items}};
const byName=name=>c.tasks.find(t=>t.name===name);
const chosen=(...names)=>({selected:names.map(name=>byName(name).id)});
const a='aaaaaaaaaaaaaaaaaaaaaaaa',b='bbbbbbbbbbbbbbbbbbbbbbbb',d='dddddddddddddddddddddddd';

test('marker quantities sum per map and disappear independently with objective/task completion',()=>{
  const task=byName('麻醉'),progress=chosen('麻醉');
  let groups=preparationGroups(c,progress);assert.equal(groups.length,1);assert.equal(groups[0].id,'shoreline');assert.equal(groups[0].rows[0].quantity,3);assert.equal(groups[0].rows[0].uses.length,3);
  progress.completed={[task.id]:[task.objectives[0].id]};assert.equal(preparationGroups(c,progress)[0].rows[0].quantity,2);
  progress.finished=[task.id];assert.equal(preparationGroups(c,progress).length,0);
  progress.finished=[];assert.equal(preparationGroups(c,progress)[0].rows[0].quantity,2);
});
test('delivery task item belongs only to its placement map, not its collection map',()=>{
  const groups=preparationGroups(c,chosen('往事速递'));
  assert.deepEqual(groups.map(g=>g.id),['factory']);assert.equal(groups[0].rows[0].quantity,1);
  const id=groups[0].rows[0].options[0][0];assert.equal(c.items[id].questItem,true);
});
test('collecting, handing in, assembling, selling and enemy/excluded gear are not carry requirements',()=>{
  for(const type of ['FindItem','HandoverItem','WeaponAssembly','SellItemToTrader','CompletableItem'])assert.deepEqual(objectivePreparation({type,itemIds:[a],raw:{target:[a]}}),[]);
  assert.deepEqual(objectivePreparation({type:'CounterCreator',raw:{counter:{conditions:[{conditionType:'Kills',enemyEquipmentInclusive:[[a]],weaponModsExclusive:[[b]]},{conditionType:'Equipment',equipmentExclusive:[[d]]}]}}}),[]);
});
test('equipment schemes retain OR between schemes and AND within a scheme; kill count is not gear count',()=>{
  const req=objectivePreparation({type:'CounterCreator',count:25,raw:{counter:{conditions:[{conditionType:'Kills',weapon:[a,b],weaponModsInclusive:[[a,b],[d]]},{conditionType:'Equipment',equipmentInclusive:[[b,d]]}]}}});
  assert.deepEqual(req.map(r=>r.options),[[[a],[b]],[[a,b],[d]],[[b,d]]]);assert.ok(req.every(r=>r.quantity===1&&!r.consumed));
});
test('reusable equipment is counted once while optional targets stay separate and unknown maps stay other',()=>{
  const goal={id:'o1',type:'HasItem',count:1,itemIds:[a],mapIds:[],raw:{target:[a]}};
  const fixture={maps:[{id:'woods',name:'森林'}],items:{[a]:{name:'道具'}},tasks:[{id:'t1',mapIds:['woods'],objectives:[goal,{...goal,id:'o2'},{...goal,id:'o3',optional:true}]},{id:'t2',objectives:[{...goal,id:'o1'}]}]};
  const groups=preparationGroups(fixture,{selected:['t1','t2']});assert.deepEqual(groups.map(g=>g.id),['other']);assert.equal(groups[0].rows.length,2);assert.equal(groups[0].rows[0].quantity,1);assert.equal(groups[0].rows[0].uses.length,3);
});
test('item, objective, task and map searches preserve only matching use associations',()=>{
  const progress=chosen('麻醉','往事速递');
  assert.deepEqual(preparationGroups(c,progress,{search:'MS2000 海岸线'}).map(g=>g.id),['shoreline']);
  assert.equal(preparationGroups(c,progress,{search:'第二处'})[0].rows[0].quantity,1);
  assert.equal(preparationGroups(c,progress,{traderId:'nonexistent'}).length,0);
  assert.equal(preparationGroups(c,{selected:[]}).length,0);
});
test('all explicit preparation item IDs have independent fixed-source metadata and assets exist when declared',()=>{
  assert.equal(extra.source.sptCommit,catalog.source.sptCommit);
  const ids=new Set(c.tasks.flatMap(t=>t.objectives.flatMap(o=>objectivePreparation(o).flatMap(r=>r.options.flat()))));
  assert.equal(ids.size,391);
  for(const id of ids){assert.ok(extra.items[id],id);if(extra.items[id].icon)assert.ok(fs.existsSync(new URL('../../site/'+extra.items[id].icon,import.meta.url)),id);}
  for(const input of extra.source.inputs)assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../../'+input.file,import.meta.url))).digest('hex'),input.sha256);
  const groups=preparationGroups(c,{selected:c.tasks.map(t=>t.id)});assert.equal(groups.length,14);
  for(const group of groups)for(const row of group.rows)assert.equal(new Set(row.uses.map(u=>u.task.id+':'+u.objective.id)).size,row.uses.length);
});
