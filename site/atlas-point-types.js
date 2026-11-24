import {FAMILIES,CONTAINERS,looseMarkerFamily} from './factory-marker-rules.js';
import {createTaskPointIndex,taskPointKeys,taskObjectiveKey,selectTaskObjectives} from './atlas-task-point-index.js';
import {createTaskPointTree} from './atlas-task-point-tree.js';
const LOOSE_FAMILIES=FAMILIES,looseFamily=looseMarkerFamily;
// Grid sizes from the local SPT container templates distinguish otherwise
// identically named weapon boxes without exposing opaque template suffixes.
const CONTAINER_SIZES={'5909d7cf86f77470ee57d75a':'4×4','5909d76c86f77471e53d2adf':'6×3','5909d5ef86f77467974efbd8':'5×2','5909d89086f77472591234a0':'5×5'};

export const POI_TYPES={
  quest_visit:['探索 / 到达','map-quest_objective'],quest_place:['放置 / 藏匿','map-quest_objective'],quest_beacon:['安装标记器','map-quest_objective'],
  quest_item:['任务物品','map-quest_item'],quest_interact:['调查 / 交互','map-quest_objective'],quest_zone:['指定区域目标','map-quest_objective'],quest_flare:['发射信号弹','map-quest_objective'],quest_extract:['任务撤离点','map-quest_objective'],
  extract_pmc:['PMC 撤离点','map-extract_pmc'],extract_scav:['Scav 撤离点','map-extract_scav'],extract_shared:['共同撤离点','map-extract_shared'],
  extract_secret:['秘密撤离点','map-extract_shared'],transit:['地图转移点','map-extract_transit'],locked_door:['上锁的门 / 钥匙','map-lock'],
  spawn_pmc:['PMC 玩家出生候选点','map-spawn_pmc'],spawn_scav:['Scav 玩家出生候选点','map-spawn_scav'],scav_ai:['Scav AI 生成候选点','map-spawn_scav'],
  boss:['BOSS 候选区域','map-spawn_boss'],sniper:['狙击 Scav 候选点','map-spawn_sniper_scav'],
  machinegun:['固定机枪','map-stationarygun'],grenade_launcher:['固定榴弹发射器','map-stationarygun'],stationary:['其他固定武器','map-stationarygun'],
  mine:['地雷 / 定向雷','map-hazard'],sniper_zone:['边界狙击危险区','map-hazard'],
};

export function pointTypeKeys(point,data){
  if(point.kind==='poi')return point.quest?taskPointKeys(point):point.poiTypes.map(k=>'poi:'+k);
  if(point.kind==='container')return ['container:'+point.containerTpl];
  const families=[...new Set((point.candidates||[]).filter(c=>c.weight==null||c.weight>0).map(c=>looseFamily(c.tpl,data)))];
  if(!families.length)return ['loose:other'];
  // Mixed is a marker appearance, not an item family. A point belongs to
  // every category present in its full eligible root pool.
  return families.map(f=>'loose:'+f);
}

export function buildPointTypes(data){
  const types=new Map(),members=new Map(),taskIndex=createTaskPointIndex(data);
  for(const p of data.points){
    const keys=pointTypeKeys(p,data);members.set(p.id,keys);
    for(const key of keys){
      if(!types.has(key)){
        const [group,id]=key.split(':');
        if(group==='quest'){
          const row=taskIndex.byKey.get(key);if(row)types.set(key,{...row,group,label:row.label,count:0});
          else continue;
        }else{
        const containerName=data.items[id]?.zh;
        const label=group==='container'?(CONTAINERS[id]?.[1]||(containerName&&containerName!==id?containerName:`未识别容器 · ${id.slice(-6)}`)):['poi','quest'].includes(group)?POI_TYPES[id]?.[0]:(LOOSE_FAMILIES[id]||LOOSE_FAMILIES.other)[0];
        types.set(key,{key,group,label:CONTAINER_SIZES[id]?`${label}（${CONTAINER_SIZES[id]}）`:label||id,count:0});
        }
      }
      if(p.position&&!p.outsideClientEnvelope&&types.has(key))types.get(key).count++;
    }
  }
  const labels=new Map();for(const t of types.values())if(t.group==='container')labels.set(t.label,(labels.get(t.label)||0)+1);
  for(const t of types.values())if(t.group==='container'&&labels.get(t.label)>1)t.label+=` · ${t.key.slice(-4)}`;
  return {types:[...types.values()],members,taskIndex};
}

