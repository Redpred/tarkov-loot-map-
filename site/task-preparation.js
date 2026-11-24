const ids=value=>[...new Set((Array.isArray(value)?value:[value]).filter(id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id)))];
const schemes=value=>(Array.isArray(value)?value:[]).map(ids).filter(group=>group.length);
const count=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):1;

// Only explicit carry, planting and player equipment conditions become purchases.
// Find/handover items, enemy equipment and excluded equipment are not shopping lists.
export function objectivePreparation(objective){
  if(objective.preparation?.length)return objective.preparation;
  const raw=objective.raw||{},requirements=[];
  const add=(kind,options,quantity=1,consumed=false,label='')=>{
    if(options.length||label)requirements.push({kind,options,quantity,consumed,label});
  };
  if(['PlaceBeacon','LeaveItemAtLocation','HasItem'].includes(objective.type)){
    const target=ids(raw.target||objective.itemIds);
    add(objective.type==='PlaceBeacon'?'标记物品':objective.type==='HasItem'?'随身携带':'放置物品',target.map(id=>[id]),count(objective.count),objective.type!=='HasItem');
  }
  for(const condition of raw.counter?.conditions||[]){
    if(condition.conditionType==='Equipment')add(condition.IncludeNotEquippedItems?'随身装备':'穿戴装备',schemes(condition.equipmentInclusive));
    if(['Kills','Shots'].includes(condition.conditionType)){
      add('指定武器',ids(condition.weapon).map(id=>[id]));
      add('武器配件',schemes(condition.weaponModsInclusive));
      if(condition.weaponCaliber?.length)add('弹药要求',[],1,false,'按目标要求准备对应口径弹药');
    }
    if(condition.conditionType==='LaunchFlare')add('信号弹',[],1,true,'信号弹（按目标指定颜色）');
  }
  return requirements;
}

export function preparationGroups(catalogue,progress,{traderId='',search=''}={}){
  const selected=new Set(progress.selected||[]),finished=new Set(progress.finished||[]),groups=new Map();
  const tokens=search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  for(const task of catalogue.tasks||[]){
    if(!selected.has(task.id)||finished.has(task.id)||(traderId&&task.traderId!==traderId))continue;
    for(const objective of task.objectives||[]){
      if((progress.completed?.[task.id]||[]).includes(objective.id))continue;
      for(const requirement of objectivePreparation(objective)){
        // Objective maps are authoritative; task-wide maps can include other stages.
        const mapIds=objective.mapIds?.length?objective.mapIds:['other'];
        for(const mapId of mapIds){
          const name=catalogue.maps.find(map=>map.id===mapId)?.name||'其他 / 地图未指定';
          const text=[task.name,task.en,objective.text,objective.en,name,requirement.kind,requirement.label,
            ...requirement.options.flat().flatMap(id=>[catalogue.items[id]?.name,catalogue.items[id]?.en])].join(' ').toLocaleLowerCase();
          if(!tokens.every(token=>text.includes(token)))continue;
          if(!groups.has(mapId))groups.set(mapId,{id:mapId,name,rows:new Map()});
          const key=JSON.stringify([requirement.kind,requirement.options.map(g=>[...g].sort()).sort((a,b)=>a.join().localeCompare(b.join())),requirement.label,Boolean(objective.optional),Boolean(objective.foundInRaid)]);
          const rows=groups.get(mapId).rows;
          if(!rows.has(key))rows.set(key,{...requirement,key,quantity:0,optional:Boolean(objective.optional),foundInRaid:Boolean(objective.foundInRaid),uses:[]});
          const row=rows.get(key);
          if(row.uses.some(use=>use.task.id===task.id&&use.objective.id===objective.id))continue;
          row.quantity=row.consumed?row.quantity+requirement.quantity:Math.max(row.quantity,requirement.quantity);
          row.uses.push({task,objective,quantity:requirement.quantity});
        }
      }
    }
  }
  const order=new Map(catalogue.maps.map((map,i)=>[map.id,i]));
  return [...groups.values()].sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999)).map(group=>({...group,rows:[...group.rows.values()]}));
}
