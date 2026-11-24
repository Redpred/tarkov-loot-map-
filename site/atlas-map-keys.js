import {icon} from './ui-icons.js';
import {checkboxState} from './atlas-point-selection.js';
import {createItemIndex} from './atlas-item-index.js';

const validPosition=p=>p&&['x','y','z'].every(axis=>Number.isFinite(p[axis]));

// A key belongs here because it opens a door on this map, not because it can
// spawn as loot here. Keep every distinct door for keys with multiple uses.
export function buildMapKeyIndex(data,itemIndex){
  const byKey=new Map(),seen=new Set();
  for(const point of data.points||[]){
    if(point.kind!=='poi'||!point.poiTypes?.includes('locked_door')||typeof point.keyId!=='string'||!point.keyId.trim()||!validPosition(point.position)||point.outsideClientEnvelope||point.active===false)continue;
    const keyId=point.keyId,signature=JSON.stringify([keyId,point.position.x,point.position.y,point.position.z]);
    if(seen.has(signature))continue;seen.add(signature);
    if(!byKey.has(keyId)){
      const item=data.items?.[keyId]||{};
      byKey.set(keyId,{keyId,name:item.zh||item.name||item.en||'未命名钥匙',en:item.en||'',doors:[],spawns:[]});
    }
    byKey.get(keyId).doors.push(point);
  }
  const entries=[...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})||a.keyId.localeCompare(b.keyId));
  // Reuse the same candidate index as item search, including shared container
  // pools, forced contents and items inside loot presets. Never infer a spawn
  // from a door's keyId or from an item merely being listed in the catalogue.
  if(entries.length){
    const items=itemIndex||createItemIndex(data),spawns=new Map();
    for(const point of data.points||[]){
      if(['loose','container'].includes(point.kind)&&validPosition(point.position)&&!point.outsideClientEnvelope&&point.active!==false)spawns.set(point.id,point);
    }
    for(const entry of entries){
      const ids=new Set([entry.keyId]);
      entry.spawns=[...spawns.values()].filter(point=>items.matches(point,ids));
    }
  }
  for(const entry of entries)entry.doors.sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x||a.position.z-b.position.z||a.id.localeCompare(b.id));
  return {entries,byKey};
}

export function keyDoorView(point,bands,map){
  const height=point.position.y,band=bands.find(b=>height>=b.min&&height<b.max);
  // Show the door's storey and cut away overhead floors even in a wide band.
  return {band:band?.id||'all',cut:Math.min(band?.max??Math.max(map.maxHeight,height+2),height+2)};
}

export const mapKeySelectionKey=keyId=>`map-key:${keyId}`;
export function selectedKeyDoorIds(index,selected){
  return new Set(index.entries.filter(e=>selected.has(mapKeySelectionKey(e.keyId))).flatMap(e=>e.doors.map(p=>p.id)));
}
export function selectedKeyPointIds(index,selected){
  return new Set(index.entries.filter(e=>selected.has(mapKeySelectionKey(e.keyId))).flatMap(e=>[...e.doors,...e.spawns].map(p=>p.id)));
}

