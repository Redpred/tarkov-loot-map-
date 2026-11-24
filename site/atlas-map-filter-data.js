import {createPointFilter} from './factory-data.js';
import {pointIntersectsHeight} from './atlas-volumes.js';

// Exact search, saved targets and unit prices must match the SAME candidate.
// The point valuation remains based on its complete pool, never this subset.
export function createLootMatcher({data,index,types,query='',selection={},priceIds=null,pointMatches=()=>true}){
  const sets=[];
  if(selection.exactSearch)sets.push(new Set(selection.itemIds||[]));
  if(selection.targets?.length)sets.push(new Set(selection.targets.filter(t=>t.enabled).map(t=>t.tpl)));
  if(priceIds!==null)sets.push(priceIds);
  const q=query.trim().toLocaleLowerCase();
  const queryIds=q?new Set(Object.entries(data.items).filter(([id,it])=>`${id} ${it.zh} ${it.en}`.toLocaleLowerCase().includes(q)).map(([id])=>id)):null;
  const intersect=list=>list.length?new Set([...list.reduce((a,b)=>a.size<b.size?a:b)].filter(id=>list.every(set=>set.has(id)))):null;
  const ids=intersect(sets),searchedIds=q?intersect([...sets,queryIds]):ids;
  const plainQuery=createPointFilter(data,query);
  return point=>{
    if(!['loose','container'].includes(point.kind)||!types(point)||!pointMatches(point))return false;
    if(ids&&!index.matches(point,ids))return false;
    if(!q)return true;
    const container=data.items[point.containerTpl];
    if(`${point.sourceId} ${container?.zh||''} ${container?.en||''}`.toLocaleLowerCase().includes(q))return true;
    return sets.length?index.matches(point,searchedIds):plainQuery(point);
  };
}

export function filterMapPoints(points,{low=-Infinity,high=Infinity,loot,auxiliary,heightTest=pointIntersectsHeight}){
  const visible=[],lootIds=new Set(),auxIds=new Set();let overlap=0;
  for(const point of points){
    if(!point.position||point.outsideClientEnvelope||!heightTest(point,low,high))continue;
    const isLoot=loot(point),isAux=auxiliary(point);
    if(isLoot)lootIds.add(point.id);
    // Counts partition the visible union; one actual point is rendered once.
    if(isAux&&!isLoot)auxIds.add(point.id);if(isLoot&&isAux)overlap++;
    if(isLoot||isAux)visible.push(point);
  }
  return {visible,lootIds,auxIds,overlap};
}

export function filterModePoints(points,{mode,pointMatch,valueMatch,low,high,heightTest}){
  return filterMapPoints(points,{low,high,heightTest,
    loot:p=>mode==='value'?valueMatch(p):p.kind!=='poi'&&pointMatch(p),
    auxiliary:p=>mode!=='value'&&p.kind==='poi'&&pointMatch(p)});
}
