import {MARKET_MODES} from './atlas-high-value-data.js';

export const marketModeName=id=>MARKET_MODES.find(([mode])=>mode===id)?.[1]||id;
export const marketMoney=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value).toLocaleString('zh-CN')+' ₽':'—';
export const marketTime=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'未知';
export const traderAvatar=value=>/^data\/tasks\/assets\/traders\/[a-f0-9-]+\.webp$/.test(value||'')?value:null;
export function itemPriceDisplay(item){
  return {trader:marketMoney(item?.trader?.priceRUB),
    low:item?.fleaAllowed===false?'不可上架':item?.offers===0?'暂无报价':marketMoney(item?.fleaMin),
    average:item?.fleaAllowed===false?'—':marketMoney(item?.fleaAvg),
    offers:item?.fleaAllowed===false||item?.offers==null?'—':item.offers.toLocaleString('zh-CN')};
}

// The dialog and point details share one small normalized response per mode.
// Loading starts on demand; switching points never requests individual items.
export function createMarketClient({fetchImpl=fetch,now=Date.now}={}){
  const cache=new Map(),pending=new Map();
  return {async load(mode,{reload=false}={}){
    if(!MARKET_MODES.some(([id])=>id===mode))throw new Error('未知价格模式');
    if(pending.has(mode))return pending.get(mode);
    const cached=cache.get(mode);if(!reload&&cached&&now()-cached.loadedAt<60000)return cached.data;
    const request=(async()=>{
      const response=await fetchImpl(`/api/market-prices?mode=${encodeURIComponent(mode)}`,{signal:AbortSignal.timeout(30000),cache:'no-cache'});
      if(!response.ok)throw new Error('价格获取失败');const data=await response.json();
      if(data.schemaVersion!==1||data.mode!==mode||!data.items||!data.traders||!Number.isFinite(Date.parse(data.fetchedAt)))throw new Error('价格格式无效');
      cache.set(mode,{data,loadedAt:now()});return data;
    })();
    pending.set(mode,request);try{return await request;}finally{pending.delete(mode);}
  }};
}
export const marketClient=createMarketClient();
