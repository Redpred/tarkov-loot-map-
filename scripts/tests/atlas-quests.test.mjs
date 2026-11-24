import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAtlasQuests} from '../lib/atlas-quests.mjs';
import {resolveQuestLocale} from '../lib/quest-localization.mjs';
import {pointTypeKeys,buildPointTypes,POI_TYPES} from '../../site/atlas-point-types.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
const quest=(id,conditions)=>({_id:id,name:id+' name',QuestName:id,traderId:'trader',conditions:{AvailableForFinish:conditions}});
const fixture=()=>({atlas:{},questScenes:{levels:[1,2],scenes:['Factory_Rework_Quests.unity','Factory_Rework_Night_Quests.unity']},loot:{points:[]},quests:{},templates:{},locales:{ch:{}},mapIds:['factory4_day','factory4_night']});
const zone=(name,pos,extra={})=>({name,pos,kind:'visit',outline:[[pos[0]-1,pos[1],pos[2]],[pos[0]+1,pos[1],pos[2]],[pos[0],pos[1],pos[2]+1]],lv:1,active:true,...extra});

test('supplement keeps Unity coordinates, strict component kinds and normalized serialized identifiers',()=>{
  const f=fixture(),position={x:10,y:2,z:-3},outline=[{x:9,y:2,z:-3}];
  f.atlas.quest_triggers=[zone('shared',[50,2,3],{kind:'place_item'})];
  f.positionSupplement={zones:[{name:'shared ',kind:'visit',position,outline,lv:1,active:true,sourceEvidence:{component:123}}],transits:[{name:'to_woods',position:{x:20,y:2,z:-4},active:true},{name:'to_woods',position:{x:999,y:2,z:3},active:false}]};
  f.quests={q:quest('q',[{id:'visit',conditionType:'VisitPlace',target:' shared'},{id:'exit',conditionType:'CounterCreator',counter:{conditions:[{conditionType:'ExitName',exitName:'to_woods '}]}}])};
  const result=buildAtlasQuests(f);
  assert.equal(result.points.length,2);
  assert.deepEqual(result.points[0].position,position);assert.deepEqual(result.points[0].outline,outline);
  assert.deepEqual(result.points[0].sourceEvidence,{component:123});assert.equal(result.points[1].position.x,20);
});

test('client events are scoped to both hidden story owner and goal, not reusable event names',()=>{
  const f=fixture();f.quests={chapter:quest('chapter',[{id:'goal',conditionType:'LocationTrigger',target:'open_door',_taskSourceQuestId:'hidden'}])};
  f.positionSupplement={interactions:[{sourceQuestId:'wrong',objectiveId:'goal',sourceId:'open_door',position:{x:999,y:0,z:0}},{sourceQuestId:'hidden',objectiveId:'wrong',sourceId:'open_door',position:{x:999,y:0,z:0}},{sourceQuestId:'hidden',objectiveId:'goal',sourceId:'on_repair_complete',position:{x:12,y:3,z:4},sourceEvidence:{handler:1,anchor:2}}]};
  const points=buildAtlasQuests(f).points;
  assert.equal(points.length,1);assert.equal(points[0].position.x,12);assert.equal(points[0].questObjectives[0].questId,'chapter');assert.equal(points[0].poiTypes[0],'quest_interact');
});

test('readable story items can use ordinary templates; only positive spawn alternatives get pins',()=>{
  const f=fixture();f.templates={note:{_props:{QuestItem:false}}};
  f.quests={q:quest('q',[{id:'read',conditionType:'CompletableItem',target:'note'},{id:'place',conditionType:'LeaveItemAtLocation',target:'note',zoneId:'missing'}])};
  f.loot.points=[{kind:'loose',candidates:[{tpl:'note',weight:1}],position:{x:999,y:0,z:0},groupPositions:[{Weight:1,Position:{x:2,y:3,z:4}},{Weight:0,Position:{x:888,y:0,z:0}}],sourceEvidence:{commit:'pinned'}},{kind:'loose',candidates:[{tpl:'note',weight:0}],position:{x:777,y:0,z:0}}];
  const points=buildAtlasQuests(f).points;
  assert.equal(points.length,1);assert.equal(points[0].candidate,true);assert.deepEqual(points[0].position,{x:2,y:3,z:4});assert.deepEqual(points[0].questObjectives.map(r=>r.objectiveId),['read']);assert.deepEqual(points[0].sourceEvidence,{commit:'pinned'});
});

