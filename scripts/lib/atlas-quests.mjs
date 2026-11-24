import {atlasToUnity} from './factory-data.mjs';
import {POI_TYPES} from '../../site/atlas-point-types.js';
import {resolveQuestLocale} from './quest-localization.mjs';

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const valid=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const positionKey=p=>[p.x,p.y,p.z].map(v=>v.toFixed(2)).join(',');

// Match serialized IDs only. A nearby door, AI zone or similarly named object
// is not evidence that it belongs to a task.
export function buildAtlasQuests({atlas,questScenes,loot,quests,templates,locales,mapIds,positionSupplement={},sptSource=loot.sources?.spt||{version:'4.1.2',eftBuild:40743}}){
  const points=new Map(),items={},catalog={},claimedZones=new Set();
  const allowed=new Set(mapIds.map(id=>id.toLowerCase()));
  const tr=(key,fallback)=>locales.ch?.[key]||locales.en?.[key]||fallback;
  const displayQuestText=(quest,key,fallback)=>{
    for(const language of ['ch','en']){
      const resolved=resolveQuestLocale(quest,key,language,locales);
      if(resolved.text!==null)return resolved;
    }
    return {key,language:null,text:fallback,source:null};
  };
  const provenance=({key,language,source})=>({key,language,source});
  const addItem=tpl=>{items[tpl]={tpl,zh:tr(`${tpl} Name`,tpl),en:locales.en?.[`${tpl} Name`]||tpl};};
  const rowPosition=row=>row.position||atlasToUnity(row.pos);
  const rowOutline=row=>row.position?(row.outline||[]):(row.outline||[]).map(atlasToUnity).filter(valid);
  const zoneRows=[...(atlas.quest_triggers||[]),...(questScenes.quest_triggers||[]),...(positionSupplement.zones||[])];
  const zoneIndex=new Map(),itemIndex=new Map();
  for(const row of zoneRows){
    if(row.active===false||!valid(rowPosition(row)))continue;
    const id=row.name.trim();
    if(!zoneIndex.has(id))zoneIndex.set(id,[]);
    zoneIndex.get(id).push(row);
  }
  for(const row of [...(atlas.loose_points||[]),...(questScenes.loose_points||[])]){
    if(row.active===false||!valid(atlasToUnity(row.pos)))continue;
    // Only the raw template array is an exact association; enriched display names are not.
    for(const tpl of row.templates||[]){
      if(!itemIndex.has(tpl))itemIndex.set(tpl,[]);
      itemIndex.get(tpl).push(row);
    }
  }
  function add(type,sourceId,position,outline,ref,extra={}){
    if(!valid(position))return;
    const id=`quest:${type}:${sourceId}:${positionKey(position)}:${JSON.stringify(outline)}`;
    let point=points.get(id);
    if(!point){
      point={id,sourceId,kind:'poi',quest:true,poiTypes:[type],position,outline,
        positionSource:'atlas-client',icon:POI_TYPES[type][1],questObjectives:[],sceneVariants:[],...extra};
      points.set(id,point);
    }
    if(!point.questObjectives.some(r=>r.questId===ref.questId&&r.objectiveId===ref.objectiveId))point.questObjectives.push(ref);
    if(extra.variant&&!point.sceneVariants.includes(extra.variant))point.sceneVariants.push(extra.variant);
    catalog[ref.questId]={id:ref.questId,name:ref.name,en:ref.en,trader:ref.trader};
  }
  function zone(type,id,ref){
    id=String(id).trim();
    const expected=type==='quest_place'||type==='quest_beacon'?'place_item':type==='quest_flare'?'flare':type==='quest_visit'?'visit':null;
    for(const row of zoneIndex.get(id)||[]){
      if(expected&&row.kind!==expected)continue;
      claimedZones.add(id);
      const sceneIndex=questScenes.levels.indexOf(row.lv),scene=questScenes.scenes[sceneIndex]||'';
      add(type,id,rowPosition(row),rowOutline(row),ref,
        {zone:id,sceneLevel:row.lv,...(row.sourceEvidence?{sourceEvidence:row.sourceEvidence}:{}),variant:/_Night_/i.test(scene)?'夜间':scene.includes('Factory_Rework_Quests')?'白天':null});
    }
  }
  function itemPoints(tpl,ref,type='quest_item'){
    addItem(tpl);
    const client=itemIndex.get(tpl)||[],clientIds=new Set(client.map(r=>r.guid).filter(Boolean)),occupied=new Set();
    for(const row of client){
      const position=atlasToUnity(row.pos);occupied.add(positionKey(position));
      add(type,tpl,position,[],ref,{itemId:tpl});
    }
    for(const row of loot.points){
      if(row.kind!=='loose'||row.outsideClientEnvelope||!row.candidates?.some(c=>c.tpl===tpl&&(c.weight==null||c.weight>0)))continue;
      const grouped=(row.groupPositions||[]).filter(p=>p.Weight==null||p.Weight>0).map(p=>p.Position).filter(valid);
      const guid=row.sourceId?.match(/\[([^\]]+)\]/)?.[1];
      if(!grouped.length&&clientIds.has(guid))continue;
      // A randomized spawn chooses a GroupPosition. The root transform is not
      // an additional spawn when the server lists explicit group positions.
      const positions=row.groupPositions?.length?grouped:[row.position];
      for(const position of positions){
        if(!valid(position)||occupied.has(positionKey(position)))continue;
        occupied.add(positionKey(position));
        add(type,tpl,position,[],ref,{itemId:tpl,positionSource:row.positionSource||`spt-${sptSource.eftBuild}`,...(row.sourceEvidence?{sourceEvidence:row.sourceEvidence}:{}),candidate:!!row.groupPositions?.length});
      }
    }
  }
  for(const quest of Object.values(quests)){
    for(const c of quest.conditions?.AvailableForFinish||[]){
      const children=c.counter?.conditions||[],locations=children.filter(n=>n.conditionType==='Location').flatMap(n=>array(n.target));
      if(locations.length&&!locations.some(id=>allowed.has(id.toLowerCase())))continue;
      const fallbackName=quest.QuestName||quest._id,
        name=displayQuestText(quest,quest.name,fallbackName),
        nameEn=resolveQuestLocale(quest,quest.name,'en',locales),
        objective=displayQuestText(quest,c.id,'查看游戏内任务目标');
      const ref={questId:quest._id,name:name.text,
        en:nameEn.text??fallbackName,
        trader:tr(`${quest.traderId} Nickname`,''),objectiveId:c.id,index:c.index,
        text:objective.text,conditionType:c.conditionType,
        localization:{name:provenance(name),objective:provenance(objective)},
        count:Number(c.value)||1,plantTime:Number(c.plantTime)||0,items:[],locations};
      if(['FindItem','LeaveItemAtLocation','PlaceBeacon','CompletableItem'].includes(c.conditionType)){
        ref.items=array(c.target).filter(t=>templates[t]);ref.items.forEach(addItem);
      }
      if(c.conditionType==='FindItem'){
        for(const tpl of ref.items)if(templates[tpl]?._props?.QuestItem)itemPoints(tpl,ref);
      }else if(c.conditionType==='CompletableItem'){
        for(const tpl of ref.items)itemPoints(tpl,ref,'quest_interact');
      }else if(c.conditionType==='LeaveItemAtLocation'){
        for(const id of new Set(array(c.zoneIds??c.zoneId)))zone('quest_place',id,ref);
      }else if(c.conditionType==='PlaceBeacon'){
        for(const id of new Set(array(c.zoneIds??c.zoneId)))zone('quest_beacon',id,ref);
      }
      for(const condition of [c,...children]){
        if(condition.conditionType==='VisitPlace')for(const id of array(condition.target))zone('quest_visit',id,ref);
        if(condition.conditionType==='InZone')for(const id of array(condition.zoneIds))zone('quest_zone',id,ref);
        if(condition.conditionType==='LaunchFlare')for(const id of array(condition.target))zone('quest_flare',id,ref);
        if(condition.conditionType==='ExitName')for(const row of [...(atlas.exfils||[]),...(positionSupplement.transits||[])]){
          if(row.active===false||row.faction==='scav'||row.name.trim()!==String(condition.exitName).trim())continue;
          add('quest_extract',row.name.trim(),rowPosition(row),rowOutline(row),ref,row.sourceEvidence?{sourceEvidence:row.sourceEvidence}:{});
        }
      }
      for(const row of positionSupplement.interactions||[]){
        if(row.objectiveId!==c.id||row.sourceQuestId!==(c._taskSourceQuestId||quest._id))continue;
        add('quest_interact',row.sourceId,row.position,row.outline||[],ref,{sourceEvidence:row.sourceEvidence});
      }
    }
  }
  for(const p of points.values()){
    const names=[...new Set(p.questObjectives.map(r=>r.name))];
    p.label=names.join(' / ')+(p.itemId?` · ${items[p.itemId].zh}`:` · ${POI_TYPES[p.poiTypes[0]][0]}`);
    p.note=p.positionSource==='atlas-client'?'位置来自当前客户端。':`SPT ${sptSource.version} 候选位置，尚未逐点核验。`;
    p.searchText=p.questObjectives.map(r=>[r.name,r.en,r.text,r.trader,...r.items.flatMap(t=>[items[t]?.zh,items[t]?.en])].join(' ')).join(' ');
    delete p.variant;
  }
  const output=[...points.values()];
  const usedItems=new Set(output.flatMap(p=>p.questObjectives.flatMap(ref=>ref.items)));
  for(const tpl of Object.keys(items))if(!usedItems.has(tpl))delete items[tpl];
  return {version:1,points:output,items,quests:Object.values(catalog).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),
    sources:{quests:`SPT ${sptSource.version} / ${sptSource.eftBuild}`,spt:sptSource,positions:'Atlas 当前客户端任务场景；任务物品缺失位置补充自 SPT',questScenes:questScenes.scenes},
    stats:{quests:Object.keys(catalog).length,points:output.length,clientPoints:output.filter(p=>p.positionSource==='atlas-client').length,
      sptPoints:output.filter(p=>p.positionSource.startsWith('spt-')).length,unmatchedZones:[...zoneIndex.keys()].filter(id=>!claimedZones.has(id)).length}};
}
