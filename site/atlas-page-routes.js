import {ATLAS_MAPS} from './atlas-maps.js';

// Only the site's three public views participate; editors and reference viewers
// retain their normal navigation and do not inherit a live map session.
export function pageRoute(value,base){
  let url;try{url=new URL(value,base);}catch{return null;}
  const root=new URL('./',base);
  if(url.origin!==root.origin||url.host!==root.host||url.protocol!==root.protocol||!(['http:','https:'].includes(url.protocol)||(url.protocol==='tarkov:'&&url.host==='app')))return null;
  const file=url.pathname.slice(root.pathname.length);
  if(!url.pathname.startsWith(root.pathname)||file.includes('/'))return null;
  if(file===''||file==='index.html')return {kind:'home',url};
  if(file==='tasks.html')return {kind:'tasks',url};
  const id=file==='map.html'?url.searchParams.get('map'):file==='factory.html'?'factory':file==='streets.html'?'streets':null;
  return Object.hasOwn(ATLAS_MAPS,id)?{kind:'map',mapId:id,url}:null;
}

export function pageAction(value,{base,mapId}){
  const route=pageRoute(value,base);
  if(!route)return null;
  return {...route,action:route.kind!=='map'?'overlay':route.mapId===mapId?'resume':'navigate'};
}

export function plainPageClick(event,link){
  return Boolean(link)&&!event.defaultPrevented&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&
    !link.hasAttribute('download')&&(!link.target||link.target==='_self')&&!link.getAttribute('href')?.startsWith('#');
}
