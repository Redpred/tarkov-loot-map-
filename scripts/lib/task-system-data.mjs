import {resolveQuestLocale} from './quest-localization.mjs';

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const unique=values=>[...new Set(values.filter(Boolean))];
const clone=value=>JSON.parse(JSON.stringify(value));
const han=value=>/\p{Script=Han}/u.test(value||'');
const states={0:'未解锁',1:'可接受',2:'已接受',3:'可交付',4:'已完成',5:'已失败',6:'失败后可重试',7:'已标记失败',8:'已过期',9:'等待解锁',10:'自动接受'};
const compare=value=>({'==':'等于','=':'等于','>=':'至少','>':'大于','<=':'不高于','<':'低于','!=':'不等于'}[value]||'达到');
const positiveStatuses=new Set([2,3,4]);

export function walkTaskConditions(condition){
  return [condition,...array(condition?.counter?.conditions).flatMap(walkTaskConditions)];
}

export function taskGroup(quest){
  const tier=quest.tierAccessory;
  if(Number.isInteger(tier)&&tier>=0&&tier<=4)return {group:tier===0?'core':String(tier),groupSource:'tierAccessory',groupUnspecified:false,tierAccessory:tier};
  // Missing nullable SPT fields are not inferred from player level or loyalty.
  return {group:'core',groupSource:'unassigned',groupUnspecified:true,tierAccessory:null};
}

export function isPositiveTaskRequirement(condition){
  const status=array(condition.status).map(Number);
  return condition.conditionType==='Quest'&&status.length>0&&status.every(n=>positiveStatuses.has(n))&&!['!=','<','<='].includes(condition.compareMethod);
}

export function createTaskMapIndex(maps,locationBases){
  const result=new Map();
  for(const map of maps){
    const aliases=unique([map.id,map.spt,map.atlas,...(map.sptAliases||[]),...(map.id==='factory'?['factory4_night']:[])]);
    for(const alias of aliases){
      const base=locationBases[alias]||{};
      for(const id of [alias,base.Id,base._Id].filter(Boolean))result.set(String(id).toLowerCase(),map.id);
    }
  }
  return result;
}

function resolveText(quest,key,locales){
  const chinese=resolveQuestLocale(quest,key,'ch',locales),english=resolveQuestLocale(quest,key,'en',locales);
  return {text:chinese.text,en:english.text,textSource:chinese.source?`${chinese.source}:ch`:null,textMissing:!chinese.text,sourceHasHan:han(chinese.text)};
}

export function expandTaskObjectives(quest,quests,locales){
  const rows=[],seen=new Set();
  function visit(owner,condition,parents=[],stack=new Set()){
    const targets=array(condition.target),isInternal=condition.conditionType==='Quest'&&array(condition.status).includes(4)&&targets.length>0&&targets.every(id=>{
      const child=quests[id];if(!child)return false;
      const name=resolveText(child,child.name,locales);
      return child.notDisplayedQuest||(!name.text&&!name.en);
    });
    if(isInternal){
      let expanded=false;
      for(const id of targets){
        if(stack.has(id))continue;
        const child=quests[id],children=child.conditions?.AvailableForFinish||[];
        if(!children.length)continue;
        expanded=true;
        for(const c of children)visit(child,c,[...parents,{questId:owner._id,condition:clone(condition)}],new Set([...stack,id]));
      }
      if(expanded)return;
    }
    if(seen.has(condition.id))return;
    seen.add(condition.id);rows.push({condition,sourceQuestId:owner._id,parents});
  }
  for(const condition of quest.conditions?.AvailableForFinish||[])visit(quest,condition,[],new Set([quest._id]));
  return rows;
}

// Build a separate view for map association; neither source quests nor raw conditions are edited.
export function createMapTaskQuests(quests,locales){
  const result={};
  for(const quest of Object.values(quests)){
    const name=resolveText(quest,quest.name,locales);
    if(quest.notDisplayedQuest||(!name.text&&!name.en))continue;
    const rows=expandTaskObjectives(quest,quests,locales),localization=clone(quest.localization||{});
    for(const row of rows)if(row.sourceQuestId!==quest._id)for(const language of ['ch','en']){
      const value=resolveQuestLocale(quests[row.sourceQuestId],row.condition.id,language,locales).text;
      if(value)(localization[language]||={})[row.condition.id]=value;
    }
    result[quest._id]={...quest,localization,conditions:{...quest.conditions,AvailableForFinish:rows.map(row=>({...row.condition,_taskSourceQuestId:row.sourceQuestId}))}};
  }
  return result;
}

