import {readPagePreferences,savePagePreferences} from './atlas-page-session.js';

export const COMPACT_LAYOUT_QUERY='(max-width:750px), (max-width:1000px) and (max-height:500px)';

// A phone preference must never hide the desktop navigation or its focus targets.
export function bindCompactHeader({header,button,compact=window.matchMedia(COMPACT_LAYOUT_QUERY),storage=localStorage}){
  const key='atlas-mobile-header-collapsed-v1';let collapsed=false;
  try{collapsed=storage.getItem(key)==='true';}catch{}
  function update(){
    const hidden=compact.matches&&collapsed;
    if(hidden&&header.contains(document.activeElement))button.focus({preventScroll:true});
    header.hidden=header.inert=hidden;button.hidden=!compact.matches;
    header.setAttribute('aria-hidden',String(hidden));
    button.setAttribute('aria-expanded',String(!hidden));
    button.setAttribute('aria-label',hidden?'展开顶栏':'收起顶栏');
    document.body.classList.toggle('mobile-header-collapsed',hidden);
  }
  button.addEventListener('click',()=>{
    if(!compact.matches)return;
    collapsed=!collapsed;
    try{storage.setItem(key,String(collapsed));}catch{}
    update();
  });
  compact.addEventListener('change',update);update();
}

export function createFloatingLayout(map){
  const $=id=>document.getElementById(id),key=map+'-layout-v1',saved=readPagePreferences(key);
  const compact=window.matchMedia(COMPACT_LAYOUT_QUERY);
  const screenKey=name=>compact.matches?'compact:'+name:name;
  function remember(patch){Object.assign(saved,patch);savePagePreferences(key,patch);}
  function focus(force,store=true){
    const active=force??!document.body.classList.contains('focus-map');
    document.body.classList.toggle('focus-map',active);
    if(store)remember({[screenKey('focus')]:active});
  }
  function panel(side,open,store=false){
    const other=side==='left'?'right':'left';
    if(open){
      focus(false,false);
      if(compact.matches)panel(other,false);
    }
    const root=$(side+'Panel'),button=$(side+'PanelToggle');root.classList.toggle('collapsed',!open);
    $(side==='left'?'filterBody':'details').hidden=!open;
    button.setAttribute('aria-expanded',String(open));button.textContent=side==='left'?'点位筛选':'点位详情';
    button.title=(open?'收起':'展开')+button.textContent;
    button.setAttribute('aria-label',button.title);
    if(!open&&$(side==='left'?'filterBody':'details').contains(document.activeElement))document.activeElement.blur();
    document.body.classList.toggle(side+'-panel-closed',!open);
    if(store){
      const patch={[screenKey(side)]:open};
      if(open){patch[screenKey('focus')]=false;if(compact.matches)patch[screenKey(other)]=false;}
      remember(patch);
    }
  }
  for(const side of ['left','right']){
    $(side+'PanelToggle').onclick=()=>panel(side,$(side+'Panel').classList.contains('collapsed'),true);
  }
  function navigator(open,store=false){$('mapNavigator').classList.toggle('collapsed',!open);$('toggleNavigator').setAttribute('aria-expanded',String(open));$('toggleNavigator').textContent='全图导航'+(open?' −':' +');if(store)remember({[screenKey('navigator')]:open});}
  function restore(){
    const setting=(name,fallback)=>typeof saved[screenKey(name)]==='boolean'?saved[screenKey(name)]:fallback;
    panel('left',setting('left',!compact.matches));panel('right',setting('right',false));
    navigator(setting('navigator',!compact.matches));
    focus(setting('focus',false),false);
  }
  compact.addEventListener('change',restore);restore();
  $('toggleNavigator').onclick=()=>navigator($('mapNavigator').classList.contains('collapsed'),true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.querySelector('dialog[open]')||!compact.matches)return;
    for(const side of ['left','right'])if(!$(side+'Panel').classList.contains('collapsed'))panel(side,false,true);
  });
  function rememberSection(section,name=section.id,restore=true){
    let open=restore&&typeof saved[name]==='boolean'?saved[name]:section.open;
    section.open=open;
    section.addEventListener('toggle',()=>{
      if(!section.isConnected||open===section.open)return;
      open=section.open;remember({[name]:open});
    });
  }
  function foldout(button,content,name){
    const groupKey='group:'+name;
    function set(open){content.hidden=!open;button.setAttribute('aria-expanded',String(open));}
    set(saved[groupKey]===true);
    button.onclick=()=>{const open=content.hidden;set(open);remember({[groupKey]:open});};
  }
  return {openDetails:()=>panel('right',true),closeDetails:()=>panel('right',false),openFilters:store=>panel('left',true,store),closeFilters:()=>panel('left',false),focus,foldout,rememberSection};
}

// The software keyboard may resize only the visual viewport (iOS/Android).
// Move UI out of its way without changing the camera's full map viewport.
export function bindVisualViewport(){
  const viewport=window.visualViewport;
  function update(){
    document.body.style.setProperty('--app-height',`${window.innerHeight}px`);
    if(!viewport)return;
    const editing=document.activeElement?.matches('input:not([type=checkbox]):not([type=range]),textarea,[contenteditable=true]');
    const inset=viewport.scale===1?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
    const keyboard=Boolean(editing&&inset>120);
    document.body.classList.toggle('keyboard-open',keyboard);
    document.body.style.setProperty('--keyboard-inset',`${keyboard?inset:0}px`);
    document.body.style.setProperty('--visual-height',`${viewport.height}px`);
    document.body.style.setProperty('--visual-top',`${viewport.offsetTop}px`);
  }
  viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
  window.addEventListener('resize',update);
  for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,update);
  document.addEventListener('focusin',update);document.addEventListener('focusout',()=>requestAnimationFrame(update));update();
}

// Wheel events over the first-person canvas scroll the open details panel
// without moving focus away from movement controls. UI overlays scroll natively.
export function bindFirstPersonDetailsWheel({surface,details,isActive}){
  function onWheel(event){
    if(!isActive()||details.hidden||event.ctrlKey||!event.deltaY)return;
    event.preventDefault();event.stopPropagation();
    const unit=event.deltaMode===1?16:event.deltaMode===2?details.clientHeight:1;
    const max=Math.max(0,details.scrollHeight-details.clientHeight);
    details.scrollTop=Math.max(0,Math.min(max,details.scrollTop+event.deltaY*unit));
  }
  surface.addEventListener('wheel',onWheel,{capture:true,passive:false});
  return ()=>surface.removeEventListener('wheel',onWheel,{capture:true});
}
