import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {createTaskMapIndex as runtimeIndex} from '../site/task-map-index.js';

// Read-only audit of source requirements against current local task layers. Does
// not call the builder or change any map, source or browser progress data.
const root=path.resolve(import.meta.dirname,'..');
const read=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8').replace(/^\uFEFF/,''));
const hash=rel=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel))).digest('hex');
const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
const uniq=a=>[...new Set(a)];
const valid=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const xyz=p=>Array.isArray(p)?{x:-p[0],y:p[1],z:p[2]}:p;
const position=p=>[p.x,p.y,p.z].map(n=>n.toFixed(2)).join(',');
const nodes=c=>[c,...(c.counter?.conditions||[]).flatMap(nodes)];
const pkg='data/tasks/20261013-901f569',db=`${pkg}/raw/spt/database`;
const catalog=read('site/data/tasks/catalog.json'),templates=read(`${db}/templates/items.json`),rawQuests=read(`${db}/templates/quests.json`);
const repairPath=catalog.source.positionSupplement?.path;
const repairs=repairPath?read(`${repairPath}/positions.json`):{maps:{},storyLoot:[]};
const production=read(`${db}/hideout/production.json`),recipes=new Map();
for(const r of production.recipes||[]){if(!recipes.has(r.endProduct))recipes.set(r.endProduct,[]);recipes.get(r.endProduct).push(r._id??r.id);}
const loot=read(`${pkg}/derived/spt-quest-loot.json`),maps=Object.values(ATLAS_MAPS),aliases=new Map(),transits=[];
for(const m of maps){for(const alias of uniq([m.id,m.spt,m.atlas,...(m.sptAliases||[]),...(m.id==='factory'?['factory4_night']:[])])){
  aliases.set(alias.toLowerCase(),m.id);
  const basePath=`${db}/locations/${alias}/base.json`;
  if(fs.existsSync(path.join(root,basePath))){const base=read(basePath);for(const id of [base.Id,base._Id].filter(Boolean))aliases.set(id.toLowerCase(),m.id);for(const t of base.transits||[])transits.push({map:m.id,basePath,...t});}
}}
const sourceMaps=new Map(),mapRows=[],references=new Map(),integrity=[],layers={};
const pointItems=new Map(),ordinaryItems=new Map(),runtimeRows=new Map();
for(const m of maps){
  const atlas=read(`${pkg}/raw/eft/maps/${m.id}/gamedata.json`),scene=read(`${pkg}/raw/eft/maps/${m.id}/quest-scenes.json`),layer=read(`site/data/tasks/maps/${m.id}.json`);
  layers[m.id]=layer;
  sourceMaps.set(m.id,{zones:[...(atlas.quest_triggers||[]),...(scene.quest_triggers||[]),...(repairs.maps[m.id]?.zones||[])],items:[...(atlas.loose_points||[]),...(scene.loose_points||[])],exits:[...(atlas.exfils||[]),...(repairs.maps[m.id]?.transits||[])],interactions:repairs.maps[m.id]?.interactions||[],atlas});
  const seen=new Set(),objectiveRefs=new Set();
  for(const p of layer.points){
    if(seen.has(p.id)||!valid(p.position))integrity.push({map:m.id,point:p.id,type:'duplicate-or-invalid-position'});seen.add(p.id);
    if(p.itemId){if(!pointItems.has(p.itemId))pointItems.set(p.itemId,[]);pointItems.get(p.itemId).push({map:m.id,pointId:p.id,position:p.position});}
    for(const r of p.questObjectives){
      const key=`${r.questId}:${r.objectiveId}`,t=catalog.tasks.find(t=>t.id===r.questId),o=t?.objectives.find(o=>o.id===r.objectiveId);
      if(!o)integrity.push({map:m.id,point:p.id,type:'broken-task-reference',key});
      if(!references.has(key))references.set(key,[]);references.get(key).push({map:m.id,point:p});objectiveRefs.add(key);
    }
  }
  const data=read(`site/${m.data}`),poi=read(`site/data/${m.id}-pois.json`);
  data.points.push(...poi.points,...layer.points);data.items={...layer.items,...poi.items,...data.items};
  const start=performance.now(),index=runtimeIndex({catalog,data,mapId:m.id});
  const entries=index.entries(catalog.tasks.map(t=>t.id));
  for(const entry of entries)for(const row of entry.objectives){
    const key=`${entry.task.id}:${row.objective.id}`;if(!runtimeRows.has(key))runtimeRows.set(key,[]);
    runtimeRows.get(key).push({map:m.id,count:row.points.size,candidate:row.candidate,hint:row.hint});
  }
  // Independent reverse index for ordinary items, used to detect collection
  // goals with some missing alternatives rather than just any matching point.
  const add=(tpl,p)=>{if(!tpl)return;if(!ordinaryItems.has(tpl))ordinaryItems.set(tpl,new Set());ordinaryItems.get(tpl).add(m.id);};
  const candidates=c=>{if(c.weight!=null&&c.weight<=0)return [];return [c.tpl,...(c.included||[]).map(i=>i.tpl)];};
  for(const p of data.points){if(!valid(p.position)||p.outsideClientEnvelope)continue;
    if(p.kind==='loose')for(const c of p.candidates||[])for(const id of candidates(c))add(id,p);
    if(p.kind==='container')for(const c of [...(data.pools?.[p.pool]?.items||[]),...(p.forcedItems||[])])for(const id of candidates(c))add(id,p);
  }
  mapRows.push({map:m.id,name:m.name,points:layer.points.length,taskCount:layer.quests.length,objectiveCount:objectiveRefs.size,runtimeTaskCount:entries.length,runtimeObjectiveCount:entries.flatMap(e=>e.objectives).filter(o=>o.points.size).length,allSelectedAuditMs:Math.round(performance.now()-start)});
}
function requirement(type,id,kind){return {type,id,kind};}
function requirements(o){
  const list=[];
  for(const n of nodes(o.raw)){
    if(['LeaveItemAtLocation','PlaceBeacon'].includes(n.conditionType))for(const id of uniq(arr(n.zoneIds??n.zoneId)))list.push(requirement('zone',id,'place_item'));
    if(n.conditionType==='VisitPlace')for(const id of uniq(arr(n.target)))list.push(requirement('zone',id,'visit'));
    if(n.conditionType==='InZone')for(const id of uniq(arr(n.zoneIds)))list.push(requirement('zone',id,null));
    if(n.conditionType==='LaunchFlare')for(const id of uniq(arr(n.target)))list.push(requirement('zone',id,'flare'));
    if(n.conditionType==='ExitName')list.push(requirement('exit',n.exitName));
    if(n.conditionType==='FindItem')for(const id of uniq(arr(n.target)))if(templates[id]?._props?.QuestItem)list.push(requirement('item',id));
    if(n.conditionType==='CompletableItem')for(const id of uniq(arr(n.target)))list.push(requirement('story-item',id));
    if(n.conditionType==='LocationTrigger')for(const id of uniq(arr(n.target)))list.push(requirement('interaction',id));
  }
  return list;
}
function evidence(req,allowed,objective){
  const found=[],inactive=[],wrongKind=[];
  for(const [map,s] of sourceMaps){if(allowed.length&&!allowed.includes(map))continue;
    const rows=['item','story-item'].includes(req.type)?s.items.filter(r=>(r.templates||[]).includes(req.id)):req.type==='exit'?s.exits.filter(r=>r.name.trim()===req.id.trim()&&r.faction!=='scav'):s.zones.filter(r=>r.name.trim()===req.id.trim());
    for(const row of rows){if(!valid(xyz(row.position||row.pos)))continue;const record={map,position:xyz(row.position||row.pos),kind:row.kind,source:'client',id:req.id,guid:row.guid};if(row.active===false)inactive.push(record);else if(req.kind&&row.kind!==req.kind)wrongKind.push(record);else found.push(record);}
    for(const row of s.interactions)if(row.objectiveId===objective.id&&row.sourceQuestId===objective.sourceQuestId)found.push({map,position:row.position,source:'client',id:row.sourceId});
  }
  if(req.type==='story-item')for(const row of repairs.storyLoot){
    if(allowed.length&&!allowed.includes(row.mapId)||!row.candidates.some(c=>c.tpl===req.id&&(c.weight==null||c.weight>0)))continue;
    const positions=row.groupPositions?.length?row.groupPositions.filter(g=>g.Weight==null||g.Weight>0).map(g=>g.Position):[row.position];
    const guid=row.sourceId?.match(/\[([^\]]+)\]/)?.[1];
    if(!row.groupPositions?.length&&found.some(r=>r.map===row.mapId&&r.guid===guid&&guid))continue;
    for(const p of positions)if(valid(p))found.push({map:row.mapId,position:p,source:'spt',id:req.id});
  }
  if(req.type==='item')for(const row of loot.records){
    const map=aliases.get(row.location.toLowerCase());if(!map||allowed.length&&!allowed.includes(map)||!row.questItemTemplateIds.includes(req.id))continue;
    const template=row.raw.template;
    const rawPositions=template.GroupPositions?.length?template.GroupPositions.filter(g=>g.Weight==null||g.Weight>0).map(g=>g.Position):[template.Position];
    const guid=template.Id?.match(/\[([^\]]+)\]/)?.[1];
    if(!template.GroupPositions?.length&&found.some(r=>r.map===map&&r.source==='client'&&r.guid===guid&&guid))continue;
    for(const p of rawPositions)if(valid(p))found.push({map,position:p,source:'spt',id:req.id});
  }
  return {found,inactive,wrongKind};
}
function diagnostics(req,allowed,status){
  if(status==='located')return {reason:'located',trimmedMatches:[],transitDefinitions:[],craftRecipes:[]};
  const trimmedMatches=[];
  if(typeof req.id==='string'&&req.id!==req.id.trim())for(const [map,s] of sourceMaps){
    if(allowed.length&&!allowed.includes(map))continue;
    const rows=req.type==='exit'?s.exits:req.type==='zone'?s.zones:[];
    for(const r of rows)if(r.name===req.id.trim()&&r.active!==false&&valid(xyz(r.pos))&&(!req.kind||r.kind===req.kind)&&(req.type!=='exit'||r.faction!=='scav'))trimmedMatches.push({map,name:r.name,position:xyz(r.pos),kind:r.kind});
  }
  // These source definitions prove a transfer requirement, not the identity of
  // a client collider. Current exports keep transit GameObject names only.
  // Some base files repeat another map's transits; retain evidence without
  // assigning those duplicated definitions as verified point coordinates.
  const transitDefinitions=req.type==='exit'?transits.filter(t=>t.name===req.id).map(t=>({map:t.map,basePath:t.basePath,name:t.name,id:t.id,destination:t.location,active:t.active})):[];
  const craftRecipes=req.type==='item'?recipes.get(req.id)||[]:[];
  const reason=status==='trigger-kind-mismatch'?'trigger-kind-mismatch':trimmedMatches.length?'identifier-whitespace':transitDefinitions.length?'transit-not-joined':req.type==='interaction'?'interaction-not-supported':craftRecipes.length?'craft-product-no-world-spawn':req.type==='item'?'quest-item-source-unresolved':'zone-source-unresolved';
  return {reason,trimmedMatches,transitDefinitions,craftRecipes};
}
const objectives=[];
for(const t of catalog.tasks)for(const o of t.objectives){
  const key=`${t.id}:${o.id}`,refs=references.get(key)||[],runtime=runtimeRows.get(key)||[],children=nodes(o.raw);
  const explicitLocations=children.filter(n=>n.conditionType==='Location').flatMap(n=>arr(n.target));
  const allowed=explicitLocations.length?uniq(explicitLocations.map(x=>aliases.get(String(x).toLowerCase())).filter(Boolean)):[];
  const reqs=requirements(o).map(req=>{
    const e=evidence(req,allowed,o),actual=refs.filter(r=>['item','story-item'].includes(req.type)?r.point.itemId===req.id:r.point.sourceId.trim()===req.id.trim()||sourceMaps.get(r.map).interactions.some(i=>i.objectiveId===o.id&&i.sourceQuestId===o.sourceQuestId&&i.sourceId===r.point.sourceId));
    const missingSourcePositions=uniq(e.found.filter(r=>!actual.some(a=>a.map===r.map&&position(a.point.position)===position(r.position))).map(r=>`${r.map}:${position(r.position)}`));
    for(const a of actual)if(!e.found.some(r=>a.map===r.map&&position(a.point.position)===position(r.position)))integrity.push({type:'position-not-in-active-source',map:a.map,point:a.point.id,key,requirement:req});
    const status=actual.length?(missingSourcePositions.length?'partial':'located'):e.found.length?'source-present-not-linked':e.wrongKind.length?'trigger-kind-mismatch':e.inactive.length?'only-inactive-source':'source-position-missing';
    return {...req,status,...diagnostics(req,allowed,status),maps:uniq(actual.map(a=>a.map)),pointCount:actual.length,sourcePositionCount:uniq(e.found.map(r=>`${r.map}:${position(r.position)}`)).length,missingSourcePositions,inactiveMaps:uniq(e.inactive.map(r=>r.map)),wrongKind:e.wrongKind.map(r=>({map:r.map,kind:r.kind,position:r.position}))};
  });
  let category,status;
  if(o.type==='CompletableItem'){category='story-item-interaction';status=o.acquisition?.noFixedMapPoint?'nonspatial-acquisition':reqs.length&&reqs.every(r=>r.status==='located')?'located':reqs.some(r=>r.pointCount)?'partial':'unmapped-interaction';}
  else if(reqs.length&&reqs.every(r=>r.reason==='craft-product-no-world-spawn')){category='craft-product';status='source-recipe-confirmed';}
  else if(o.acquisition?.noFixedMapPoint){category='task-reward-item';status='source-reward-confirmed';}
  else if(reqs.length){category='fixed-location';status=reqs.every(r=>r.status==='located')?'complete':reqs.some(r=>r.pointCount)?'partial':'missing';}
  else if(o.type==='CompletableItem'){category='story-item-interaction';status=runtime.some(r=>r.count)?'candidate':'unmapped-interaction';}
  else if(['FindItem','HandoverItem','HasItem'].includes(o.type)){
    category='collection';status=runtime.some(r=>r.count)?'candidate':'no-map-candidate';
  }else if(children.some(n=>['Kills','Shots'].includes(n.conditionType))){category='combat-no-fixed-area';status=runtime.some(r=>r.count)?'candidate':'no-fixed-location';}
  else if(o.type==='Quest'&&arr(o.raw.target).some(id=>!rawQuests[id])){category='missing-story-source';status='unknown';}
  else {category='other-non-fixed-or-unresolved';status=refs.length?'located':'no-fixed-location';}
  objectives.push({taskId:t.id,taskName:t.name,objectiveId:o.id,sourceQuestId:o.sourceQuestId,type:o.type,text:o.text,mapIds:o.mapIds,acquisition:o.acquisition,sourceTaskMap:aliases.get(String(rawQuests[o.sourceQuestId]?.location).toLowerCase())||null,unmappedLocations:o.unmappedLocations,category,status,requirements:reqs,points:refs.length,pointMaps:uniq(refs.map(r=>r.map)),runtime,itemIds:o.itemIds,ordinaryItemCandidateMaps:Object.fromEntries((o.itemIds||[]).filter(id=>ordinaryItems.has(id)).map(id=>[id,[...ordinaryItems.get(id)]]))});
}
const tally=(values,key)=>values.reduce((out,v)=>(out[v[key]]=(out[v[key]]||0)+1,out),{});
const reqs=objectives.flatMap(o=>o.requirements),fixed=objectives.filter(o=>o.category==='fixed-location');
const gaps=fixed.filter(o=>o.status!=='complete');
for(const map of mapRows){
  // Only source coordinates prove map membership. A quest's metadata location
  // can be a fallback or wrong; do not inflate a map's completeness from it.
  map.knownCoordinateGaps=gaps.filter(o=>o.requirements.some(r=>[...r.wrongKind,...r.trimmedMatches].some(p=>p.map===map.map))).length;
}
const mapConflicts=gaps.filter(o=>o.mapIds.length&&o.requirements.some(r=>[...r.wrongKind,...r.trimmedMatches].some(p=>!o.mapIds.includes(p.map)))).map(o=>({taskId:o.taskId,taskName:o.taskName,objectiveId:o.objectiveId,text:o.text,catalogMapIds:o.mapIds,coordinateMapIds:uniq(o.requirements.flatMap(r=>[...r.wrongKind,...r.trimmedMatches].map(p=>p.map)))}));
const manifest=read(`${pkg}/manifest.json`),sourceIntegrity={checked:manifest.files.length,errors:[]};
for(const f of manifest.files)if(hash(`${pkg}/${f.path}`)!==f.sha256)sourceIntegrity.errors.push(f.path);
const summary={tasks:catalog.tasks.length,objectives:objectives.length,points:mapRows.reduce((s,m)=>s+m.points,0),references:[...references.values()].reduce((s,r)=>s+r.length,0),integrityErrors:integrity.length,sourceIntegrity,categories:tally(objectives,'category'),fixedStatus:tally(fixed,'status'),gapReasons:tally(gaps.flatMap(o=>o.requirements.filter(r=>r.status!=='located')),'reason'),requirementStatus:tally(reqs,'status'),collectionStatus:tally(objectives.filter(o=>o.category==='collection'),'status'),combatStatus:tally(objectives.filter(o=>o.category==='combat-no-fixed-area'),'status'),storyStatus:tally(objectives.filter(o=>o.category==='story-item-interaction'),'status'),storyGoalsWithOrdinaryCandidates:objectives.filter(o=>o.category==='story-item-interaction'&&Object.keys(o.ordinaryItemCandidateMaps).length).length,mapConflicts:mapConflicts.length};
const output='work/task-point-audit-20261013';fs.mkdirSync(path.join(root,output),{recursive:true});
const report={generatedAt:new Date().toISOString(),scope:'Current local task system; pinned SPT 901f569 and existing project EFT 47965 exports; no original EFT or server writes',source:catalog.source,inputHashes:{catalog:hash('site/data/tasks/catalog.json'),...Object.fromEntries(maps.map(m=>[m.id,hash(`site/data/tasks/maps/${m.id}.json`)]))},summary,maps:mapRows,integrity,mapConflicts,objectives};
fs.writeFileSync(path.join(root,output,'coverage.json'),JSON.stringify(report,null,2));
const labels={'trigger-kind-mismatch':'触发器类型冲突','identifier-whitespace':'标识首尾空格','transit-not-joined':'转移点尚未关联','interaction-not-supported':'机关交互尚未支持','zone-source-unresolved':'区域源未匹配','quest-item-source-unresolved':'专用道具来源未确认'};
const cell=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
const mapNames=ids=>uniq(ids).map(id=>ATLAS_MAPS[id]?.name||id).join('、');
const lines=['# 任务点位缺口逐项清单','',`生成时间：${report.generatedAt}。仅审计本地文件；完整源条件、坐标证据、版本指纹及其他未定位目标见 [coverage.json](coverage.json)。`,'',
  '以下按任务目标计数，不是独立坐标数。同一位置可服务多个任务或剧情分支。未将任务元数据的地图字段当作已核验坐标；没有坐标证据的项目保留“待核验”。','',
  '| 任务 | 目标 | 原因 | 已核验坐标所在图 | 条件标识 | 目标 ID |','|---|---|---|---|---|---|'];
