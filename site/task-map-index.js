import {createItemIndex} from './atlas-item-index.js';

const collectTypes=new Set(['FindItem','HandoverItem','HasItem']);
const usable=p=>p.position&&Object.values(p.position).every(Number.isFinite)&&!p.outsideClientEnvelope;
function conditions(raw){
  const result=[];
  function visit(value){if(!value||typeof value!=='object')return;if(value.conditionType)result.push(value);for(const child of Object.values(value))if(typeof child==='object')Array.isArray(child)?child.forEach(visit):visit(child);}
  visit(raw);return result;
}
export function createTaskMapIndex({catalog,data,mapId,itemIndex=createItemIndex(data)}){
  const items=itemIndex,refs=new Map(),cache=new Map(),tasks=new Map(catalog.tasks.map(t=>[t.id,t]));
  for(const p of data.points){if(!usable(p))continue;for(const ref of p.questObjectives||[]){const key=`${ref.questId}:${ref.objectiveId}`;if(!refs.has(key))refs.set(key,new Set());refs.get(key).add(p);}}
  function objective(task,o){
    const key=`${task.id}:${o.id}`;if(cache.has(key))return cache.get(key);
    const nodes=conditions(o.raw),kills=nodes.filter(n=>n.conditionType==='Kills'),isCollect=collectTypes.has(o.type);
    const zoned=nodes.some(n=>['InZone','VisitPlace'].includes(n.conditionType)||n.zoneIds?.length||n.zoneId||n.enemyZone);
    const applicable=(o.mapIds||[]).includes(mapId)||o.locationScope==='any';
    const points=new Set(refs.get(key)||[]);
    // A map's ordinary loot candidates are not guaranteed spawns. Do not use
    // weapons to equip, items to plant, or items to sell as collection targets.
    if(isCollect&&task.mapAssociation!=='verified-only')for(const p of data.points)if(usable(p)&&items.matches(p,o.itemIds))points.add(p);
    let candidate=false;
    if(applicable&&kills.length&&!points.size&&task.mapAssociation!=='verified-only'){
      if(!zoned)for(const p of data.points){
        if(!usable(p))continue;
        const match=kills.some(k=>{
          const roles=k.savageRole||[];
          if(roles.length)return (p.poiTypes?.includes('boss')&&roles.some(role=>String(role).toLowerCase()===String(p.boss).toLowerCase()))||(p.poiTypes?.includes('sniper')&&roles.some(role=>String(role).toLowerCase()==='marksman'));
          return ['savage','any'].includes(String(k.target).toLowerCase())&&(p.poiTypes?.includes('scav_ai')||p.poiTypes?.includes('sniper'));
        });
        if(match){points.add(p);candidate=true;}
      }
    }
    let hint=points.size?(o.type==='CompletableItem'?'剧情物品位置':isCollect?'物品候选位置':candidate?'目标候选区域':'任务位置'):
      kills.length?(zoned?'指定击杀区域尚未定位':kills.some(k=>k.savageRole?.length)?'未收录目标候选区域':'全图击杀，无固定点位'):isCollect?'本图未收录获取位置':'未收录固定位置';
    const result={objective:o,points,candidate: candidate||isCollect,hint,relevant:points.size>0||applicable};cache.set(key,result);return result;
  }
  return {
    entries(selected){return selected.flatMap(id=>{const task=tasks.get(id);if(!task)return [];const objectives=task.objectives.map(o=>objective(task,o)).filter(o=>o.relevant);return objectives.length?[{task,objectives}]:[];});},
    active(entries,store){const points=new Set();if(!store.mapEnabled(mapId))return points;for(const entry of entries){if(!store.taskVisible(mapId,entry.task.id))continue;for(const row of entry.objectives)if(store.objectiveVisible(mapId,entry.task.id,row.objective.id))for(const p of row.points)points.add(p);}return points;},
  };
}

// Only shared map associations and display metadata are serialized. Selection,
// completion and other personal progress always remain in the browser store.
export function serializeTaskMapIndex(index, catalog, data) {
  const pointIds = new Map(data.points.map((point, i) => [point, i])), sets = [], setIds = new Map();
  const entries = index.entries(catalog.tasks.map(task => task.id)).map(entry => ({
    task: {id: entry.task.id, name: entry.task.name},
    objectives: entry.objectives.map(row => {
      const points = [...row.points].map(point => pointIds.get(point)), key = points.join(',');
      if (!setIds.has(key)) { setIds.set(key, sets.length); sets.push(points); }
      const {id, text, itemIds, type} = row.objective;
      return {objective: {id, text, itemIds, type}, set: setIds.get(key), candidate: row.candidate, hint: row.hint, relevant: row.relevant};
    }),
  }));
  return {version: 1, pointCount: data.points.length, sets, entries};
}

export function restoreTaskMapIndex(prepared, data, mapId) {
  if (prepared?.version !== 1 || prepared.pointCount !== data.points.length
      || !Array.isArray(prepared.sets) || !Array.isArray(prepared.entries)) throw new Error('任务索引版本不符');
  for (const values of prepared.sets) if (!Array.isArray(values) || values.some(i => !Number.isInteger(i) || i < 0 || i >= data.points.length)) throw new Error('任务索引点位不符');
  const tasks = new Map(prepared.entries.map(entry => [entry.task.id, entry])), entries = new Map(), sets = new Map();
  function restore(id) {
    if (!tasks.has(id)) return null;
    if (!entries.has(id)) {
      const entry = tasks.get(id);
      const objectives = entry.objectives.map(row => {
        if (!Number.isInteger(row.set) || !prepared.sets[row.set]) throw new Error('任务索引损坏');
        if (!sets.has(row.set)) sets.set(row.set, new Set(prepared.sets[row.set].map(i => data.points[i])));
        return {...row, points: sets.get(row.set)};
      });
      entries.set(id, {task: entry.task, objectives});
    }
    return entries.get(id);
  }
  return {
    entries(selected) { return selected.map(restore).filter(Boolean); },
    active(entries, store) {
      const points = new Set();
      if (!store.mapEnabled(mapId)) return points;
      for (const entry of entries) if (store.taskVisible(mapId, entry.task.id))
        for (const row of entry.objectives) if (store.objectiveVisible(mapId, entry.task.id, row.objective.id))
          for (const point of row.points) points.add(point);
      return points;
    },
  };
}