export function buildTaskCatalog({quests,templates,locales,maps,locationBases={},traderBases={},icons={},mapLayers={},questVariables={},questChains={elements:{}},dialogue={elements:[]},production={recipes:[]},source={}}){
  const mapIndex=createTaskMapIndex(maps,locationBases),mapNames=Object.fromEntries(maps.map(m=>[m.id,m.name]));
  const localized=Object.fromEntries(Object.values(quests).map(q=>[q._id,resolveText(q,q.name,locales)]));
  const questName=id=>localized[id]?.text||localized[id]?.en||'未命名任务';
  const global=(key,fallback='')=>locales.ch?.[key]||locales.en?.[key]||fallback;
  const roleName=role=>global(`QuestCondition/Elimination/Kill/BotRole/${role}`,global(`SavageRole/${role}`,global(role,role)));
  const traderName=id=>global(`${id} Nickname`,traderBases[id]?.nickname==='Player Trader'?'主线任务':traderBases[id]?.nickname||'主线任务');
  const itemName=id=>global(`${id} Name`,global(`${id} ShortName`,'未命名物品'));
  const visible=Object.values(quests).filter(q=>!q.notDisplayedQuest&&(localized[q._id].text||localized[q._id].en));
  const visibleIds=new Set(visible.map(q=>q._id));
  const pinMaps=new Map();
  for(const [mapId,layer] of Object.entries(mapLayers))for(const point of layer.points||[])for(const ref of point.questObjectives||[]){
    const key=`${ref.questId}:${ref.objectiveId}`;
    if(!pinMaps.has(key))pinMaps.set(key,new Set());
    pinMaps.get(key).add(mapId);
  }
  const itemIds=new Set(),warnings=[],omitted=[];
  for(const quest of Object.values(quests))if(!visibleIds.has(quest._id))omitted.push({id:quest._id,notDisplayedQuest:!!quest.notDisplayedQuest,missingName:!localized[quest._id].text&&!localized[quest._id].en});

  const itemTargets=c=>['FindItem','HandoverItem','LeaveItemAtLocation','PlaceBeacon','WeaponAssembly','HasItem','SellItemToTrader','CompletableItem'].includes(c.conditionType)?array(c.target).filter(id=>templates[id]):[];
  function nonspatialAcquisition(questId,c){
    if(pinMaps.has(`${questId}:${c.id}`))return null;
    if(c.conditionType!=='CompletableItem'&&!(c.conditionType==='FindItem'&&itemTargets(c).every(id=>templates[id]?._props?.QuestItem)))return null;
    const ids=itemTargets(c);if(!ids.length)return null;
    const acquisitions=ids.map(id=>{
      const recipes=(production.recipes||[]).filter(r=>r.endProduct===id);
      if(recipes.length)return {itemId:id,type:'craft',recipeIds:recipes.map(r=>r._id??r.id),text:'藏身处制作'};
      const rewards=Object.values(quests).flatMap(q=>['Started','Success','Fail'].flatMap(phase=>(q.rewards?.[phase]||[]).filter(r=>r.type==='Item'&&r.items?.some(i=>i._tpl===id)).map(r=>({questId:q._id,phase,rewardId:r.id}))));
      if(rewards.length)return {itemId:id,type:'task-reward',rewards,text:'任务流程发放'};
      return null;
    });
    if(acquisitions.some(a=>!a))return null;
    return {noFixedMapPoint:true,items:acquisitions,text:`获取方式：${unique(acquisitions.map(a=>a.text)).join(' / ')}${c.conditionType==='CompletableItem'?'，获得后阅读或交互':''}`};
  }
  function objectiveMaps(quest,c){
    const nodes=walkTaskConditions(c),locations=unique(nodes.filter(n=>n.conditionType==='Location').flatMap(n=>array(n.target)));
    const explicit=unique(locations.map(id=>mapIndex.get(String(id).toLowerCase())));
    const pins=[...(pinMaps.get(`${quest._id}:${c.id}`)||[])];
    const collection=['HandoverItem','FindItem','HasItem','WeaponAssembly','SellItemToTrader','CompletableItem'].includes(c.conditionType);
    // A map annotation on a handover task is not a restriction on its loot.
    const questItems=itemTargets(c).some(id=>templates[id]?._props?.QuestItem);
    const raidAction=['CounterCreator','VisitPlace','LocationTrigger','LeaveItemAtLocation','PlaceBeacon'].includes(c.conditionType)||questItems;
    const own=raidAction?mapIndex.get(String(quest.location).toLowerCase()):null;
    const result=unique([...explicit,...pins,...(!explicit.length&&!pins.length&&own?[own]:[])]);
    const killAnywhere=nodes.some(n=>['Kills','Shots'].includes(n.conditionType))&&!locations.length&&!own&&!pins.length&&!nodes.some(n=>n.conditionType==='InZone'||n.conditionType==='ArenaGameMode');
    return {mapIds:killAnywhere?maps.map(m=>m.id):result,unmappedLocations:locations.filter(id=>!mapIndex.has(String(id).toLowerCase())&&String(id).toLowerCase()!=='any'),locationScope:killAnywhere?'any':result.length?'specific':collection?'collection':'unspecified'};
  }
  function structuredCondition(c,quest){
    const targets=itemTargets(c),names=targets.map(itemName).join(' / '),count=Number(c.value)||1,found=c.onlyFoundInRaid?'在战局中找到并':'';
    switch(c.conditionType){
      case 'FindItem': return `找到${names||'目标物品'} × ${count}`;
      case 'HandoverItem': return `${found}交付${names||'目标物品'} × ${count}`;
      case 'LeaveItemAtLocation':return `在指定地点放置${names||'目标物品'} × ${count}${c.plantTime?`（放置 ${c.plantTime} 秒）`:''}`;
      case 'PlaceBeacon':return `在指定地点安装${names||'标记器'} × ${count}`;
      case 'WeaponAssembly':return `按要求组装并交付${names||'武器'} × ${count}`;
      case 'SellItemToTrader':return `向商人出售${names||'目标物品'} × ${count}`;
      case 'HasItem':return `持有${names||'目标物品'} × ${count}`;
      case 'CompletableItem':return `完成${names||'目标物品'}的交互`;
      case 'Quest':return array(c.target).some(id=>!localized[id]?.text&&!localized[id]?.en)?'完成指定剧情阶段（详细要求未收录）':`${array(c.target).map(questName).join(' / ')}：${array(c.status).map(n=>states[n]||'指定状态').join('或')||'达到指定状态'}`;
      case 'TraderLoyalty':return `${traderName(c.target)}信任度等级${compare(c.compareMethod)} ${c.value}`;
      case 'TraderStanding':return `${traderName(c.target)}声望${compare(c.compareMethod)} ${c.value}`;
      case 'Level':return `角色等级${compare(c.compareMethod)} ${c.value}`;
      case 'PrestigeLevel':return `威望等级${compare(c.compareMethod)} ${c.value}`;
      case 'Skill':return `${global(c.target,global(`${c.target}Name`,'指定技能'))}等级${compare(c.compareMethod)} ${c.value}`;
      case 'VisitPlace':return '到达指定区域';
      case 'LocationTrigger':return '完成指定地点的交互';
      case 'GlobalVariableValue':return `任务进度${compare(c.compareMethod)} ${c.value}`;
      case 'HideoutArea':return `藏身处设施达到 ${c.value} 级`;
      case 'CounterCreator':{
        const children=c.counter?.conditions||[],kill=children.find(n=>n.conditionType==='Kills'||n.conditionType==='Shots');
        const where=children.filter(n=>n.conditionType==='Location').flatMap(n=>array(n.target)).map(id=>mapNames[mapIndex.get(String(id).toLowerCase())]).filter(Boolean);
        const prefix=where.length?`在${unique(where).join(' / ')} `:'';
        if(kill){
          const target=({'Savage':'Scav','AnyPmc':'PMC','USEC':'USEC','Bear':'BEAR','Any':'目标单位'}[kill.target]||kill.target||'目标单位');
          const extras=[];
          if(kill.distance?.value)extras.push(`距离${compare(kill.distance.compareMethod)} ${kill.distance.value} 米`);
          if(kill.weapon?.length)extras.push(`使用${kill.weapon.map(itemName).join(' / ')}`);
          if(kill.savageRole?.length)extras.push(`目标：${kill.savageRole.map(roleName).join(' / ')}`);
          if(kill.daytime&&(kill.daytime.from||kill.daytime.to))extras.push(`${kill.daytime.from}:00–${kill.daytime.to}:00`);
          return `${prefix}${kill.conditionType==='Shots'?'命中':'击杀'} ${target} × ${count}${extras.length?`（${extras.join('；')}）`:''}`;
        }
        if(children.some(n=>n.conditionType==='ExitName'||n.conditionType==='ExitStatus'))return `${prefix}存活并撤离 × ${count}`;
        if(children.some(n=>n.conditionType==='LaunchFlare'))return `${prefix}在指定位置发射信号弹 × ${count}`;
        if(children.some(n=>n.conditionType==='VisitPlace'||n.conditionType==='InZone'))return `${prefix}到达指定区域 × ${count}`;
        if(children.some(n=>n.conditionType.startsWith('Arena')))return `完成竞技场目标 × ${count}`;
        return `完成指定战局目标 × ${count}`;
      }
      default:return '完成指定任务要求';
    }
  }
  function conditionDetails(c){
    const result=[],names=ids=>unique(array(ids).flat()).map(id=>templates[id]?itemName(id):global(id,id)).join('、');
    const localizedValue=value=>global(value,global(`QuestCondition/Elimination/Kill/BodyPart/${value}`,value));
    const bound=(label,value,suffix='')=>{if(value&&Number.isFinite(Number(value.value))&&(Number(value.value)!==0||value.compareMethod!=='>='))result.push(`${label}${compare(value.compareMethod)} ${value.value}${suffix}`);};
    const groups=(label,value)=>{if(array(value).length)result.push(`${label}：${array(value).map(group=>names(group)).join('；')}`);};
    if(c.onlyFoundInRaid)result.push('物品必须带有“在战局中找到”标记');
    if(c.dogtagLevel>0)result.push(`狗牌等级至少 ${c.dogtagLevel}`);
    if(c.minDurability>0||c.maxDurability!=null&&c.maxDurability<100)result.push(`耐久度：${c.minDurability??0}%–${c.maxDurability??100}%`);
    if(c.isEncoded)result.push('物品必须已编码');
    if(c.countInRaid)result.push('仅计入当前战局中获取的物品');
    if(c.plantTime>0)result.push(`放置时间：${c.plantTime} 秒`);
    if(c.oneSessionOnly||c.resetOnSessionEnd)result.push('需要在同一次战局中完成');
    if(c.isResetOnConditionFailed)result.push('不满足目标条件时重置本项进度');
    if(c.completeInSeconds>0)result.push(`需要在 ${c.completeInSeconds} 秒内完成`);
    if(c.availableAfter>0)result.push(`前置达成后等待 ${c.availableAfter} 秒`);
    for(const n of walkTaskConditions(c)){
      if(n!==c&&n.resetOnSessionEnd)result.push('需要在同一次战局中完成');
      if(n.conditionType==='Location')result.push(`地图：${array(n.target).map(id=>mapNames[mapIndex.get(String(id).toLowerCase())]||global(id,'未收录地点')).join(' / ')}`);
      if(['Kills','Shots'].includes(n.conditionType)){
        const label={Savage:'Scav',AnyPmc:'PMC',USEC:'USEC',Bear:'BEAR',Any:'任意目标'}[n.target]||global(n.target,n.target||'指定目标');
        result.push(`目标单位：${label}`);
        if(n.savageRole?.length)result.push(`目标类型：${n.savageRole.map(roleName).join(' / ')}`);
        if(n.weapon?.length)result.push(`允许武器：${names(n.weapon)}`);
        if(n.weaponCaliber?.length)result.push(`武器口径：${n.weaponCaliber.map(localizedValue).join(' / ')}`);
        bound('距离',n.distance,' 米');
        if(n.bodyPart?.length)result.push(`命中部位：${n.bodyPart.map(localizedValue).join(' / ')}`);
        if(n.daytime&&(n.daytime.from||n.daytime.to))result.push(`战局时间：${n.daytime.from}:00–${n.daytime.to}:00`);
        groups('武器配件允许组合',n.weaponModsInclusive);groups('武器配件排除组合',n.weaponModsExclusive);
        groups('目标装备允许组合',n.enemyEquipmentInclusive);groups('目标装备排除组合',n.enemyEquipmentExclusive);
        for(const health of n.enemyHealthEffects||[])if(typeof health==='string')result.push(`目标状态：${localizedValue(health)}`);
      }
      if(n.conditionType==='Equipment'){
        groups('允许装备组合',n.equipmentInclusive);groups('排除装备组合',n.equipmentExclusive);
        if(n.IncludeNotEquippedItems)result.push('携带但未装备的物品也可满足装备条件');
      }
      if(n.conditionType==='HealthEffect'){
        bound('能量',n.energy);bound('水分',n.hydration);bound('持续时间',n.time,' 秒');
        for(const health of n.bodyPartsWithEffects||[])result.push(`身体状态：${array(health.bodyParts).map(localizedValue).join(' / ')}；${array(health.effects).map(localizedValue).join(' / ')}`);
      }
      if(n.conditionType==='ExitStatus')result.push(`战局结果：${array(n.status).map(value=>({Survived:'成功撤离',Runner:'匆匆逃离',Killed:'被击杀',MissingInAction:'行动中失踪',Left:'离开',Transit:'转移'}[value]||localizedValue(value))).join(' / ')}`);
      if(n.conditionType==='ExitName')result.push(`撤离点：${global(n.exitName,n.exitName)}`);
      if(n.conditionType==='Time')bound('时间',n,' 秒');
      if(n.conditionType==='ArenaMatchPlace')bound('竞技场比赛名次',n);
      if(n.conditionType==='ArenaPlayerInTeamPlace')bound('竞技场队内名次',n);
      if(n.conditionType==='ArenaGameMode')result.push(`竞技场模式：${array(n.target).map(localizedValue).join(' / ')}`);
    }
    if(c.conditionType==='WeaponAssembly'){
      for(const [field,label,unit] of [['durability','耐久度','%'],['ergonomics','人体工学',''],['recoil','总后坐力',''],['weight','重量',' kg'],['magazineCapacity','弹匣容量',' 发'],['height','占用高度',' 格'],['width','占用宽度',' 格'],['baseAccuracy','基础精度',''],['effectiveDistance','有效射程',' 米'],['muzzleVelocity','初速',' m/s'],['emptyTacticalSlot','空余战术插槽','']])bound(label,c[field],unit);
      if(c.containsItems?.length)result.push(`必须安装：${names(c.containsItems)}`);
      if(c.hasItemFromCategory?.length)result.push(`配件类别：${names(c.hasItemFromCategory)}`);
    }
    return unique(result);
  }
  const dialogueSetters=new Map();
  for(const [dialogIndex,dialog] of (dialogue.elements||[]).entries())for(const [lineIndex,line] of (dialog.Lines||[]).entries())for(const [actionIndex,action] of (line.Actions||[]).entries()){
    if(action.type!=='SetVariable'||action.saveScope!=='Profile'||!action.variableId||!Number.isFinite(Number(action.value)))continue;
    if(!dialogueSetters.has(action.variableId))dialogueSetters.set(action.variableId,[]);
    dialogueSetters.get(action.variableId).push({dialogId:dialog.Id,traderId:dialog.Trader,lineId:line.Id,actionId:action.id,value:Number(action.value),pointer:`/elements/${dialogIndex}/Lines/${lineIndex}/Actions/${actionIndex}`,trigger:clone(line.Trigger||{})});
  }
  function variableSatisfied(actual,required,method){return ({'>=':()=>actual>=required,'>':()=>actual>required,'==':()=>actual===required,'=':()=>actual===required,'<=':()=>actual<=required,'<':()=>actual<required,'!=':()=>actual!==required}[method]||(()=>false))();}
  function prerequisites(quest){
    return (quest.conditions?.AvailableForStart||[]).map(c=>{
      const localizedText=resolveText(quest,c.id,locales),base={id:c.id,type:c.conditionType,text:localizedText.text||structuredCondition(c,quest),textSource:localizedText.textSource||'structured',textMissing:!localizedText.text,details:conditionDetails(c),raw:clone(c)};
      if(c.conditionType==='Quest')return {...base,taskId:array(c.target)[0],taskIds:array(c.target),status:array(c.status),positiveDependency:isPositiveTaskRequirement(c)};
      if(c.conditionType==='GlobalVariableValue'){
        const group=questVariables[c.target],taskIds=Object.keys(group?.quests||{});
        const members=taskIds.filter(id=>visibleIds.has(id)&&id!==quest._id);
        if(group){
          base.text=`商人任务进度${compare(c.compareMethod)} ${c.value}`;
          // QuestVariableHelper maps each known completion to one distinct flag.
          // A threshold is an aggregate prerequisite, never an AND-edge from
          // every group member (many of them themselves require this threshold).
          const canContributeBefore=id=>id!==quest._id&&!(quests[id]?.conditions?.AvailableForStart||[]).some(p=>p.conditionType==='GlobalVariableValue'&&p.target===c.target&&['>=','>','==','='].includes(p.compareMethod)&&Number(p.value)>=Number(c.value));
          const contributors=Object.entries(group.quests).filter(([id])=>canContributeBefore(id)).map(([id,flag])=>({taskId:id,flag,contribution:1,visible:visibleIds.has(id)}));
          const alternatives=(group.fillers||[]).map(f=>({capacity:f.members,taskIds:f.quests.filter(canContributeBefore),allTaskIds:clone(f.quests),contribution:f.quests.length<f.members?f.members:1,sourceUncertain:true})).filter(f=>f.taskIds.length);
          base.details.push('累计进度达标后解锁；相关任务可有多种完成顺序');
          return {...base,taskIds:[],relatedTaskIds:members,requiredValue:Number(c.value),variableId:c.target,variableGroup:clone(group),positiveDependency:false,
            progressRequirement:{variableId:c.target,compareMethod:c.compareMethod,value:Number(c.value),contributors,alternatives,source:'SPT questVariables + QuestVariableHelper',aggregate:true}};
        }
        const dialogueProviders=(dialogueSetters.get(c.target)||[]).filter(p=>variableSatisfied(p.value,Number(c.value),c.compareMethod));
        if(dialogueProviders.length){
          base.text=`完成 ${unique(dialogueProviders.map(p=>traderName(p.traderId))).join(' / ')} 的相关对话`;
          base.textSource='structured-dialogue';base.details.push('对话解锁条件，不计为完成任务数量');
          return {...base,taskIds:[],positiveDependency:false,dialogueRequirement:{variableId:c.target,compareMethod:c.compareMethod,value:Number(c.value),source:'SPT templates/dialogue.json',providers:dialogueProviders}};
        }
        const providers=Object.values(quests).filter(q=>(q.rewards?.Success||[]).some(r=>r.type==='GlobalVariable'&&r.target===c.target&&Number(r.value)>=Number(c.value))).map(q=>q._id);
        if(providers.length===1&&['>=','==','='].includes(c.compareMethod)&&Number(c.value)>0){
          base.text=`完成「${questName(providers[0])}」后达到任务进度 ${c.value}`;
          return {...base,taskId:providers[0],taskIds:providers,variableId:c.target,positiveDependency:true,dependencySource:'successRewardVariable'};
        }
        warnings.push({taskId:quest._id,conditionId:c.id,type:'unresolvedProgressRequirement',variableId:c.target});
      }
      return base;
    });
  }
  const tasks=visible.map(quest=>{
    const localizedName=localized[quest._id],desc=resolveText(quest,quest.description,locales),pre=prerequisites(quest);
    const objectives=expandTaskObjectives(quest,quests,locales).map(row=>{
      const c=row.condition,owner=quests[row.sourceQuestId];
      const ids=unique(itemTargets(c));ids.forEach(id=>itemIds.add(id));
      const text=resolveText(owner,c.id,locales),structured=!text.text||!han(text.text);
      const acquisition=nonspatialAcquisition(quest._id,c);
      const objective={id:c.id,type:c.conditionType,index:c.index??0,text:structured?structuredCondition(c,quest):text.text,en:text.en,textSource:structured?'structured':text.textSource,textMissing:!text.text,originalText:text.text,
        count:Number(c.value)||1,showCount:['CounterCreator','HandoverItem','FindItem','PlaceBeacon','LeaveItemAtLocation','WeaponAssembly','HasItem'].includes(c.conditionType),details:conditionDetails(c),optional:c.optional===true||c.isOptional===true,foundInRaid:!!c.onlyFoundInRaid,itemIds:ids,...(acquisition?{mapIds:[],unmappedLocations:[],locationScope:'nonspatial',acquisition}:objectiveMaps({...owner,_id:quest._id},c)),raw:clone(c),sourceQuestId:row.sourceQuestId,parentConditions:row.parents};
      if(structured)warnings.push({taskId:quest._id,conditionId:c.id,type:'structuredObjectiveText',originalText:text.text});
      return objective;
    });
    const loyalty=(quest.conditions?.AvailableForStart||[]).filter(c=>c.conditionType==='TraderLoyalty'&&c.target===quest.traderId&&['>=','==','='].includes(c.compareMethod)).map(c=>Number(c.value));
    const level=(quest.conditions?.AvailableForStart||[]).filter(c=>c.conditionType==='Level'&&['>=','==','='].includes(c.compareMethod)).map(c=>Number(c.value));
    const task={id:quest._id,name:localizedName.text||localizedName.en,en:localizedName.en,traderId:quest.traderId,...taskGroup(quest),loyaltyLevel:loyalty.length?Math.max(...loyalty):null,level:level.length?Math.max(...level):null,
      description:desc.text||desc.en||'',descriptionSource:desc.textSource||'missing',imageKey:quest._id,prerequisites:pre,dependencies:unique(pre.filter(p=>p.positiveDependency).flatMap(p=>p.taskIds||[])),objectives,mapIds:unique(objectives.flatMap(o=>o.mapIds)),isStoryQuest:!!quest.isStoryQuest,side:quest.side,
      chainIds:Object.entries(questChains.elements||{}).filter(([,ids])=>ids.includes(quest._id)).map(([id])=>id),conditions:clone(quest.conditions),rewards:clone(quest.rewards||{}),nameSource:localizedName.textSource||'en'};
    if(task.groupUnspecified)warnings.push({taskId:task.id,type:'missingTierAccessory'});
    return task;
  });
  const items=Object.fromEntries([...itemIds].sort().map(id=>[id,{name:itemName(id),en:locales.en?.[`${id} Name`]||'',icon:icons[id]||null,questItem:!!templates[id]?._props?.QuestItem}]));
  const traderIds=unique(tasks.map(t=>t.traderId));
  const traders=traderIds.map(id=>({id,name:traderName(id),en:locales.en?.[`${id} Nickname`]||'',imageKey:id}));
  const audit={omitted,warnings,counts:{rawTasks:Object.keys(quests).length,tasks:tasks.length,objectives:tasks.reduce((n,t)=>n+t.objectives.length,0),traders:traders.length,items:itemIds.size,groups:Object.fromEntries(['core','1','2','3','4'].map(g=>[g,tasks.filter(t=>t.group===g).length])),unassignedGroups:tasks.filter(t=>t.groupUnspecified).length,collectionOrUnspecified:tasks.filter(t=>!t.mapIds.length).length}};
  return {catalog:{schemaVersion:1,source,maps:maps.map(({id,name})=>({id,name})),traders,items,tasks},audit};
}
