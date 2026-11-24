import {createItemIndex} from './atlas-item-index.js';

const MAX_TARGETS=100;
let instanceCount=0;

export function createItemSearch({data,mapId,input,sectionHost,iconHtml,onChange=()=>{},index=createItemIndex(data),taskPoints=null}){
  const storageKey=`tarkov-target-items-v1:${mapId}`;
  const targets=new Map();
  let itemId=null,exactSearch=false,internalInput=false,composing=false,results=[],positionFrame=0;
  let selectedIds=new Set(),enabledTargets=new Set();
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(saved?.version===1&&Array.isArray(saved.items)){
      for(const item of saved.items.slice(0,MAX_TARGETS)){
        if(item&&typeof item.tpl==='string'&&index.byId.has(item.tpl))targets.set(item.tpl,item.enabled!==false);
      }
    }
  }catch{/* A blocked or invalid local store must not prevent filtering. */}
  function syncEnabledTargets(){enabledTargets=new Set([...targets].filter(([,enabled])=>enabled).map(([tpl])=>tpl));}
  syncEnabledTargets();

  const popup=document.createElement('div');
  popup.id=`itemSearchPopup-${++instanceCount}`;
  popup.className='item-search-popup';popup.hidden=true;
  popup.setAttribute('role','dialog');popup.setAttribute('aria-label','匹配物品与任务');
  const popupHead=document.createElement('div');popupHead.className='item-search-heading';
  const popupCount=document.createElement('span');popupCount.setAttribute('aria-live','polite');
  const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='item-search-close';closeButton.textContent='×';closeButton.setAttribute('aria-label','关闭搜索结果');
  popupHead.append(popupCount,closeButton);
  const resultList=document.createElement('div');resultList.className='item-search-results';
  popup.append(popupHead,resultList);document.body.append(popup);
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','dialog');input.setAttribute('aria-controls',popup.id);input.setAttribute('aria-expanded','false');input.autocomplete='off';

  const summary=document.createElement('summary');summary.append(document.createTextNode('目标物品列表'));
  const targetCount=document.createElement('small');summary.append(targetCount);
  const actions=document.createElement('div');actions.className='target-item-actions';
  const allButton=document.createElement('button');allButton.type='button';allButton.textContent='全选';
  const clearButton=document.createElement('button');clearButton.type='button';clearButton.textContent='清空';
  actions.append(allButton,clearButton);
  const targetList=document.createElement('div');targetList.className='target-item-list';
  const status=document.createElement('p');status.className='target-item-status';status.setAttribute('aria-live','polite');
  sectionHost.replaceChildren(summary,actions,targetList,status);

  function save(){
    try{
      if(targets.size)localStorage.setItem(storageKey,JSON.stringify({version:1,items:[...targets].map(([tpl,enabled])=>({tpl,enabled}))}));
      else localStorage.removeItem(storageKey);
    }catch{/* The current selection remains usable when storage is full or unavailable. */}
  }
  function makeIcon(tpl){
    const icon=document.createElement('span');icon.className='target-item-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=iconHtml(tpl);return icon;
  }
  function makeName(item,{english=false}={}){
    const text=document.createElement('span');text.className='target-item-copy';
    const name=document.createElement('strong');name.textContent=item.name||item.en||item.tpl;text.append(name);
    if(english&&item.en&&item.en!==item.name){const en=document.createElement('small');en.lang='en';en.textContent=item.en;text.append(en);}
    const count=document.createElement('small');count.className='target-item-point-count';count.textContent=`全图 ${item.count} 个点位`;text.append(count);
    return text;
  }
  function renderTargets(){
    syncEnabledTargets();
    const previousFocus=targetList.contains(document.activeElement)?{tpl:document.activeElement.dataset.tpl,action:document.activeElement.dataset.targetAction}:null;
    targetCount.textContent=targets.size?`${[...targets.values()].filter(Boolean).length} / ${targets.size}`:'';
    actions.hidden=!targets.size;allButton.disabled=![...targets.values()].some(enabled=>!enabled);
    const fragment=document.createDocumentFragment();
    for(const [tpl,enabled] of targets){
      const item=index.byId.get(tpl);if(!item)continue;
      const row=document.createElement('div');row.className='target-item-row';row.classList.toggle('is-disabled',!enabled);
      const label=document.createElement('label');label.className='target-item-toggle';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=enabled;checkbox.dataset.tpl=tpl;checkbox.dataset.targetAction='toggle';checkbox.setAttribute('aria-label',`筛选目标物品：${item.name||item.en||tpl}`);
      label.append(checkbox,makeIcon(tpl),makeName(item));
      const remove=document.createElement('button');remove.type='button';remove.className='target-item-remove';remove.textContent='×';remove.dataset.tpl=tpl;remove.dataset.targetAction='remove';remove.setAttribute('aria-label',`移除目标物品：${item.name||item.en||tpl}`);remove.title='移除';
      row.append(label,remove);fragment.append(row);
    }
    targetList.replaceChildren(fragment);
    status.textContent=!targets.size?'搜索物品后勾选添加':![...targets.values()].some(Boolean)?'未勾选目标物品':targets.size>=MAX_TARGETS?`最多添加 ${MAX_TARGETS} 件目标物品`:'';
    status.hidden=!status.textContent;
    if(previousFocus){
      const next=[...targetList.querySelectorAll('[data-target-action]')].find(element=>element.dataset.tpl===previousFocus.tpl&&element.dataset.targetAction===previousFocus.action);
      (next||summary).focus({preventScroll:true});
    }
  }
  function closePopup(){popup.hidden=true;input.setAttribute('aria-expanded','false');}
  function inputVisible(){
    const panel=input.closest('.floating-panel');
    return input.getClientRects().length>0&&!panel?.classList.contains('collapsed')&&!document.body.classList.contains('focus-map');
  }
  function positionPopup(){
    positionFrame=0;if(popup.hidden)return;
    if(!inputVisible()){closePopup();return;}
    const field=input.closest('.map-search-field')||input,rect=field.getBoundingClientRect(),viewport=window.visualViewport;
    // Leave the clear-search / ammunition shortcuts reachable while suggesting.
    const quick=input.closest('#filterPane')?.querySelector('.quick');
    const bottom=Math.max(rect.bottom,quick?.getBoundingClientRect().bottom||rect.bottom);
    const viewLeft=viewport?.offsetLeft||0,viewTop=viewport?.offsetTop||0,viewWidth=viewport?.width||window.innerWidth,viewHeight=viewport?.height||window.innerHeight;
    const margin=8,viewBottom=viewTop+viewHeight,width=Math.min(Math.max(rect.width,320),viewWidth-margin*2);
    const left=Math.max(viewLeft+margin,Math.min(rect.left,viewLeft+viewWidth-width-margin));
    const below=Math.max(0,viewBottom-bottom-margin-4),above=Math.max(0,rect.top-viewTop-margin-4),openAbove=below<150&&above>below;
    const height=Math.min(420,openAbove?above:below);
    if(height<60){closePopup();return;}
    popup.style.left=`${left}px`;popup.style.width=`${width}px`;popup.style.maxHeight=`${height}px`;
    popup.style.top=openAbove?`${Math.max(viewTop+margin,rect.top-4-Math.min(popup.scrollHeight,height))}px`:`${bottom+4}px`;
  }
  function schedulePosition(){if(!popup.hidden&&!positionFrame)positionFrame=requestAnimationFrame(positionPopup);}
  function renderSuggestions(){
    const query=input.value.trim();
    if(!query||composing||!inputVisible()){closePopup();return;}
    const result=index.search(query,{limit:30});results=result.items;
    const taskMatches=taskPoints?.search(query)||[];
    const words=query.normalize('NFKC').toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const typeMatches=(taskPoints?.types||[]).filter(t=>t.group!=='quest'&&words.every(word=>t.label.normalize('NFKC').toLocaleLowerCase().includes(word)));
    popupCount.textContent=`物品 ${result.total} · 类型 ${typeMatches.length} · 任务 ${taskMatches.length}`;
    const fragment=document.createDocumentFragment();
    for(const type of typeMatches){const label=document.createElement('label');label.className='search-type-option';const check=document.createElement('input');check.type='checkbox';check.checked=taskPoints.selected.has(type.key);check.dataset.searchType=type.key;check.setAttribute('aria-label',`点位类型：${type.label}`);const name=document.createElement('span');name.textContent=type.label;label.append(check,name);check.onchange=()=>taskPoints.setType(type.key,check.checked);fragment.append(label);}
    if(taskMatches.length){
      const heading=document.createElement('p');heading.className='task-point-search-note';heading.textContent='任务点位 · 勾选后显示，保留已有选择';
      const taskHost=document.createElement('div');taskHost.className='task-search-results';taskPoints.renderSearch(taskHost,taskMatches);fragment.append(heading,taskHost);
    }
    if(results.length&&taskMatches.length||result.total>results.length){const heading=document.createElement('p');heading.className='task-point-search-note';heading.textContent=result.total>results.length?`物品 · 显示前 ${results.length} 项`:'物品';fragment.append(heading);}
    for(const item of results){
      const row=document.createElement('div');row.className='item-search-row';
      const choice=document.createElement('button');choice.type='button';choice.className='item-search-choice';choice.dataset.itemId=item.tpl;choice.append(makeIcon(item.tpl),makeName(item,{english:true}));choice.setAttribute('aria-label',`添加目标物品：${item.name||item.en||item.tpl}`);
      const label=document.createElement('label');label.className='item-search-check';label.title='加入目标物品列表';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.itemId=item.tpl;checkbox.checked=targets.get(item.tpl)===true;checkbox.disabled=!targets.has(item.tpl)&&targets.size>=MAX_TARGETS;checkbox.setAttribute('aria-label',`目标物品：${item.name||item.en||item.tpl}`);
      label.append(checkbox);row.append(choice,label);fragment.append(row);
    }
    if(!results.length&&!taskMatches.length&&!typeMatches.length){const empty=document.createElement('p');empty.className='item-search-empty';empty.textContent='本地图无匹配物品、类型或任务目标';fragment.append(empty);}
    resultList.replaceChildren(fragment);resultList.scrollTop=0;popup.hidden=false;input.setAttribute('aria-expanded','true');positionPopup();
  }
  function dispatchInput(){internalInput=true;input.dispatchEvent(new Event('input',{bubbles:true}));internalInput=false;}
  function clearQuery(){itemId=null;exactSearch=false;selectedIds.clear();input.value='';closePopup();}
  function selectItem(tpl){
    const item=index.byId.get(tpl);if(!item)return;
    if(!targets.has(tpl)&&targets.size>=MAX_TARGETS)return;
    targets.set(tpl,true);clearQuery();sectionHost.open=true;changeTargets();input.focus({preventScroll:true});closePopup();
  }
  function changeTargets(){save();renderTargets();onChange();}
  input.addEventListener('input',()=>{if(internalInput)return;itemId=null;exactSearch=false;selectedIds.clear();renderSuggestions();});
  input.addEventListener('focus',()=>{if(!exactSearch)renderSuggestions();});
  input.addEventListener('click',renderSuggestions);
  input.addEventListener('compositionstart',()=>{composing=true;itemId=null;exactSearch=false;selectedIds.clear();closePopup();});
  input.addEventListener('compositionend',()=>{composing=false;renderSuggestions();});
  input.addEventListener('keydown',event=>{
    if(composing||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'&&!popup.hidden){event.preventDefault();event.stopImmediatePropagation();closePopup();return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    if(popup.hidden)renderSuggestions();
    const buttons=searchControls();if(popup.hidden||!buttons.length)return;
    event.preventDefault();buttons[event.key==='ArrowDown'?0:buttons.length-1].focus();
  });
  resultList.addEventListener('click',event=>{const button=event.target.closest('.item-search-choice');if(button)selectItem(button.dataset.itemId);});
  resultList.addEventListener('change',event=>{
    const checkbox=event.target.closest('input[type=checkbox]');if(!checkbox)return;
    const tpl=checkbox.dataset.itemId;if(!index.byId.has(tpl))return;
    if(!targets.has(tpl)&&targets.size>=MAX_TARGETS){checkbox.checked=false;return;}
    targets.set(tpl,checkbox.checked);clearQuery();sectionHost.open=true;save();renderTargets();input.focus({preventScroll:true});dispatchInput();onChange();
  });
  popup.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(composing||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePopup();input.focus({preventScroll:true});closePopup();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const buttons=searchControls();if(!buttons.length)return;
    const current=buttons.indexOf(event.target.closest('button,input'));
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    event.preventDefault();buttons[next].focus();
  });
  function searchControls(){return [...resultList.querySelectorAll('.item-search-choice,.item-search-check input,.search-type-option input,.task-point-toggle,input[data-task-parent],input[data-task-goal]')].filter(element=>element.getClientRects().length);}
  closeButton.addEventListener('click',()=>{closePopup();input.focus({preventScroll:true});closePopup();});
  targetList.addEventListener('change',event=>{const checkbox=event.target.closest('[data-target-action=toggle]');if(!checkbox||!targets.has(checkbox.dataset.tpl))return;targets.set(checkbox.dataset.tpl,checkbox.checked);changeTargets();});
  targetList.addEventListener('click',event=>{const button=event.target.closest('[data-target-action=remove]');if(!button)return;targets.delete(button.dataset.tpl);changeTargets();});
  allButton.addEventListener('click',()=>{for(const tpl of targets.keys())targets.set(tpl,true);changeTargets();});
  clearButton.addEventListener('click',()=>{targets.clear();changeTargets();});
  document.addEventListener('pointerdown',event=>{if(event.target!==input&&!popup.contains(event.target))closePopup();});
  document.addEventListener('focusin',event=>{if(event.target!==input&&!popup.contains(event.target))closePopup();});
  window.addEventListener('resize',schedulePosition);window.addEventListener('scroll',schedulePosition,true);
  window.visualViewport?.addEventListener('resize',schedulePosition);window.visualViewport?.addEventListener('scroll',schedulePosition);
  const visibilityObserver=new MutationObserver(()=>{if(!inputVisible())closePopup();else schedulePosition();});
  visibilityObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  const panel=input.closest('.floating-panel');if(panel)visibilityObserver.observe(panel,{attributes:true,attributeFilter:['class','hidden']});
  renderTargets();
  return {
    matches(point){
      return index.matches(point,enabledTargets);
    },
    query:()=>'',
    close:closePopup,
    selectAll(){for(const tpl of targets.keys())targets.set(tpl,true);changeTargets();},
    clearQuery,
    clearTargets(){targets.clear();changeTargets();},
    removeTarget(tpl){targets.delete(tpl);changeTargets();},
    reset(){clearQuery();targets.clear();save();renderTargets();onChange();},
    selection:()=>({itemId,exactSearch,itemIds:[...selectedIds],targets:[...targets].map(([tpl,enabled])=>({tpl,enabled}))}),
  };
}
