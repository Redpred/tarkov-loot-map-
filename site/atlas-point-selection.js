// Per-map leaf choices. Parents only select leaves; they never add a second predicate.
export const objectiveSelectionKey=(task,goal)=>`quest:${task}:${goal}`;
export function createPointSelection(mapId,{storage}={}){
  if(storage===undefined)try{storage=globalThis.localStorage;}catch{}
  const key=`atlas-point-selection-v1:${mapId}`;let saved=null;
  try{saved=JSON.parse(storage?.getItem(key)||'null');}catch{}
  const valid=saved?.version===1;
  const keys=new Set(valid&&Array.isArray(saved.keys)?saved.keys.filter(k=>typeof k==='string'):[]);
  const knownTasks=new Set(valid&&Array.isArray(saved.knownTasks)?saved.knownTasks:[]),completedObjectives=new Set(valid&&Array.isArray(saved.completedObjectives)?saved.completedObjectives:[]),listeners=new Set();
  function changed(){try{storage?.setItem(key,JSON.stringify({version:1,keys:[...keys],knownTasks:[...knownTasks],completedObjectives:[...completedObjectives]}));}catch{}for(const fn of listeners)fn();}
  return {keys,knownTasks,completedObjectives,changed,
    set(id,value){value?keys.add(id):keys.delete(id);changed();},
    setMany(ids,value){for(const id of ids)value?keys.add(id):keys.delete(id);changed();},
    clear(){keys.clear();changed();},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
  };
}

// Remember observed completion so a new completion hides a goal even after reload,
// while explicitly showing an already completed goal remains a durable choice.
export function syncTaskObjectives(selection,taskId,objectives){
  const fresh=!selection.knownTasks.has(taskId);let changed=fresh;
  for(const {key,complete,visible} of objectives){
    const wasComplete=selection.completedObjectives.has(key);
    if(fresh&&visible){selection.keys.add(key);changed=true;}
    if(!fresh&&complete&&!wasComplete)changed=selection.keys.delete(key)||changed;
    if(complete!==wasComplete){complete?selection.completedObjectives.add(key):selection.completedObjectives.delete(key);changed=true;}
  }
  selection.knownTasks.add(taskId);return changed;
}

export function checkboxState(keys,selected){const count=keys.filter(key=>selected.has(key)).length;return {checked:keys.length>0&&count===keys.length,indeterminate:count>0&&count<keys.length};}

export function createFilterMode(){let mode='point',tab='point';return {get mode(){return mode;},get tab(){return tab;},select(next){if(!['point','value','list'].includes(next))return;tab=next;if(next!=='list')mode=next;}};}

export function createPointUnionMatcher({types=()=>false,items=()=>false,ammo=()=>false,tasks=()=>false,keys=()=>false,keyId=null}={}){
  return point=>types(point)||items(point)||ammo(point)||tasks(point)||keys(point)||Boolean(keyId&&point.id===keyId);
}
