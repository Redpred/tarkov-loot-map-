import {createTaskStore} from './task-store.js';
import {createTaskMapIndex} from './task-map-index.js';
import {objectiveSelectionKey,checkboxState,syncTaskObjectives} from './atlas-point-selection.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createMyTasks({data,mapId,host,onChange,iconHtml,preparedIndex=null,itemIndex,selection}){
  const store=createTaskStore();let index=preparedIndex,entries=[],active=new Set(),updating=false;const opened=new Set();
  const requestedTask=new URLSearchParams(location.search).get('task');if(requestedTask)opened.add(requestedTask);
  const href=id=>`tasks.html?map=${encodeURIComponent(mapId)}${id?'&task='+encodeURIComponent(id):''}`;
  const key=(task,row)=>objectiveSelectionKey(task.id,row.objective.id);
  const available=entry=>entry.objectives.filter(row=>row.points.size);
  const keys=()=>entries.flatMap(entry=>available(entry).map(row=>key(entry.task,row)));
  host.innerHTML='<summary>我的任务</summary><p class="hint" role="status">加载任务…</p>';
  function update(){
    if(!index||updating)return;updating=true;
    const focusKey=host.querySelector(':focus')?.dataset.focusKey;
    host.querySelectorAll('.my-task-group').forEach(el=>el.open?opened.add(el.dataset.task):opened.delete(el.dataset.task));
    entries=index.entries(store.getState().selected);let changed=false;
    for(const entry of entries){
      changed=syncTaskObjectives(selection,entry.task.id,entry.objectives.map(row=>({key:key(entry.task,row),complete:store.isCompleted(entry.task.id,row.objective.id),visible:Boolean(row.points.size&&store.objectiveVisible(mapId,entry.task.id,row.objective.id)&&store.taskVisible(mapId,entry.task.id))})))||changed;
    }
    active=new Set();for(const entry of entries)for(const row of entry.objectives)if(selection.keys.has(key(entry.task,row)))for(const point of row.points)active.add(point);
    host.innerHTML=`<summary>我的任务 <small>${entries.length} 项</small></summary><div class="my-task-actions"><a href="${href()}">管理任务 ↗</a></div>${entries.length?'':'<p class="hint">本图暂无已选任务。</p>'}<div class="my-task-entries">${entries.map(entry=>{const {task,objectives}=entry;return `<details class="my-task-group" data-task="${task.id}" ${opened.has(task.id)?'open':''}><summary><input type="checkbox" data-parent="${task.id}" data-focus-key="${task.id}" ${!available(entry).length?'disabled':''} aria-label="显示任务：${escape(task.name)}"><span>${escape(task.name)}</span><small>${objectives.length}</small></summary><a class="my-task-detail" href="${href(task.id)}">任务详情 ↗</a>${objectives.map(row=>{const o=row.objective,complete=store.isCompleted(task.id,o.id),id=key(task,row);return `<label class="my-task-goal ${complete?'is-complete':''}"><input type="checkbox" data-goal="${id}" data-focus-key="${id}" ${selection.keys.has(id)?'checked':''} ${!row.points.size?'disabled':''}><span>${o.itemIds?.length?iconHtml(o.itemIds[0]):''}<span>${escape(o.text)}</span><small>${complete?'已完成 · ':''}${row.points.size?`${row.points.size} 个${row.candidate?'候选点':'位置'}`:escape(row.hint)}</small></span></label>`;}).join('')}</details>`;}).join('')}</div>`;
    for(const entry of entries)Object.assign(host.querySelector(`[data-parent="${entry.task.id}"]`),checkboxState(available(entry).map(row=>key(entry.task,row)),selection.keys));
    if(focusKey)host.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
    if(changed)selection.changed();updating=false;onChange();
  }
  async function load(){try{const response=await fetch('data/tasks/catalog.json');if(!response.ok)throw Error();index=createTaskMapIndex({catalog:await response.json(),data,mapId,itemIndex});update();}catch{host.innerHTML=`<summary>我的任务</summary><p class="hint">任务加载失败。</p><button data-retry>重试</button>`;}}
  host.addEventListener('click',event=>{if(event.target.closest('[data-parent]'))event.stopPropagation();if(event.target.closest('[data-retry]'))load();});
  host.addEventListener('change',event=>{const el=event.target;if(el.dataset.parent){const entry=entries.find(e=>e.task.id===el.dataset.parent);if(entry)selection.setMany(available(entry).map(row=>key(entry.task,row)),el.checked);}else if(el.dataset.goal)selection.set(el.dataset.goal,el.checked);});
  selection.subscribe(()=>update());store.subscribe(()=>update());
  if(index)queueMicrotask(()=>update());else load();
  return {matches:point=>active.has(point),get keys(){return keys();},
    enable(taskId){if(taskId){opened.add(taskId);const group=[...host.querySelectorAll('[data-task]')].find(el=>el.dataset.task===taskId);if(group)group.open=true;}selection.setMany(entries.flatMap(e=>available(e).filter(r=>!store.isCompleted(e.task.id,r.objective.id)).map(r=>key(e.task,r))),true);host.open=true;},
    reset(){selection.setMany(keys(),false);},selection:()=>store.getState(),
    links(point){const linked=entries.filter(e=>e.objectives.some(o=>o.points.has(point)));return linked.length?`<div class="my-task-point-links"><h3>我的任务</h3>${linked.map(e=>`<a href="${href(e.task.id)}">${escape(e.task.name)} ↗</a>`).join('')}</div>`:'';}
  };
}
