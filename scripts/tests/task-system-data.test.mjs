import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTaskCatalog,taskGroup,isPositiveTaskRequirement,expandTaskObjectives,createMapTaskQuests} from '../lib/task-system-data.mjs';

const maps=[{id:'factory',name:'工厂',spt:'factory4_day',atlas:'factory_rework'},{id:'woods',name:'森林',spt:'woods',atlas:'woods'}];
const locationBases={factory4_day:{Id:'factory4_day',_Id:'factory-day-id'},factory4_night:{Id:'factory4_night',_Id:'factory-night-id'},woods:{Id:'woods',_Id:'woods-id'}};
const quest=(id,conditions=[],extra={})=>({_id:id,name:`${id} name`,description:`${id} description`,traderId:'trader',location:'any',tierAccessory:0,side:'Pmc',conditions:{AvailableForStart:[],AvailableForFinish:conditions,Fail:[],AutoStart:[]},localization:{ch:{[`${id} name`]:'测试任务',[`${id} description`]:'描述'}},...extra});
const run=(quests,extra={})=>buildTaskCatalog({quests,templates:{item:{_props:{QuestItem:false}},questItem:{_props:{QuestItem:true}}},locales:{ch:{'item Name':'物品','questItem Name':'任务道具'},en:{}},maps,locationBases,...extra});

test('profile dialogue flags are dialogue unlocks, not completed-quest counts or invented edges',()=>{
  const condition={id:'pre',conditionType:'GlobalVariableValue',target:'talkFlag',value:1,compareMethod:'>='};
  const quests={a:quest('a',[],{conditions:{AvailableForStart:[condition],AvailableForFinish:[]}})};
  const dialogue={elements:[{Id:'dialog',Trader:'trader',Lines:[{Id:'line',Trigger:{type:'Always'},Actions:[{id:'action',type:'SetVariable',variableId:'talkFlag',value:1,saveScope:'Profile'}]}]}]};
  const before=JSON.stringify({quests,dialogue}),result=run(quests,{dialogue}),task=result.catalog.tasks[0],pre=task.prerequisites[0];
  assert.equal(pre.textSource,'structured-dialogue');assert.ok(pre.text.includes('相关对话'));
  assert.equal(pre.progressRequirement,undefined);assert.deepEqual(task.dependencies,[]);
  assert.equal(pre.dialogueRequirement.providers[0].pointer,'/elements/0/Lines/0/Actions/0');
  assert.deepEqual(pre.raw,condition);assert.equal(JSON.stringify({quests,dialogue}),before);
  assert.equal(result.audit.warnings.filter(w=>w.type==='unresolvedProgressRequirement').length,0);
  for(const action of [{value:0,saveScope:'Profile'},{value:1,saveScope:'Dialogue'}]){
    const invalid=structuredClone(dialogue);Object.assign(invalid.elements[0].Lines[0].Actions[0],action);
    const unresolved=run(quests,{dialogue:invalid});assert.equal(unresolved.catalog.tasks[0].prerequisites[0].dialogueRequirement,undefined);
    assert.equal(unresolved.audit.warnings.filter(w=>w.type==='unresolvedProgressRequirement').length,1);
  }
});

test('progress contributors exclude the current and equally or more restricted tasks and preserve filler capacity',()=>{
  const gated=(id,value)=>quest(id,[],{conditions:{AvailableForStart:[{id:`pre-${id}`,conditionType:'GlobalVariableValue',target:'g',value,compareMethod:'>='}],AvailableForFinish:[]}});
  const quests={a:gated('a',2),b:quest('b'),c:gated('c',1),d:gated('d',2),e:gated('e',3)};
  const pre=run(quests,{questVariables:{g:{quests:{a:'aFlag',b:'bFlag',c:'cFlag',d:'dFlag',e:'eFlag'},fillers:[{members:3,quests:['b']}],notMembers:[]}}}).catalog.tasks[0].prerequisites[0];
  assert.deepEqual(pre.progressRequirement.contributors.map(r=>[r.taskId,r.contribution]),[['b',1],['c',1]]);
  assert.equal(pre.progressRequirement.alternatives[0].capacity,3);assert.equal(pre.progressRequirement.alternatives[0].contribution,3);assert.equal(pre.progressRequirement.alternatives[0].sourceUncertain,true);
  assert.deepEqual(pre.taskIds,[]);assert.equal(pre.positiveDependency,false);
});

