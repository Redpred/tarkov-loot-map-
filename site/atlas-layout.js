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
  const $=id=>document.getElementById(id),key=map+'-layout-v1';let saved={};
  const compact=window.matchMedia(COMPACT_LAYOUT_QUERY);
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  if(typeof saved!=='object'||Array.isArray(saved))saved={};
  function save(){try{localStorage.setItem(key,JSON.stringify(saved));}catch{}}
  function panel(side,open,persist=true){
    if(open){
      document.body.classList.remove('focus-map');
      if(compact.matches){
        const other=side==='left'?'right':'left';
        panel(other,false,false);
      }
    }
    const root=$(side+'Panel'),button=$(side+'PanelToggle');root.classList.toggle('collapsed',!open);
    $(side==='left'?'filterBody':'details').hidden=!open;
    button.setAttribute('aria-expanded',String(open));button.textContent=side==='left'?'点位筛选':'点位详情';
    button.title=(open?'收起':'展开')+button.textContent;
    button.setAttribute('aria-label',button.title);
    if(!open&&$(side==='left'?'filterBody':'details').contains(document.activeElement))document.activeElement.blur();
    document.body.classList.toggle(side+'-panel-closed',!open);if(persist&&!compact.matches){saved[side]=open;save();}
  }
  for(const side of ['left','right']){
    panel(side,side==='right'||compact.matches?false:saved[side]??true,false);
    $(side+'PanelToggle').onclick=()=>panel(side,$(side+'Panel').classList.contains('collapsed'));
  }
  compact.addEventListener('change',event=>{
    panel('right',false,false);panel('left',event.matches?false:saved.left??true,false);
    navigator(event.matches?false:saved.navigator??true,false);
  });
  function navigator(open,persist=true){$('mapNavigator').classList.toggle('collapsed',!open);$('toggleNavigator').setAttribute('aria-expanded',String(open));$('toggleNavigator').textContent='全图导航'+(open?' −':' +');if(persist&&!compact.matches){saved.navigator=open;save();}}
  navigator(compact.matches?false:saved.navigator??true,false);$('toggleNavigator').onclick=()=>navigator($('mapNavigator').classList.contains('collapsed'));
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.querySelector('dialog[open]')||!compact.matches)return;
    for(const side of ['left','right'])panel(side,false,false);
  });
  for(const section of document.querySelectorAll('.filter-section')){
    section.open=typeof saved[section.id]==='boolean'?saved[section.id]:true;
    section.addEventListener('toggle',()=>{saved[section.id]=section.open;save();});
  }
  function foldout(button,content,name){
    const key='group:'+name;
    function set(open){content.hidden=!open;button.setAttribute('aria-expanded',String(open));saved[key]=open;save();}
    set(saved[key]===true);button.onclick=()=>set(content.hidden);
  }
  return {openDetails:()=>panel('right',true),closeDetails:()=>panel('right',false),openFilters:()=>panel('left',true),closeFilters:()=>panel('left',false),foldout};
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
