import {emptySettings,pointSettingKey,typeSettingKey,validateSettings,readMapIconSettings,editTypeAcrossMaps,resolveMarker} from './factory-icon-settings.js';
import {ATLAS_MAPS} from './atlas-maps.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groupNames={loose:'散落物资分类',container:'可搜刮容器',poi:'特殊与任务点位',item:'单一物品点位'};

export function createIconEditor({base,icons,onChange,exportName='factory'}){
  const entries=icons.manifest.entries,maps=Object.values(ATLAS_MAPS);
  const dialog=document.createElement('dialog');dialog.className='icon-dialog icon-workspace';dialog.setAttribute('aria-labelledby','iconEditorTitle');
  dialog.innerHTML=`<div class="icon-editor-head"><h2 id="iconEditorTitle">自定义点位图标</h2><button id="closeIconEditor" aria-label="关闭图标设置">关闭 ×</button></div>
    <div class="icon-workspace-toolbar"><details id="iconMapDropdown" class="icon-map-dropdown"><summary id="iconMapSummary" aria-label="应用地图（多选）"></summary><div class="icon-map-options" role="group" aria-label="选择应用地图"><label><input id="iconAllMaps" type="checkbox">全部地图</label>${maps.map(m=>`<label><input type="checkbox" data-icon-map="${m.id}" value="${m.id}">${m.name}</label>`).join('')}</div></details><span>先选左侧点位，再选右侧图片 · 自动保存</span></div>
    <div class="icon-workspace-body"><section class="icon-target-panel" aria-label="点位分类图标"><label class="sr-only" for="iconTypeSearch">搜索点位分类</label><input id="iconTypeSearch" type="search" placeholder="搜索点位分类…"><div id="iconTargets" class="icon-targets"></div></section>
    <section class="icon-library-panel" aria-label="全部图片列表"><div class="icon-browser-tools"><label class="sr-only" for="iconSearch">搜索图标</label><input id="iconSearch" type="search" placeholder="搜索中文、英文、物品 ID…" autocomplete="off"><label class="sr-only" for="iconSource">图标来源</label><select id="iconSource"><option value="all">全部图片</option><option value="map">地图与容器</option><option value="item">游戏物品</option><option value="category">分类代表</option></select></div>
    <div class="icon-results-meta"><span id="iconResultCount"></span><span><button id="iconPrev" aria-label="上一页图标">←</button> <span id="iconPage"></span> <button id="iconNext" aria-label="下一页图标">→</button></span></div><div id="iconGrid" class="icon-grid" role="group" aria-label="可选图标"></div></section></div>
    <div class="icon-choice"><img id="chosenIcon" alt=""><div><strong id="chosenIconName">选择一个点位分类</strong><small id="chosenIconId"></small></div><button id="resetIconScope">恢复选中项默认</button></div>
    <p id="iconEditorStatus" role="status" aria-live="polite"></p>
    <div class="icon-editor-footer"><span>分类修改保留已有单点设置</span><div><button id="exportIcons">导出所选地图配置</button><button id="importIcons">导入配置</button><button id="resetAllIcons">所选地图恢复默认</button><input id="iconImportFile" type="file" accept=".json,application/json" hidden></div></div>`;
  document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);
  const library=Object.entries(entries).filter(([key,entry])=>key.startsWith('symbol-')||key.startsWith('map-')||key.startsWith('item-')||entry.source==='game-icon-cache')
    .map(([key,entry])=>({key,...entry,kind:key.startsWith('map-')?'map':key.startsWith('item-')?'item':'category',search:`${entry.name||''} ${entry.shortName||''} ${entry.en||''} ${entry.representative||''} ${entry.tpl||''} ${key}`.toLowerCase()}));
  let types=[],point=null,selection=null,page=0,busy=false,selectedMaps=new Set([exportName]),settings={},catalogPromise;
  const pageSize=60;
  const status=(message,error=false)=>{$('iconEditorStatus').textContent=message;$('iconEditorStatus').classList.toggle('error',error);};
  const loadSettings=()=>{settings=Object.fromEntries(maps.map(m=>[m.id,readMapIconSettings(localStorage,m,entries)]));};
  const availableTypes=()=>types.filter(t=>[...selectedMaps].some(id=>t.maps[id]));
  const targetType=()=>selection?.kind==='type'?types.find(t=>t.key===selection.key):null;
  function pointIcon(){return resolveMarker(point,base.get(point.id),settings[exportName],entries).key;}
  function typeIcon(id,type){const key=settings[id].types[type.key]||type.icon;return !['item','poi'].includes(type.group)&&!entries[key]?.file.endsWith('.svg')?type.icon:key;}
  function currentIcons(){
    if(!selection)return [];
    if(selection.kind==='point')return [pointIcon()];
    const type=targetType();return [...new Set([...selectedMaps].map(id=>typeIcon(id,type)))];
  }
  function syncMaps(){
    const count=selectedMaps.size;$('iconMapSummary').textContent=count===maps.length?`全部地图（${maps.length}）`:count===1?ATLAS_MAPS[[...selectedMaps][0]].name:`已选 ${count} 张地图`;
    $('iconAllMaps').checked=count===maps.length;$('iconAllMaps').indeterminate=count>0&&count<maps.length;
    for(const el of dialog.querySelectorAll('[data-icon-map]'))el.checked=selectedMaps.has(el.value);
  }
  function renderTargets(){
    const folds=new Map([...$('iconTargets').querySelectorAll('details[data-group]')].map(el=>[el.dataset.group,el.open]));
    const q=$('iconTypeSearch').value.trim().toLocaleLowerCase(),available=availableTypes();
    let html=point?`<button class="icon-target" data-target-point="true" aria-pressed="${selection?.kind==='point'}"><img src="${escape(entries[pointIcon()].file)}" alt=""><span>仅当前点位<small>${ATLAS_MAPS[exportName].name} · ${escape(base.get(point.id).label)}</small></span></button>`:'';
    for(const [group,label] of Object.entries(groupNames)){
      const rows=available.filter(t=>t.group===group&&(!q||`${t.label} ${t.key}`.toLocaleLowerCase().includes(q)));if(!rows.length)continue;
      const open=q||(folds.get(group)??(group!=='item'||rows.some(t=>t.key===selection?.key)));
      html+=`<details data-group="${group}" ${open?'open':''}><summary>${label} <small>${rows.length}</small></summary>${rows.map(t=>{
        const keys=[...new Set([...selectedMaps].map(id=>typeIcon(id,t)))],key=keys[0]||t.icon,count=[...selectedMaps].reduce((sum,id)=>sum+(t.maps[id]||0),0);
        return `<button class="icon-target" data-target-type="${escape(t.key)}" aria-pressed="${selection?.kind==='type'&&selection.key===t.key}" title="${escape(t.label)}"><img src="${escape(entries[key].file)}" alt="" loading="lazy"><span>${escape(t.label)}<small>${count} 个点位${keys.length>1?' · 各地图图标不同':''}</small></span></button>`;
      }).join('')}</details>`;
    }
    $('iconTargets').innerHTML=html||'<p class="hint">选择地图，或调整分类搜索。</p>';
  }
  function renderChoice(){
    const keys=currentIcons(),entry=entries[keys[0]];$('chosenIcon').hidden=!entry;if(entry)$('chosenIcon').src=entry.file;
    $('chosenIconName').textContent=selection?.kind==='point'?'仅当前点位':targetType()?.label||'选择一个点位分类';
    $('chosenIconId').textContent=keys.length>1?'所选地图当前使用不同图标':entry?.name||entry?.representative||'';
    $('resetIconScope').disabled=busy||!selection||!selectedMaps.size;
  }
  function renderGrid(){
    const q=$('iconSearch').value.trim().toLowerCase(),kind=$('iconSource').value,chosen=currentIcons();
    const symbolOnly=selection?.kind==='point'?['loose','container'].includes(point.kind)&&base.get(point.id).mode!=='item':selection?.kind==='type'&&!['item','poi'].includes(targetType()?.group);
    const filtered=library.filter(it=>(!symbolOnly||it.file.endsWith('.svg'))&&(kind==='all'||it.kind===kind)&&(!q||it.search.includes(q))),pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.max(0,Math.min(page,pages-1));
    $('iconResultCount').textContent=`${filtered.length.toLocaleString()} 张图片`;$('iconPage').textContent=`${page+1} / ${pages}`;
    $('iconPrev').disabled=page===0||busy;$('iconNext').disabled=page===pages-1||busy;
    $('iconGrid').innerHTML=filtered.slice(page*pageSize,(page+1)*pageSize).map(it=>`<button class="icon-option" data-icon="${escape(it.key)}" title="${escape(it.name||it.representative)}${it.tpl?' · '+it.tpl:''}" aria-pressed="${chosen.length===1&&entries[chosen[0]]?.file===it.file}" ${busy||!selection||!selectedMaps.size?'disabled':''}><img src="${escape(it.file)}" alt="" loading="lazy"><span>${escape(it.name||it.representative)}</span></button>`).join('')||'<p class="icon-empty">没有匹配图片。</p>';
  }
  function render(){syncMaps();renderTargets();renderChoice();renderGrid();}
  function selectTypeFallback(){if(selection?.kind==='type'&&!availableTypes().some(t=>t.key===selection.key))selection=null;if(!selection&&availableTypes().length)selection={kind:'type',key:availableTypes().find(t=>t.group==='loose')?.key||availableTypes()[0].key};}
  async function commit(batch,message){
    if(busy||!Object.keys(batch).length)return;busy=true;
    for(const el of dialog.querySelectorAll('button,input,select'))el.disabled=true;status('正在保存…');
    try{await onChange(batch);loadSettings();status(message);}
    catch(error){status(`未能保存：${error.message}`,true);}
    finally{busy=false;for(const el of dialog.querySelectorAll('button,input,select'))el.disabled=false;render();}
  }
  function changeIcon(icon){
    if(busy||!selection||!selectedMaps.size)return;
    try{loadSettings();}catch(error){status(error.message,true);return;}
    const batch=selection.kind==='point'?{[exportName]:structuredClone(settings[exportName])}:editTypeAcrossMaps(settings,[...selectedMaps],selection.key,icon);
    if(selection.kind==='point'){if(icon===null)delete batch[exportName].points[pointSettingKey(point)];else batch[exportName].points[pointSettingKey(point)]=icon;}
    commit(batch,`${icon===null?'已恢复默认':'已保存'} · ${selection.kind==='point'?'当前点位':Object.keys(batch).length+' 张地图'}`);
  }
  $('closeIconEditor').onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('iconAllMaps').onchange=()=>{if(busy)return;selectedMaps=new Set($('iconAllMaps').checked?maps.map(m=>m.id):[]);selection=selection?.kind==='point'?null:selection;selectTypeFallback();render();status(selectedMaps.size?'修改将应用于勾选的地图。':'至少选择一张地图。');};
  for(const el of dialog.querySelectorAll('[data-icon-map]'))el.onchange=()=>{if(busy)return;if(el.checked)selectedMaps.add(el.value);else selectedMaps.delete(el.value);if(selection?.kind==='point')selection=null;selectTypeFallback();render();status('修改将应用于勾选的地图。');};
  $('iconTargets').onclick=e=>{
    if(busy)return;const own=e.target.closest('[data-target-point]'),type=e.target.closest('[data-target-type]');if(!own&&!type)return;
    if(own){selection={kind:'point'};selectedMaps=new Set([exportName]);}else selection={kind:'type',key:type.dataset.targetType};
    render();status(selection.kind==='point'?'仅修改当前点位。':'点击右侧图片即可替换；已有单点设置保持不变。');
  };
  $('iconTypeSearch').oninput=renderTargets;
  for(const id of ['iconSearch','iconSource'])$(id).oninput=()=>{page=0;renderGrid();};
  $('iconPrev').onclick=()=>{page--;renderGrid();};$('iconNext').onclick=()=>{page++;renderGrid();};
  $('iconGrid').onclick=e=>{const key=e.target.closest('[data-icon]')?.dataset.icon;if(key)changeIcon(key);};
  $('resetIconScope').onclick=()=>changeIcon(null);
  $('resetAllIcons').onclick=()=>commit(Object.fromEntries([...selectedMaps].map(id=>[id,emptySettings()])),'所选地图已恢复默认。');
  $('exportIcons').onclick=()=>{
    if(!selectedMaps.size){status('至少选择一张地图。',true);return;}
    const value={version:2,maps:Object.fromEntries([...selectedMaps].map(id=>[id,settings[id]]))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='atlas-map-icon-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出所选地图配置。');
  };
  $('importIcons').onclick=()=>$('iconImportFile').click();
  $('iconImportFile').onchange=async()=>{
    const file=$('iconImportFile').files[0];$('iconImportFile').value='';if(!file)return;
    try{
      if(file.size>32*1024*1024)throw new Error('配置文件超过 32 MB');const value=JSON.parse(await file.text()),batch={};
      if(value.version===1){if(!selectedMaps.has(exportName))throw new Error('旧版单地图配置需要勾选当前地图');batch[exportName]=validateSettings(value,entries);}
      else if(value.version===2&&value.maps&&typeof value.maps==='object'&&!Array.isArray(value.maps)){for(const id of selectedMaps)if(Object.hasOwn(value.maps,id))batch[id]=validateSettings(value.maps[id],entries);}
      else throw new Error('配置格式或版本不支持');
      if(!Object.keys(batch).length)throw new Error('文件中没有所选地图的配置');await commit(batch,`已导入 ${Object.keys(batch).length} 张地图的配置。`);
    }catch(error){status(`导入失败：${error.message}`,true);}
  };
  return {async open(selectedPoint=null){
    point=selectedPoint;selectedMaps=new Set([exportName]);selection=point?{kind:'point'}:null;page=0;
    $('iconSearch').value='';$('iconTypeSearch').value='';$('iconSource').value='all';syncMaps();dialog.showModal();status('正在读取点位分类…');
    try{
      catalogPromise??=fetch('data/atlas-icon-types.json').then(r=>{if(!r.ok)throw new Error('分类目录读取失败');return r.json();}).catch(error=>{catalogPromise=null;throw error;});
      types=(await catalogPromise).types;loadSettings();selectTypeFallback();render();status('先选左侧点位，再选右侧图片。');
    }catch(error){status(error.message,true);}
  }};
}