test('quest localization prefers exact inline text and falls back only within the requested language',()=>{
  const q={localization:{ch:{name:'任务原文',empty:'  ',number:7},en:{name:'Quest name',englishOnly:'English only'}}};
  const locales={ch:{name:'全局旧名称',empty:'全局目标',number:'全局数字目标'},en:{englishOnly:'Global English',missing:'English fallback'}};
  assert.deepEqual(resolveQuestLocale(q,'name','ch',locales),{key:'name',language:'ch',text:'任务原文',source:'quest'});
  assert.deepEqual(resolveQuestLocale(q,'empty','ch',locales),{key:'empty',language:'ch',text:'全局目标',source:'global'});
  assert.equal(resolveQuestLocale(q,'number','ch',locales).text,'全局数字目标');
  for(const key of ['englishOnly','missing'])assert.deepEqual(resolveQuestLocale(q,key,'ch',locales),{key,language:'ch',text:null,source:null});
  assert.deepEqual(resolveQuestLocale(q,'name','en',locales),{key:'name',language:'en',text:'Quest name',source:'quest'});
  assert.equal(resolveQuestLocale(q,'absent','ch').text,null);
});

test('map objectives use inline Chinese with traceable language and keep every scene position unchanged',()=>{
  const f=fixture();f.questScenes.quest_triggers=[zone('target',[10,2,3]),zone('target',[20,2,3])];
  f.quests={q:quest('q',[{id:'visit',conditionType:'CounterCreator',counter:{conditions:[{conditionType:'VisitPlace',target:'target'}]}}])};
  f.locales={ch:{'q name':'全局任务','visit':'全局目标'},en:{'q name':'Global name','visit':'Global objective'}};
  const before=buildAtlasQuests(f);
  f.quests.q.localization={ch:{'q name':'任务中文','visit':'查找指定地点'},en:{'q name':'Inline name','visit':'Find the location'}};
  const after=buildAtlasQuests(f),ref=after.points[0].questObjectives[0];
  assert.equal(ref.name,'任务中文');assert.equal(ref.en,'Inline name');assert.equal(ref.text,'查找指定地点');
  assert.deepEqual(ref.localization,{name:{key:'q name',language:'ch',source:'quest'},objective:{key:'visit',language:'ch',source:'quest'}});
  assert.equal(after.quests[0].name,'任务中文');assert.match(after.points[0].searchText,/查找指定地点/);
  const geometry=d=>d.points.map(({id,sourceId,position,outline,positionSource,poiTypes,sceneVariants})=>({id,sourceId,position,outline,positionSource,poiTypes,sceneVariants}));
  assert.deepEqual(geometry(after),geometry(before));assert.deepEqual(after.stats,before.stats);
});

test('map display fallback is recorded as English or unattributed, never as a Chinese translation',()=>{
  const f=fixture();f.questScenes.quest_triggers=[zone('target',[10,2,3])];
  f.quests={q:quest('q',[{id:'visit',conditionType:'VisitPlace',target:'target'}])};
  f.quests.q.localization={ch:{'q name':'','visit':' '},en:{'q name':'English quest','visit':'English objective'}};
  let ref=buildAtlasQuests(f).points[0].questObjectives[0];
  assert.equal(ref.name,'English quest');assert.equal(ref.text,'English objective');
  assert.deepEqual(ref.localization,{name:{key:'q name',language:'en',source:'quest'},objective:{key:'visit',language:'en',source:'quest'}});
  f.quests.q.localization={};
  ref=buildAtlasQuests(f).points[0].questObjectives[0];
  assert.equal(ref.name,'q');assert.equal(ref.text,'查看游戏内任务目标');
  assert.deepEqual(ref.localization,{name:{key:'q name',language:null,source:null},objective:{key:'visit',language:null,source:null}});
});

test('exact zone joins retain separate boxes, collapse day/night duplicates and reject disabled or similarly named zones',()=>{
  const f=fixture(),a=zone('target',[10,2,3]),b=zone('target',[20,2,3]);
  f.questScenes.quest_triggers=[a,{...a,lv:2},b,zone('target',[30,2,3],{active:false}),zone('target_extra',[40,2,3])];
  f.quests={q:quest('q',[{id:'visit',conditionType:'CounterCreator',counter:{conditions:[{conditionType:'VisitPlace',target:'target'}]}}])};
  const d=buildAtlasQuests(f);assert.equal(d.points.length,2);
  assert.deepEqual(d.points[0].position,{x:-10,y:2,z:3});assert.deepEqual(d.points[0].outline[0],{x:-9,y:2,z:3});
  assert.deepEqual(d.points[0].sceneVariants,['白天','夜间']);assert.equal(d.stats.unmatchedZones,1);
});

test('map restrictions and trigger types prevent cross-map or visit/place misassociation',()=>{
  const f=fixture();f.questScenes.quest_triggers=[zone('shared',[0,1,0]),zone('shared',[5,1,0],{kind:'place_item'})];
  f.quests={wrong:quest('wrong',[{id:'wrong',conditionType:'CounterCreator',counter:{conditions:[{conditionType:'Location',target:['Woods']},{conditionType:'VisitPlace',target:'shared'}]}}]),
    place:quest('place',[{id:'place',conditionType:'LeaveItemAtLocation',zoneId:'shared',target:['tool'],plantTime:20,value:2}])};
  f.templates={tool:{_props:{}}};f.locales.ch={'place name':'测试任务','place':'放置工具','tool Name':'工具'};
  const d=buildAtlasQuests(f);assert.equal(d.points.length,1);assert.equal(d.points[0].position.x,-5);
  assert.deepEqual(d.points[0].questObjectives[0].items,['tool']);assert.equal(d.points[0].questObjectives[0].plantTime,20);assert.equal(d.points[0].questObjectives[0].count,2);
  assert.deepEqual(pointTypeKeys(d.points[0],d),['quest:place:place']);
});