test('story rewards and crafted quest items show acquisition without inventing map locations',()=>{
  const story=quest('a',[{id:'read',conditionType:'CompletableItem',target:'item'},{id:'find',conditionType:'FindItem',target:'questItem'}],{location:'woods-id'});
  const giver=quest('giver',[],{notDisplayedQuest:true,rewards:{Started:[{id:'reward',type:'Item',items:[{_tpl:'item'}]}]}});
  const task=run({a:story,giver},{production:{recipes:[{_id:'recipe',endProduct:'questItem'}]}}).catalog.tasks[0];
  assert.deepEqual(task.mapIds,[]);assert.equal(task.objectives[0].locationScope,'nonspatial');
  assert.deepEqual(task.objectives[0].acquisition.items[0].rewards,[{questId:'giver',phase:'Started',rewardId:'reward'}]);
  assert.deepEqual(task.objectives[1].acquisition.items[0].recipeIds,['recipe']);
  assert.deepEqual(task.objectives[0].raw,story.conditions.AvailableForFinish[0]);
});

test('known world spawns win over crafting and scheme rewards do not imply a granted item',()=>{
  const a=quest('a',[{id:'read',conditionType:'CompletableItem',target:'item'}]);
  const giver=quest('giver',[],{notDisplayedQuest:true,rewards:{Started:[{id:'scheme',type:'ProductionScheme',items:[{_tpl:'item'}]}]}});
  assert.equal(run({a,giver}).catalog.tasks[0].objectives[0].acquisition,undefined);
  const task=run({a,giver},{production:{recipes:[{_id:'recipe',endProduct:'item'}]},mapLayers:{factory:{points:[{questObjectives:[{questId:'a',objectiveId:'read'}]}]}}}).catalog.tasks[0];
  assert.equal(task.objectives[0].acquisition,undefined);assert.deepEqual(task.objectives[0].mapIds,['factory']);
});

test('source tier is independent of story and loyalty; absent nullable fields remain flagged',()=>{
  assert.equal(taskGroup({tierAccessory:0,isStoryQuest:false}).group,'core');
  assert.equal(taskGroup({tierAccessory:4,isStoryQuest:true}).group,'4');
  assert.deepEqual(taskGroup({}),{group:'core',groupSource:'unassigned',groupUnspecified:true,tierAccessory:null});
  const q=quest('a',[],{conditions:{AvailableForStart:[{id:'ll',conditionType:'TraderLoyalty',target:'trader',compareMethod:'>=',value:4}],AvailableForFinish:[]}});
  const task=run({a:q}).catalog.tasks[0];assert.equal(task.group,'core');assert.equal(task.loyaltyLevel,4);
});

test('failed, excluded and mixed alternative prerequisites are not positive completion edges',()=>{
  const c={conditionType:'Quest',target:'a',status:[4]};
  assert.equal(isPositiveTaskRequirement(c),true);
  assert.equal(isPositiveTaskRequirement({...c,status:[2,4]}),true);
  assert.equal(isPositiveTaskRequirement({...c,status:[5]}),false);
  assert.equal(isPositiveTaskRequirement({...c,status:[4,5]}),false);
  assert.equal(isPositiveTaskRequirement({...c,compareMethod:'!='}),false);
});

