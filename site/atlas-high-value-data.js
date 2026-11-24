export const MARKET_MODES=[['regular','PvP 常规'],['pve','PvE'],['pvp-season','PvP 赛季']];
export const VALUE_BASES=[['best','最高可售价值'],['trader','商人收购价'],['fleaMin','跳蚤最低价'],['fleaAvg','跳蚤 24 小时均价']];
export const LOOT_POINT_KINDS=['container','loose'];
export function createHighValueDraft(value={}){
  const kinds=new Set((Array.isArray(value.kinds)?value.kinds:LOOT_POINT_KINDS).filter(kind=>LOOT_POINT_KINDS.includes(kind)));
  const excludedIds=new Set(Array.isArray(value.excludedIds)?value.excludedIds:[]);
  return {kinds,
    checked:tpl=>!excludedIds.has(tpl),
    setItem(tpl,checked){checked?excludedIds.delete(tpl):excludedIds.add(tpl);},
    selectAll(rows,checked){for(const row of rows)checked?excludedIds.delete(row.tpl):excludedIds.add(row.tpl);},
    selectedRows:rows=>rows.filter(row=>!excludedIds.has(row.tpl)),
    snapshot:()=>({kinds:[...kinds],excludedIds:[...excludedIds]})};
}
export function highValuePreferences(value){
  return {mode:MARKET_MODES.some(([id])=>id===value?.mode)?value.mode:'regular',
    basis:VALUE_BASES.some(([id])=>id===value?.basis)?value.basis:'best',
    minimum:typeof value?.minimum==='number'&&Number.isFinite(value.minimum)&&value.minimum>=0&&value.minimum<=1e12?Math.round(value.minimum):100000};
}
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;

export function itemMarketValue(item,basis='best'){
  if(!item)return 0;
  const trader=positive(item.trader?.priceRUB);
  const flea=item.fleaAllowed!==false&&item.offers!==0?positive(item.fleaMin):0;
  if(basis==='trader')return trader;
  if(basis==='fleaMin')return flea;
  if(basis==='fleaAvg')return item.fleaAllowed!==false?positive(item.fleaAvg):0;
  return Math.max(trader,flea);
}

export function valuableMapItems(index,market,minimum,basis='best'){
  const limit=Math.max(0,Number(minimum)||0);
  return index.items.map(item=>({...item,market:market.items[item.tpl],value:itemMarketValue(market.items[item.tpl],basis)}))
    .filter(item=>item.value>0&&item.value>=limit)
    .sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'zh-CN')||a.tpl.localeCompare(b.tpl));
}

// Search only changes visibility. The draft and confirmed IDs use the complete
// price-qualified list, including selected items hidden by the query.
export function searchValueItems(rows,query=''){
  const words=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if(!words.length)return rows;
  return rows.filter(item=>{const text=[item.name,item.en,item.tpl].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();return words.every(word=>text.includes(word));});
}

// Logarithmic movement makes 10,000–100,000 usable even when a rare key is worth
// millions. The neighbouring numeric input permits an exact ruble threshold.
export const priceToSlider=(value,max)=>Math.round(1000*Math.log1p(Math.max(0,value)/1000)/Math.log1p(Math.max(1000,max)/1000));
export const sliderToPrice=(step,max)=>Math.min(max,Math.round(1000*Math.expm1(Math.min(1000,Math.max(0,step))/1000*Math.log1p(Math.max(1000,max)/1000))/1000)*1000);

export function createHighValueSelection(index){
  let active=null;
  return {get active(){return Boolean(active);},
    apply({market,minimum,basis,kinds,excludedIds}){const draft=createHighValueDraft({kinds,excludedIds}),rows=draft.selectedRows(valuableMapItems(index,market,minimum,basis));active={mode:market.mode,minimum,basis,fetchedAt:market.fetchedAt,ids:new Set(rows.map(row=>row.tpl)),...draft.snapshot()};return rows;},
    cancel(){active=null;},
    matches(point){return Boolean(active&&active.kinds.includes(point.kind)&&index.matches(point,active.ids));},
    selection(){return active?{...active,ids:[...active.ids],kinds:[...active.kinds],excludedIds:[...active.excludedIds]}:null;}
  };
}