test('only dedicated quest items become collection pins; current-client GUIDs replace stale static locations and group choices remain candidates',()=>{
  const f=fixture();f.templates={taskItem:{_props:{QuestItem:true}},ordinary:{_props:{QuestItem:false}}};
  f.questScenes.loose_points=[{pos:[10,2,3],templates:['taskItem'],guid:'known',active:true}];
  const spawn=(id,pos,extra={})=>({id,kind:'loose',sourceId:`item [${id}]`,position:pos,candidates:[{tpl:'taskItem',weight:null}],...extra});
  f.loot.points=[spawn('known',{x:999,y:2,z:3}),spawn('group',{x:555,y:2,z:3},{groupPositions:[{Position:{x:5,y:2,z:3},Weight:1},{Position:{x:6,y:2,z:3},Weight:0}]}),spawn('outside',{x:777,y:2,z:3},{outsideClientEnvelope:true})];
  f.quests={q:quest('q',[{id:'find',conditionType:'FindItem',target:['taskItem']},{id:'handover',conditionType:'HandoverItem',target:['taskItem']},{id:'ordinary',conditionType:'FindItem',target:['ordinary']}]),q2:quest('q2',[{id:'find2',conditionType:'FindItem',target:['taskItem']}])};
  const d=buildAtlasQuests(f);assert.equal(d.points.length,2);assert.equal(d.stats.clientPoints,1);assert.equal(d.stats.sptPoints,1);
  assert.deepEqual(d.points.map(p=>p.position.x),[-10,5]);assert.ok(d.points.every(p=>p.questObjectives.length===2));assert.ok(!d.items.ordinary);
});

test('SPT 5 multi-zone placement and beacon objectives retain every exact scene location',()=>{
  const f=fixture();
  f.questScenes.quest_triggers=[zone('a',[1,2,3],{kind:'place_item'}),zone('b',[4,2,3],{kind:'place_item'}),zone('a',[99,2,3]),zone('stale',[80,2,3],{kind:'place_item'})];
  f.quests={q:quest('q',[{id:'place',conditionType:'LeaveItemAtLocation',zoneIds:['a','b','a'],zoneId:'stale',target:['tool'],value:2,plantTime:20},{id:'mark',conditionType:'PlaceBeacon',zoneIds:['b','missing'],target:['marker'],value:1,plantTime:30}])};
  f.templates={tool:{_props:{}},marker:{_props:{}}};
  const d=buildAtlasQuests(f),placed=d.points.filter(p=>p.poiTypes.includes('quest_place')),marked=d.points.filter(p=>p.poiTypes.includes('quest_beacon'));
  assert.deepEqual(placed.map(p=>p.position.x),[-1,-4]);
  assert.equal(marked.length,1);assert.equal(marked[0].zone,'b');
  assert.equal(placed[0].questObjectives[0].count,2);assert.equal(placed[0].questObjectives[0].plantTime,20);
  assert.deepEqual(marked[0].questObjectives[0].items,['marker']);assert.equal(marked[0].questObjectives[0].plantTime,30);
});

test('generated layers cover real named objectives with valid icons and preserve independent quest filters',()=>{
  const icons=read('site/data/icons/factory/manifest.json').entries;
  for(const map of ['factory','streets']){
    const d=read(`site/data/${map}-quests.json`);assert.equal(d.points.length,new Set(d.points.map(p=>p.id)).size);assert.ok(d.stats.quests>=20);
    for(const p of d.points){assert.ok(Object.values(p.position).every(Number.isFinite));assert.ok(icons[p.icon]);assert.ok(p.poiTypes.every(t=>POI_TYPES[t]));assert.ok(p.questObjectives.length);for(const ref of p.questObjectives)for(const tpl of ref.items)assert.ok(d.items[tpl]);}
    assert.ok(buildPointTypes(d).types.every(t=>t.group==='quest'));
    if(map==='factory')assert.ok(d.points.some(p=>p.zone==='case_extraction'&&p.questObjectives.some(r=>r.name==='往事速递')));
    else {const audit=d.points.filter(p=>p.questObjectives.some(r=>r.name==='审计'));assert.equal(audit.length,1);assert.equal(audit[0].positionSource,'atlas-client');assert.deepEqual(audit[0].position,{x:-177.12,y:6.15,z:227.13});}
  }
});
