export const TASK_STORE_KEY='tarkov-task-progress-v1';
const CHANGE='tarkov-task-progress-change';
const validId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const list=value=>[...new Set((Array.isArray(value)?value:[]).filter(validId))].slice(0,3000);
const entries=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).filter(([key])=>validId(key)):[];
const dictionary=value=>Object.fromEntries(entries(value).map(([key,ids])=>[key,list(ids)]));
const nested=value=>Object.fromEntries(entries(value).map(([key,rows])=>[key,dictionary(rows)]));
export function validateTaskState(value){
  const data=value?.version===1?value:{};
  return {version:1,selected:list(data.selected),accepted:list(data.accepted),finished:list(data.finished),loyaltyLevels:Object.fromEntries(entries(data.loyaltyLevels).filter(([,v])=>Number.isInteger(v)&&v>=1&&v<=4)),completed:dictionary(data.completed),hidden:nested(data.hidden),shown:nested(data.shown),disabled:dictionary(data.disabled),mapEnabled:Object.fromEntries(entries(data.mapEnabled).filter(([,v])=>typeof v==='boolean'))};
}
export function createTaskStore({storage,eventTarget=globalThis.window}={}){
  let persistent=true,state=validateTaskState(null);
  if(storage===undefined)try{storage=globalThis.localStorage;}catch{persistent=false;}
  if(!storage)persistent=false;
  const listeners=new Set(),token={};
  function read(){
    if(!storage)return state;
    try{const raw=storage.getItem(TASK_STORE_KEY);return raw?validateTaskState(JSON.parse(raw)):validateTaskState(null);}
    catch{persistent=false;return state;}
  }
  state=read();
  function notify(){for(const listener of listeners)listener();}
  function change(update){
    if(persistent)state=read();
    update(state);state=validateTaskState(state);
    try{if(storage){storage.setItem(TASK_STORE_KEY,JSON.stringify(state));persistent=true;}}
    catch{persistent=false;}
    notify();
    if(eventTarget){const event=new Event(CHANGE);event.detail={token,state};eventTarget.dispatchEvent(event);}
  }
  const set=(ids,id,on)=>on?[...new Set([...ids,id])]:ids.filter(value=>value!==id);
  const safe=(...ids)=>ids.every(validId);
  function completed(taskId,objectiveId){return state.finished.includes(taskId)||(state.completed[taskId]||[]).includes(objectiveId);}
  function objectiveVisible(mapId,taskId,objectiveId){
    if((state.hidden[mapId]?.[taskId]||[]).includes(objectiveId))return false;
    return !completed(taskId,objectiveId)||(state.shown[mapId]?.[taskId]||[]).includes(objectiveId);
  }
  function onStorage(event){if(event.key!==TASK_STORE_KEY&&event.key!==null)return;state=read();notify();}
  function onLocal(event){if(event.detail?.token===token)return;state=validateTaskState(event.detail?.state);notify();}
  eventTarget?.addEventListener('storage',onStorage);eventTarget?.addEventListener(CHANGE,onLocal);
  return {
    getState:()=>structuredClone(state),getStatus:()=>({persistent}),
    isSelected:id=>state.selected.includes(id),isCompleted:completed,isTaskCompleted:id=>state.finished.includes(id),
    isTaskAccepted:id=>state.accepted.includes(id),
    setTaskAccepted(taskId,accepted){if(safe(taskId))change(s=>{s.accepted=set(s.accepted,taskId,Boolean(accepted));});},
    setTaskCompleted(taskId,done){if(!safe(taskId))return;change(s=>{
      s.finished=set(s.finished,taskId,Boolean(done));
      // Keep partial checklists intact so undoing task completion restores them.
      if(done){
        s.selected=set(s.selected,taskId,false);
        for(const map of Object.keys(s.shown))if(s.shown[map][taskId])delete s.shown[map][taskId];
      }
    });},
    setLoyaltyLevel(traderId,level){if(!safe(traderId)||!(level===null||Number.isInteger(level)&&level>=1&&level<=4))return;change(s=>{if(level===null)delete s.loyaltyLevels[traderId];else s.loyaltyLevels[traderId]=level;});},
    toggleTask(id,selected){if(safe(id))change(s=>{s.selected=set(s.selected,id,Boolean(selected));});},
    setCompleted(taskId,objectiveId,done){if(!safe(taskId,objectiveId))return;change(s=>{
      s.completed[taskId]=set(s.completed[taskId]||[],objectiveId,Boolean(done));
      // A freshly completed objective is hidden on every map until explicitly shown.
      for(const map of Object.keys(s.shown))if(s.shown[map][taskId])s.shown[map][taskId]=s.shown[map][taskId].filter(id=>id!==objectiveId);
    });},
    objectiveVisible,
    taskVisible:(mapId,taskId)=>!(state.disabled[mapId]||[]).includes(taskId),
    setTaskVisible(mapId,taskId,visible){if(safe(mapId,taskId))change(s=>{s.disabled[mapId]=set(s.disabled[mapId]||[],taskId,!visible);});},
    setObjectiveVisible(mapId,taskId,objectiveId,visible){if(!safe(mapId,taskId,objectiveId))return;change(s=>{
      s.hidden[mapId]??={};s.shown[mapId]??={};
      s.hidden[mapId][taskId]=set(s.hidden[mapId][taskId]||[],objectiveId,!visible);
      s.shown[mapId][taskId]=set(s.shown[mapId][taskId]||[],objectiveId,Boolean(visible));
    });},
    setMapEnabled(mapId,enabled){if(safe(mapId))change(s=>{s.mapEnabled[mapId]=Boolean(enabled);});},
    mapEnabled:mapId=>state.mapEnabled[mapId]??state.selected.length>0,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    destroy(){eventTarget?.removeEventListener('storage',onStorage);eventTarget?.removeEventListener(CHANGE,onLocal);listeners.clear();}
  };
}
