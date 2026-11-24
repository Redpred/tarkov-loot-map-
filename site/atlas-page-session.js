import {pageAction,pageRoute,plainPageClick} from './atlas-page-routes.js';

const SESSION='atlasLiveMapSession';
function parentSession(){
  try{return window.parent!==window?window.parent[SESSION]:null;}catch{return null;}
}

// Lightweight pages can run independently or inside a retained map. Navigation
// is owned by the map document so its WebGL context never leaves the DOM.
export function installPageBridge(){
  const session=parentSession();if(!session)return;
  const mapLink=document.querySelector('.app-nav [data-map-nav]');
  if(mapLink){mapLink.href=session.mapUrl;mapLink.hidden=false;}
  const taskLink=document.querySelector('.app-nav a[href="tasks.html"]');
  if(taskLink)taskLink.href=`tasks.html?map=${encodeURIComponent(session.mapId)}`;
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!plainPageClick(event,link))return;
    const route=pageRoute(link.href,location.href);if(!route)return;
    event.preventDefault();event.stopImmediatePropagation();session.navigate(link.href);
  },true);
  session.ready(window,location.href,document.title);
}

export function replacePageUrl(url){
  history.replaceState(null,'',url);
  parentSession()?.replace(window,location.href,document.title);
}

export function installMapSession({map,onSuspend,onResume,shouldReload=()=>false}){
  // The local crop editor also imports factory.js but is not a public map view.
  const base=location.href,initial=pageRoute(base,base);
  if(window.parent!==window||initial?.kind!=='map')return {get mapUrl(){return base;},waitUntilActive:()=>Promise.resolve()};
  const mapLink=document.querySelector('.app-nav [data-map-nav]');
  if(mapLink)mapLink.href=base;
  let mapUrl=base,frame=null,overlay=null,lastFocus=null,suspended=false;
  const mapTitle=document.title,waiters=new Set(),inertNodes=new Map();
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./atlas-page-session.css',import.meta.url);document.head.append(css);
  const marker={atlasLiveMap:map.id};
  history.replaceState({...history.state,...marker},'',base);

  function show(url){
    if(!suspended){
      suspended=true;lastFocus=document.activeElement;
      document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
      onSuspend();
      for(const node of document.body.children)if(node instanceof HTMLElement){inertNodes.set(node,node.inert);node.inert=true;}
      document.body.dataset.pageSuspended='';
    }
    overlay?.remove();
    overlay=document.createElement('section');overlay.id='atlasPageOverlay';
    frame=document.createElement('iframe');frame.id='atlasPageFrame';frame.title=url.pathname.endsWith('tasks.html')?'任务':'首页';
    // A fresh child document has no preceding child history entry. All later
    // routes use the parent's pushState, avoiding duplicate Back steps.
    frame.src=url.href;
    overlay.append(frame);document.body.append(overlay);
    frame.focus();document.title=`${frame.title} · 塔科夫物资地图`;
  }
  function resume(url){
    const routeChanged=url.href!==mapUrl;
    mapUrl=url.href;
    if(mapLink)mapLink.href=mapUrl;
    if(shouldReload()){location.reload();return;}
    const wasSuspended=suspended;suspended=false;
    overlay?.remove();overlay=frame=null;
    delete document.body.dataset.pageSuspended;
    for(const [node,inert] of inertNodes)node.inert=inert;inertNodes.clear();
    document.title=mapTitle;
    onResume(url,{routeChanged});
    for(const resolve of waiters)resolve();waiters.clear();
    if(wasSuspended&&lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  }
  function navigate(value,{pop=false}={}){
    const route=pageAction(value,{base,mapId:map.id});if(!route)return false;
    if(route.action==='navigate'){location.assign(route.url.href);return true;}
    if(!pop){
      if(route.url.href===location.href)return true;
      history.pushState(marker,'',route.url);
    }
    if(route.action==='resume')resume(route.url);else show(route.url);
    return true;
  }
  const session={mapId:map.id,mapName:map.name,get mapUrl(){return mapUrl;},navigate,
    ready(source,url,title){if(source!==frame?.contentWindow)return;this.replace(source,url,title);},
    replace(source,value,title){
      const route=pageRoute(value,base);if(source!==frame?.contentWindow||!route||route.kind==='map')return;
      history.replaceState(marker,'',route.url);document.title=title;
    },
    waitUntilActive(){return suspended?new Promise(resolve=>waiters.add(resolve)):Promise.resolve();}
  };
  window[SESSION]=session;
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!plainPageClick(event,link))return;
    // An ordinary map link without query actions returns to the retained URL.
    const route=pageRoute(link.href,base);
    if(route&&navigate(route.kind==='map'&&route.mapId===map.id&&!route.url.search&&!route.url.hash?mapUrl:link.href)){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  window.addEventListener('popstate',()=>navigate(location.href,{pop:true}));
  return session;
}