for(const o of gaps)for(const r of o.requirements.filter(r=>r.status!=='located'))lines.push(`| ${cell(o.taskName)} | ${cell(o.text)} | ${labels[r.reason]||r.reason} | ${mapNames([...r.wrongKind,...r.trimmedMatches].map(p=>p.map))||'待核验'} | ${cell(JSON.stringify(r.id))} | ${o.objectiveId} |`);
lines.push('','## 已排除的制作产物','', '以下目标的模板在固定 SPT 源中存在藏身处制作配方，没有已收录的世界刷新坐标，不将其算作漏掉的固定刷新点。','', '| 任务 | 目标 | 物品模板 | 制作配方 ID |','|---|---|---|---|');
for(const o of objectives.filter(o=>o.category==='craft-product'))lines.push(`| ${cell(o.taskName)} | ${cell(o.text)} | ${o.requirements.map(r=>r.id).join('、')} | ${o.requirements.flatMap(r=>r.craftRecipes).join('、')} |`);
lines.push('','## 剧情物品交互目标','', '“已定位”表示同版本客户端或 SPT 的目标模板位置已关联。阅读和调查仍需按任务要求执行，刷新候选不保证每局存在。','', '| 任务 | 目标 | 状态 | 任务位置所在图 | 目标 ID |','|---|---|---|---|---|');
for(const o of objectives.filter(o=>o.category==='story-item-interaction'))lines.push(`| ${cell(o.taskName)} | ${cell(o.text)} | ${o.status==='located'?'已定位':o.status==='partial'?'部分定位':o.status==='nonspatial-acquisition'?cell(o.acquisition.text):'未定位'} | ${mapNames(o.pointMaps)||(o.acquisition?'无需固定地图点':'未收录')} | ${o.objectiveId} |`);
fs.writeFileSync(path.join(root,output,'coverage.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({summary,maps:mapRows},null,2));