export const matchesPointTypes=(keys,selected)=>keys.some(key=>selected.has(key));

export function createPointTypesUI(data,host,onChange,{foldout,auxHost=host,selection}={}){
  const {types,members,taskIndex}=buildPointTypes(data),selected=selection?.keys||new Set();
  const notify=()=>{selection?.changed();onChange();};
  const checks=new Map(),parents=new Map();let taskTree,taskContent,taskToggle;
  for(const [group,label] of [['container','可搜刮容器'],['loose','散落物资'],['quest','任务点位'],['poi','特殊点位']]){
    const rows=types.filter(t=>t.group===group).sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));
    if(!rows.length)continue;
    const section=document.createElement('div');section.className='type-group';
    const heading=document.createElement('div');heading.className='type-group-heading';
    const parent=document.createElement('input');parent.type='checkbox';parent.dataset.typeGroup=group;parent.setAttribute('aria-label',label+'全选');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='type-group-toggle';toggle.textContent=label;toggle.dataset.toggleGroup=group;
    const content=document.createElement('div');content.className='type-group-options';content.id='typeGroup-'+group;content.hidden=true;
    toggle.setAttribute('aria-controls',content.id);toggle.setAttribute('aria-expanded','false');
    heading.append(parent,toggle);section.append(heading,content);parents.set(group,{parent,rows});
    if(foldout)foldout(toggle,content,group);else toggle.onclick=()=>{content.hidden=!content.hidden;toggle.setAttribute('aria-expanded',String(!content.hidden));};
    if(group==='quest'){
      taskContent=content;taskToggle=toggle;
      taskTree=createTaskPointTree({host:content,index:taskIndex,selected,onChange:()=>{sync();notify();}});
    }else for(const row of rows){
      const label=document.createElement('label');label.className='check type-option';label.title=`全图 ${row.count} 个点位；多类别点位可能重复计数`;
      const input=document.createElement('input');input.type='checkbox';input.dataset.pointType=row.key;input.checked=selected.has(row.key);
      const name=document.createElement('b');name.textContent=row.label;
      const count=document.createElement('span');count.textContent=row.count;
      label.append(input,name,count);content.append(label);checks.set(row.key,input);
      input.onchange=()=>{input.checked?selected.add(row.key):selected.delete(row.key);sync();notify();};
    }
    parent.onchange=()=>{for(const row of rows)parent.checked?selected.add(row.key):selected.delete(row.key);sync();notify();};
    (['quest','poi'].includes(group)?auxHost:host).append(section);
  }
  function sync(){for(const [key,input] of checks)input.checked=selected.has(key);for(const {parent,rows} of parents.values()){const n=rows.filter(t=>selected.has(t.key)).length;parent.checked=n===rows.length;parent.indeterminate=n>0&&n<rows.length;}taskTree?.sync();}
  sync();selection?.subscribe(sync);
  function all(value,groups=['container','loose','quest','poi']){for(const t of types)if(groups.includes(t.group))value?selected.add(t.key):selected.delete(t.key);sync();}
  return {selected,types,matches:p=>matchesPointTypes(members.get(p.id)||[],selected),
    reset(){selected.clear();sync();notify();},
    quests(){all(true,['quest']);},
    taskIndex,
    taskReferences(point){const refs=point.questObjectives||[],active=refs.filter(ref=>selected.has(taskObjectiveKey(ref)));return active.length?active:refs;},
    selectTask(id,{exclusive=false}={}){if(exclusive)all(false,['quest']);const task=taskIndex.byTask.get(id);if(task)selectTaskObjectives(task.objectives,selected,true);else if(!id)all(true,['quest']);sync();notify();if(taskContent){taskContent.hidden=false;taskToggle.setAttribute('aria-expanded','true');taskTree.reveal(id);}},
    search:query=>taskIndex.search(query),
    renderSearch(host,entries){return createTaskPointTree({host,index:taskIndex,selected,entries,search:true,onChange:()=>{sync();notify();}});},
    setType(key,value){value?selected.add(key):selected.delete(key);sync();notify();},
    quick(category){selected.clear();const wanted=new Set(Object.entries(data.items).filter(([,i])=>i.category===category).map(([tpl])=>'loose:'+looseFamily(tpl,data)));for(const t of types)if(wanted.has(t.key))selected.add(t.key);sync();},
    all
  };
}
