const clean=value=>String(value||'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<\/?(?:b|i|color|size)(?:=[^>]*)?>/gi,'').trim();
const minimum=(value,method)=>{
  const number=Number(value);if(!Number.isFinite(number))return 0;
  return method==='>'?Math.floor(number)+1:['>=','==','='].includes(method)?Math.max(0,number):0;
};

export function taskVisiblePrerequisites(task){return task.prerequisites||[];}

const compareValue=(actual,required,method)=>({'>=':actual>=required,'>':actual>required,'==':actual===required,'=':actual===required,'<=':actual<=required,'<':actual<required,'!=':actual!==required})[method];

// Completion records prove only submitted tasks. Never infer player level,
// trader loyalty, dialog state or failed/accepted quests from a completed quest.
export function taskPrerequisiteState(p,{finished=[],accepted=[],loyaltyLevels={}}={}){
  const done=new Set(finished),raw=p.raw||{},r=p.progressRequirement;
  if(r){
    const flags=new Map();
    for(const c of r.contributors||[])if(done.has(c.taskId))flags.set(c.flag||c.taskId,Number(c.contribution)||0);
    const count=[...flags.values()].reduce((sum,n)=>sum+n,0),possibleAlternative=(r.alternatives||[]).some(a=>(a.taskIds||[]).some(id=>done.has(id)));
    const met=compareValue(count,Number(r.value),r.compareMethod);
    const status=met===undefined?'unknown':met&&['>=','>'].includes(r.compareMethod)?'met':possibleAlternative?'unknown':met?'met':'pending';
    return {status,count,required:Number(r.value),uncertain:possibleAlternative};
  }
  if(p.type==='TraderLoyalty'){
    const level=loyaltyLevels[raw.target];if(level==null)return {status:'unknown'};
    const met=compareValue(level,Number(raw.value),raw.compareMethod);return {status:met===undefined?'unknown':met?'met':'pending',current:level};
  }
  if(p.dependencySource==='successRewardVariable'&&p.taskId)return {status:done.has(p.taskId)?'met':'pending'};
  if(p.type==='Quest'){
    const ids=[...new Set(p.taskIds||[p.taskId].filter(Boolean))],statuses=(p.status||raw.status||[]).map(Number);
    if(!ids.length||raw.availableAfter>0||raw.dispersion>0||['!=','<','<='].includes(raw.compareMethod))return {status:'unknown'};
    const count=ids.filter(id=>statuses.includes(4)&&done.has(id)||statuses.includes(2)&&accepted.includes(id)&&!done.has(id)).length;
    const required=p.match==='any'?1:ids.length;
    if(count>=required)return {status:'met',count,required};
    if(statuses.length===1&&statuses[0]===4)return {status:'pending',count,required};
    return {status:'unknown',count,required:ids.length};
  }
  return {status:'unknown'};
}

export function taskRequirementRows(task,progress){
  return taskVisiblePrerequisites(task).map(p=>{
    const result=taskPrerequisiteState(p,progress),base=taskCardRequirements({prerequisites:[p]})[0]||clean(p.text);
    const count=p.progressRequirement?`（已完成 ${result.count} / ${Math.ceil(minimum(p.progressRequirement.value,p.progressRequirement.compareMethod))}${result.uncertain?'，替代进度待确认':''}）`:'';
    return {prerequisite:p,...result,text:base+count};
  });
}

// Only verified unit contributions can be described as a number of tasks.
// Alternative/weighted sources keep their original progress requirement.
export function taskCardRequirements(task){
  return [...new Set(taskVisiblePrerequisites(task).filter(p=>p.type!=='Quest'&&!p.taskId).map(p=>{
    const r=p.progressRequirement;
    if(r&&['>=','>'].includes(r.compareMethod)&&!(r.alternatives||[]).length&&r.contributors?.length&&r.contributors.every(c=>c.contribution===1)){
      return `先完成至少 ${Math.ceil(minimum(r.value,r.compareMethod))} 项相关任务`;
    }
    return clean(p.text);
  }).filter(Boolean))];
}

export function taskUnlockOrder(task){
  const values={Level:Number(task.level)||0,TraderLoyalty:0,TraderStanding:0,PrestigeLevel:0};
  let count=task.requiredTaskCount??new Set(task.dependencies||[]).size,unknown=0;
  for(const p of taskVisiblePrerequisites(task)){
    const raw=p.raw||{},r=p.progressRequirement;
    if(p.type==='GlobalVariableValue'&&!p.dialogueRequirement){
      count=Math.max(count,minimum(r?.value??raw.value,r?.compareMethod??raw.compareMethod));
      if(!r)unknown++;
    }else if(Object.hasOwn(values,p.type))values[p.type]=Math.max(values[p.type],minimum(raw.value,raw.compareMethod));
  }
  return [count,values.Level,values.TraderLoyalty,values.TraderStanding,values.PrestigeLevel,unknown,taskVisiblePrerequisites(task).length];
}

export function compareTaskUnlock(a,b){
  const x=taskUnlockOrder(a),y=taskUnlockOrder(b);
  for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];
  return String(a.name||a.id).localeCompare(String(b.name||b.id),'zh-CN',{numeric:true})||a.id.localeCompare(b.id);
}