export function createMapKeys({data,itemIndex,host,selection,foldout,iconHtml,onSelect}){
  const index=buildMapKeyIndex(data,itemIndex),keys=index.entries.map(e=>mapKeySelectionKey(e.keyId));
  let ids=new Set(),checks=[];
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const section=make('div','type-group map-key-tree'),heading=make('div','type-group-heading');
  const all=make('input');all.type='checkbox';all.setAttribute('aria-label','地图钥匙全选');all.disabled=!index.entries.length;
  const toggle=make('button','type-group-toggle','地图钥匙');toggle.type='button';toggle.setAttribute('aria-expanded','false');
  const content=make('div','type-group-options');content.id='mapKeyOptions';content.hidden=true;toggle.setAttribute('aria-controls',content.id);
  heading.append(all,toggle);section.append(heading,content);host.append(section);
  if(foldout)foldout(toggle,content,'map-keys');else toggle.onclick=()=>{content.hidden=!content.hidden;toggle.setAttribute('aria-expanded',String(!content.hidden));};
  const count=make('p','map-keys-count');count.setAttribute('role','status');
  const label=make('label','sr-only','搜索地图钥匙');label.htmlFor='mapKeySearch';
  const search=make('input','map-keys-search');search.id='mapKeySearch';search.type='search';search.placeholder='搜索钥匙名称';search.autocomplete='off';
  const list=make('ul','map-keys-list');list.setAttribute('aria-label','当前地图钥匙');
  const empty=make('p','map-keys-empty');
  const hint=make('p','hint','同时显示对应门与可能刷出钥匙的散落点、容器。刷新不保证；未收录不代表不存在。');
  content.append(label,search,hint,count,list,empty);
  function doorLabel(point,i){
    return `门 ${i+1} · 高度 ${point.position.y.toFixed(2)} m`;
  }
  function select(point){selection.set(mapKeySelectionKey(point.keyId),true);onSelect(point);}
  function doorButtons(entry,current=null){
    const targets=make('div','map-key-doors');
    entry.doors.forEach((point,i)=>{
      const target=make('button','',doorLabel(point,i));target.type='button';target.dataset.keyDoor=point.id;
      target.setAttribute('aria-label',`定位${entry.name}：${doorLabel(point,i)}`);
      target.setAttribute('aria-pressed',String(point.id===current?.id));target.title=`X ${point.position.x.toFixed(1)} · Y ${point.position.y.toFixed(1)} · Z ${point.position.z.toFixed(1)}`;
      target.addEventListener('click',()=>select(point));targets.append(target);
    });
    return targets;
  }
  function render(){
    const tokens=search.value.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const entries=index.entries.filter(e=>tokens.every(token=>`${e.name} ${e.en} ${e.keyId}`.toLocaleLowerCase().includes(token)));
    const spawnCount=new Set(entries.flatMap(e=>e.spawns.map(p=>p.id))).size;
    count.textContent=`${entries.length} 把钥匙 · ${entries.reduce((n,e)=>n+e.doors.length,0)} 扇门 · ${spawnCount} 个可能刷新点（去重）`;
    const fragment=document.createDocumentFragment();checks=[];
    for(const entry of entries){
      const row=make('li','map-key-row'),line=make('div','map-key-line'),choice=make('label','map-key-choice');
      const check=make('input');check.type='checkbox';check.dataset.mapKey=entry.keyId;check.setAttribute('aria-label',`地图钥匙：${entry.name}`);
      const key=mapKeySelectionKey(entry.keyId);checks.push({input:check,key});check.onchange=()=>selection.set(key,check.checked);
      const target=make('button','map-key-jump');target.type='button';target.dataset.keyJump=entry.keyId;target.title=`跳转到${entry.name}对应的门`;
      target.setAttribute('aria-label',`定位钥匙：${entry.name}`);
      const picture=make('span','map-key-icon');picture.setAttribute('aria-hidden','true');picture.innerHTML=iconHtml(entry.keyId);
      if(!picture.querySelector('img')){picture.innerHTML=icon('key');picture.title='此钥匙暂无物品图片';}
      const text=make('span','map-key-copy');text.append(make('strong','',entry.name),make('small','',`${entry.doors.length} 扇门 · ${entry.spawns.length?`${entry.spawns.length} 个可能刷新点`:'未收录刷新点'}`));
      target.innerHTML=icon('focus');target.addEventListener('click',()=>select(entry.doors[0]));
      choice.append(check,picture,text);line.append(choice,target);row.append(line);
      if(entry.doors.length>1){const doors=make('details','map-key-options');doors.append(make('summary','',`选择门的位置（${entry.doors.length}）`),doorButtons(entry));row.append(doors);}
      fragment.append(row);
    }
    list.replaceChildren(fragment);empty.hidden=entries.length>0;empty.textContent=index.entries.length?'没有匹配的钥匙':data.poiSources?'当前地图暂无已收录的钥匙门':'门锁数据加载失败，请刷新重试';sync();
  }
  function sync(){ids=selectedKeyPointIds(index,selection.keys);for(const {input,key} of checks)input.checked=selection.keys.has(key);Object.assign(all,checkboxState(keys,selection.keys));}
  all.onchange=()=>selection.setMany(keys,all.checked);selection.subscribe(sync);search.addEventListener('input',render);render();
  return {index,keys,matches:point=>ids.has(point.id),appendDoorLinks(point,host){
    const entry=index.byKey.get(point.keyId);if(!entry||entry.doors.length<2)return;
    const section=make('section','map-key-related');section.append(make('h3','',`此钥匙可打开的门（${entry.doors.length}）`),doorButtons(entry,point));host.append(section);
  }};
}
