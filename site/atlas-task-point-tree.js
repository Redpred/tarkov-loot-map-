import {taskSelectionState,selectTaskObjectives} from './atlas-task-point-index.js';
let treeId=0;
export function createTaskPointTree({host,index,selected,onChange,entries=index.tasks.map(task=>({task,objectives:task.objectives})),search=false}){
  const parents=[],checks=[],groups=new Map(),prefix=`task-point-tree-${++treeId}`;
  const fragment=document.createDocumentFragment();
  for(const {task,objectives} of entries){
    const group=document.createElement('section');group.className='task-point-group';group.dataset.task=task.id;
    const heading=document.createElement('div');heading.className='task-point-heading';
    const parent=document.createElement('input');parent.type='checkbox';parent.dataset.taskParent=task.id;parent.setAttribute('aria-label',`显示任务：${task.name}（全部目标）`);parent.title='勾选或取消本任务的全部目标';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='task-point-toggle';toggle.dataset.taskToggle=task.id;
    const name=document.createElement('strong');name.textContent=task.name;
    const meta=document.createElement('small');meta.textContent=`${task.objectives.length} 个目标 · ${task.count} 个点位`;
    const text=document.createElement('span');text.append(name,meta);toggle.append(text);toggle.title=task.en||task.name;
    const content=document.createElement('div');content.className='task-point-objectives';content.id=prefix+'-'+task.id;
    content.hidden=!search;toggle.setAttribute('aria-controls',content.id);toggle.setAttribute('aria-expanded',String(search));
    toggle.onclick=()=>{content.hidden=!content.hidden;toggle.setAttribute('aria-expanded',String(!content.hidden));};
    heading.append(parent,toggle);group.append(heading,content);groups.set(task.id,{toggle,content});
    if(search&&objectives.length<task.objectives.length){const note=document.createElement('p');note.className='task-point-search-note';note.textContent=`匹配 ${objectives.length} 个目标；任务复选框选择全部 ${task.objectives.length} 个目标`;content.append(note);}
    for(const objective of objectives){
      const label=document.createElement('label');label.className='task-point-objective';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.taskGoal=objective.key;checkbox.setAttribute('aria-label',`显示目标：${task.name} · ${objective.label}`);
      const copy=document.createElement('span'),description=document.createElement('span'),count=document.createElement('small');description.textContent=objective.label;
      count.textContent=`${objective.count} 个${objective.candidate?'候选点':'点位'}`;
      const ref=objective.reference;if(ref.count>1)count.textContent+=` · 需要 ${ref.count} 个`;if(ref.plantTime)count.textContent+=` · 放置 ${ref.plantTime} 秒`;
      copy.append(description,count);label.append(checkbox,copy);content.append(label);checks.push({checkbox,objective});
      checkbox.onchange=()=>{selectTaskObjectives([objective],selected,checkbox.checked);sync();onChange();};
    }
    parents.push({parent,task});parent.onchange=()=>{selectTaskObjectives(task.objectives,selected,parent.checked);sync();onChange();};
    fragment.append(group);
  }
  host.replaceChildren(fragment);
  function sync(){
    for(const {checkbox,objective} of checks)checkbox.checked=selected.has(objective.key);
    for(const {parent,task} of parents){const status=taskSelectionState(task.objectives,selected);parent.checked=status.checked;parent.indeterminate=status.indeterminate;}
  }
  sync();return {sync,reveal(id){const group=groups.get(id);if(group){group.content.hidden=false;group.toggle.setAttribute('aria-expanded','true');}}};
}
