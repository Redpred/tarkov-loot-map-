const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const taskObjectiveKey=ref=>ref?.questId&&ref?.objectiveId?`quest:${ref.questId}:${ref.objectiveId}`:null;
export function taskPointKeys(point){return [...new Set((point.questObjectives||[]).map(taskObjectiveKey).filter(Boolean))];}

// Use the existing map's versioned objective references, not action-type labels.
export function createTaskPointIndex(data){
  const byTask=new Map(),byKey=new Map(),metadata=new Map((data.questSources?.quests||data.quests||[]).map(t=>[t.id,t]));
  for(const point of data.points){
    if(!point.quest||!point.position||point.outsideClientEnvelope)continue;
    for(const ref of point.questObjectives||[]){
      const key=taskObjectiveKey(ref);if(!key)continue;
      if(!byTask.has(ref.questId)){
        const info=metadata.get(ref.questId)||ref;
        byTask.set(ref.questId,{id:ref.questId,name:info.name||ref.name||'未命名任务',en:info.en||ref.en||'',objectives:[],pointIds:new Set()});
      }
      const task=byTask.get(ref.questId);task.pointIds.add(point.id);
      if(!byKey.has(key)){
        const objective={key,questId:ref.questId,objectiveId:ref.objectiveId,taskName:task.name,label:ref.text?.trim()||'目标描述未收录',index:ref.index??Infinity,pointIds:new Set(),candidate:false,reference:ref,searchText:''};
        objective.searchText=normalize([task.name,task.en,ref.text,ref.questId,ref.objectiveId,...(ref.items||[]).flatMap(id=>[data.items?.[id]?.zh,data.items?.[id]?.en])].join(' '));
        byKey.set(key,objective);task.objectives.push(objective);
      }
      const objective=byKey.get(key);objective.pointIds.add(point.id);objective.candidate||=Boolean(point.candidate);
    }
  }
  const tasks=[...byTask.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
  for(const task of tasks){task.objectives.sort((a,b)=>a.index-b.index||a.objectiveId.localeCompare(b.objectiveId));task.count=task.pointIds.size;}
  for(const objective of byKey.values())objective.count=objective.pointIds.size;
  return {tasks,byTask,byKey,search(query){
    const tokens=normalize(query).split(' ').filter(Boolean);if(!tokens.length)return [];
    return tasks.map(task=>({task,objectives:task.objectives.filter(row=>tokens.every(token=>row.searchText.includes(token)))})).filter(row=>row.objectives.length);
  }};
}

export function taskSelectionState(objectives,selected){
  const count=objectives.filter(o=>selected.has(o.key)).length;
  return {count,checked:objectives.length>0&&count===objectives.length,indeterminate:count>0&&count<objectives.length};
}
export function selectTaskObjectives(objectives,selected,value){for(const row of objectives)value?selected.add(row.key):selected.delete(row.key);}
