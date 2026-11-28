import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {accessLabels,applyTaskAccess,objectivePreparation,preparationGroups} from '../../site/task-preparation.js';
import {taskAccessData} from '../../site/task-access-data.js';
const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
const catalog=read('site/data/tasks/catalog.json'),extra=read('site/data/tasks/preparation-items.json');
const c={...catalog,items:{...extra.items,...catalog.items}};
const byName=name=>c.tasks.find(t=>t.name===name);
const chosen=(...names)=>({selected:names.map(name=>byName(name).id)});
const withAccess=applyTaskAccess(c);
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

test('access requirements match the pinned task, objective, map and key IDs',()=>{
  const {source,tasks,items}=taskAccessData;
  assert.equal(source.eftBuild,c.source.eftBuild);
  assert.equal(source.sptCommit,c.source.sptCommit);
  const otherBuild={...c,source:{...c.source,eftBuild:source.eftBuild+1}};
  assert.equal(applyTaskAccess(otherBuild),otherBuild);
  assert.equal(applyTaskAccess({...c,source:undefined}).tasks,c.tasks);
  const seen=new Set();
  for(const [taskId,objectives] of Object.entries(tasks)){
    const task=withAccess.tasks.find(task=>task.id===taskId);
    assert.ok(task,taskId);
    for(const [objectiveId,access] of Object.entries(objectives)){
      const objective=task.objectives.find(o=>o.id===objectiveId);
      assert.equal(objective?.access,access,`${task.name} ${objectiveId}`);
      assert.ok(!['HandoverItem','SellItemToTrader'].includes(objective.type));
      for(const entry of access){
        assert.ok(c.maps.some(map=>map.id===entry.mapId));
        assert.ok(objective.mapIds.includes(entry.mapId),`${task.name} ${objective.text}`);
        assert.ok(entry.location&&Object.hasOwn(accessLabels,entry.bring||'required'));
        assert.ok(entry.options.length&&entry.options.every(group=>group.length));
        for(const id of entry.options.flat()){
          assert.ok(items[id].name&&withAccess.items[id].name,id);
          if(items[id].icon)assert.ok(fs.existsSync(new URL('../../site/'+items[id].icon,import.meta.url)),id);
          seen.add(id);
        }
      }
    }
  }
  assert.equal(seen.size,Object.keys(items).length);
});

test('a cross-map task adds its key only to the pickup and shares it with other tasks',()=>{
  const delivery=byName('往事速递'),progress=chosen('往事速递','挖矿');
  const groups=preparationGroups(withAccess,progress);
  const customs=groups.find(g=>g.id==='customs'),factory=groups.find(g=>g.id==='factory');
  assert.equal(customs.rows.length,1);
  const row=customs.rows[0];
  assert.deepEqual(row.options,[['5780d0532459777a5108b9a2']]);
  assert.equal(row.quantity,1);
  assert.deepEqual(row.uses.map(u=>u.task.name).sort(),['往事速递','挖矿']);
  assert.equal(row.foundInRaid,false);
  assert.equal(factory.rows.length,1);
  assert.equal(factory.rows[0].kind,'放置物品');
  assert.equal(factory.rows[0].access,undefined);
  progress.completed={[delivery.id]:['5968929e86f7740d121082d3']};
  assert.deepEqual(preparationGroups(withAccess,progress,{search:'Tarcone'}).flatMap(g=>g.rows[0].uses.map(u=>u.task.name)),['挖矿']);
});

test('on-site keys are linked to locked targets and disappear when those targets are complete',()=>{
  const task=byName('背景调查'),progress=chosen('背景调查');
  const groups=preparationGroups(withAccess,progress,{search:'机械钥匙 205'});
  assert.equal(groups[0].id,'customs');
  const row=groups[0].rows[0];
  assert.equal(row.kind,'开锁钥匙');
  assert.equal(row.uses[0].access.bring,'onSite');
  assert.match(row.uses[0].objective.text,/青铜怀表/);
  assert.match(row.uses[0].access.location,/油罐车/);
  progress.completed={[task.id]:[row.uses[0].objective.id]};
  assert.deepEqual(preparationGroups(withAccess,progress),[]);
  assert.deepEqual(preparationGroups(withAccess,chosen('鱼塘')),[]);
});

test('door access supports alternative keys, multiple locks and location-specific conditions',()=>{
  const [cargo]=preparationGroups(withAccess,chosen('神秘货物'));
  assert.deepEqual(cargo.rows[0].options,[['5a145d4786f7744cbb6f4a12'],['5a145d7b86f7744cbb6f4a13']]);
  const [provocation]=preparationGroups(withAccess,chosen('挑衅'),{search:'格栅'});
  assert.deepEqual(provocation.rows[0].options,[['5ad5d7d286f77450166e0a89','5addaffe86f77470b455f900']]);
  assert.match(provocation.rows[0].uses[0].access.note,/通电/);
  const [food]=preparationGroups(withAccess,chosen('好吃到上瘾'));
  assert.equal(food.rows[0].uses[0].access.bring,'conditional');
  assert.match(food.rows[0].uses[0].access.note,/候选刷新点/);
  const [season]=preparationGroups(withAccess,chosen('逐光而行 - 审慎信任'),{traderId:'seasonal',search:'白卡'});
  assert.equal(season.id,'labs');
  assert.deepEqual(season.rows[0].options,[['5c94bbff86f7747ee735c08f']]);
});