test('multi-map requirements map exact location aliases including factory night',()=>{
  const c={id:'goal',conditionType:'CounterCreator',value:5,counter:{conditions:[{conditionType:'Location',target:['factory-night-id','woods-id']},{conditionType:'Kills',target:'AnyPmc'}]}};
  const task=run({a:quest('a',[c])}).catalog.tasks[0];
  assert.deepEqual(task.mapIds,['factory','woods']);assert.deepEqual(task.objectives[0].raw,c);
});

test('pure collections do not inherit incidental quest-map annotation; actual quest item pins do',()=>{
  const handover={id:'hand',conditionType:'HandoverItem',target:['item'],value:3,onlyFoundInRaid:true};
  const q=quest('a',[handover],{location:'woods-id'}),task=run({a:q}).catalog.tasks[0];
  assert.deepEqual(task.mapIds,[]);assert.equal(task.objectives[0].foundInRaid,true);
  const find={id:'find',conditionType:'FindItem',target:['questItem'],value:1};
  const located=run({a:quest('a',[find])},{mapLayers:{factory:{points:[{questObjectives:[{questId:'a',objectiveId:'find'}]}]}}}).catalog.tasks[0];
  assert.deepEqual(located.mapIds,['factory']);
});

test('quest-local official text takes precedence and every original condition is retained',()=>{
  const c={id:'goal',conditionType:'FindItem',target:['item'],value:1,customField:{mustRemain:true},isNecessary:false};
  const q=quest('a',[c]);q.localization.ch.goal='任务内官方原文';
  const before=JSON.stringify(q),task=run({a:q},{locales:{ch:{goal:'旧全局文本'},en:{}}}).catalog.tasks[0];
  assert.equal(task.objectives[0].text,'任务内官方原文');assert.equal(task.objectives[0].textSource,'quest:ch');
  assert.equal(task.objectives[0].optional,false);assert.deepEqual(task.conditions,q.conditions);assert.equal(JSON.stringify(q),before);
});

test('named visible tasks only; missing source translations are clearly structured rather than official',()=>{
  const a=quest('a',[{id:'goal',conditionType:'HandoverItem',target:['item'],value:2}]);
  const b=quest('b',[],{notDisplayedQuest:true}),c=quest('c',[],{localization:{ch:{},en:{}}});
  const result=run({a,b,c});assert.equal(result.catalog.tasks.length,1);assert.equal(result.audit.omitted.length,2);
  const objective=result.catalog.tasks[0].objectives[0];assert.equal(objective.textSource,'structured');assert.equal(objective.textMissing,true);assert.match(objective.text,/交付物品 × 2/);
});

test('internal story steps expand real child objectives with source and parent constraints preserved',()=>{
  const parentCondition={id:'chapter',conditionType:'Quest',target:'hidden',status:[4]},childCondition={id:'leaf',conditionType:'FindItem',target:['questItem'],value:1};
  const parent=quest('a',[parentCondition],{isStoryQuest:true});
  const hidden=quest('hidden',[childCondition],{location:'woods-id',notDisplayedQuest:true,localization:{ch:{leaf:'找到调查记录'}}});
  const rows=expandTaskObjectives(parent,{a:parent,hidden},{ch:{},en:{}});
  assert.equal(rows.length,1);assert.equal(rows[0].sourceQuestId,'hidden');assert.deepEqual(rows[0].parents[0].condition,parentCondition);
  const task=run({a:parent,hidden}).catalog.tasks[0];assert.equal(task.objectives[0].text,'找到调查记录');assert.deepEqual(task.mapIds,['woods']);
  assert.deepEqual(task.conditions.AvailableForFinish,[parentCondition]);assert.deepEqual(task.objectives[0].raw,childCondition);
  const mapQuest=createMapTaskQuests({a:parent,hidden},{ch:{},en:{}}).a;assert.equal(mapQuest.localization.ch.leaf,'找到调查记录');assert.equal(mapQuest.conditions.AvailableForFinish[0].id,'leaf');
});

test('named task completion remains a task requirement, not duplicated child checklists',()=>{
  const a=quest('a',[{id:'need-b',conditionType:'Quest',target:'b',status:[4]}]),b=quest('b',[{id:'leaf',conditionType:'FindItem',target:['item']}]);
  assert.equal(run({a,b}).catalog.tasks[0].objectives[0].type,'Quest');
});

test('N-of-M progress groups keep alternatives without inventing all-required arrows',()=>{
  const a=quest('a',[],{conditions:{AvailableForStart:[{id:'progress',conditionType:'GlobalVariableValue',target:'g',value:1,compareMethod:'>='}],AvailableForFinish:[]}}),b=quest('b'),c=quest('c');
  const task=run({a,b,c},{questVariables:{g:{quests:{b:'vb',c:'vc'},fillers:[],notMembers:[]}}}).catalog.tasks[0];
  assert.deepEqual(task.dependencies,[]);assert.deepEqual(task.prerequisites[0].taskIds,[]);assert.deepEqual(task.prerequisites[0].relatedTaskIds,['b','c']);assert.equal(task.prerequisites[0].requiredValue,1);assert.equal(task.prerequisites[0].positiveDependency,false);
});

test('progress group membership in the current task never turns into a self prerequisite',()=>{
  const a=quest('a',[],{conditions:{AvailableForStart:[{id:'progress',conditionType:'GlobalVariableValue',target:'g',value:1,compareMethod:'>='}],AvailableForFinish:[]}}),b=quest('b');
  const pre=run({a,b},{questVariables:{g:{quests:{a:'va',b:'vb'},fillers:[],notMembers:[]}}}).catalog.tasks[0].prerequisites[0];
  assert.deepEqual(pre.relatedTaskIds,['b']);assert.deepEqual(pre.taskIds,[]);assert.equal(pre.text,'商人任务进度至少 1');
});

test('detail facets preserve FIR, dogtag thresholds, distances, time, body parts and equipment',()=>{
  const c={id:'goal',conditionType:'CounterCreator',value:2,oneSessionOnly:true,counter:{conditions:[{conditionType:'Kills',target:'AnyPmc',distance:{compareMethod:'>=',value:80},bodyPart:['Head'],daytime:{from:22,to:5},weapon:['item']},{conditionType:'Equipment',equipmentInclusive:[['questItem']]}]}};
  const hand={id:'hand',conditionType:'HandoverItem',target:['item'],value:1,onlyFoundInRaid:true,dogtagLevel:20};
  const task=run({a:quest('a',[c,hand])},{locales:{ch:{Head:'头部','item Name':'步枪','questItem Name':'护甲'},en:{}}}).catalog.tasks[0];
  assert.ok(task.objectives[0].details.includes('距离至少 80 米'));assert.ok(task.objectives[0].details.includes('命中部位：头部'));assert.ok(task.objectives[0].details.includes('战局时间：22:00–5:00'));assert.ok(task.objectives[0].details.includes('允许装备组合：护甲'));
  assert.ok(task.objectives[1].details.includes('狗牌等级至少 20'));assert.ok(task.objectives[1].details.some(text=>text.includes('在战局中找到')));
});

test('unrestricted combat spans maps while unknown explicit locations are never guessed',()=>{
  const any={id:'any',conditionType:'CounterCreator',value:2,counter:{conditions:[{conditionType:'Kills',target:'AnyPmc'}]}};
  const specific={...any,id:'unknown',counter:{conditions:[...any.counter.conditions,{conditionType:'Location',target:['not-a-known-map']}]}};
  const task=run({a:quest('a',[any,specific])}).catalog.tasks[0];
  assert.deepEqual(task.objectives[0].mapIds,['factory','woods']);assert.deepEqual(task.objectives[1].mapIds,[]);assert.deepEqual(task.objectives[1].unmappedLocations,['not-a-known-map']);
});
