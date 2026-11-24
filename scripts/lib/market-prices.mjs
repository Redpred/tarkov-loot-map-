import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

export const MARKET_MODES=['regular','pve','pvp-season'];
const idPattern=/^[a-f0-9]{24}$/;
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e12?value:null;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const traderNames={'54cb50c76803fa8b248b4571':'Prapor','54cb57776803fa99248b456e':'Therapist','579dc571d53a0658a154fbec':'Fence','58330581ace78e27b8b10cee':'Skier','5935c25fb3acc3127c3d8cd9':'Peacekeeper','5a7c2eca46aef81a7ca2145d':'Mechanic','5ac3b934156ae10c4430e83c':'Ragman','5c0647fdd443bc2504c2d371':'Jaeger','6617beeaa9cfa777ca915b7c':'Ref'};

// sellToTrader is the player's sale, not a trader's purchase offer (buyFromTrader).
// Compare priceRUB across currencies, while preserving the actual payout currency.
export function normalizeMarketPrices(raw,mode,{now=Date.now(),avatars={}}={}){
  if(!MARKET_MODES.includes(mode))throw new Error('不支持的游戏模式');
  const source=raw?.data?.items;
  if(!source||typeof source!=='object'||Array.isArray(source)||!Object.keys(source).length)throw new Error('价格来源格式无效');
  const items={},traders={};
  for(const item of Object.values(source)){
    if(!idPattern.test(item?.id||''))continue;
    let best=null;
    for(const offer of Array.isArray(item.sellToTrader)?item.sellToTrader:[]){
      if(!idPattern.test(offer.trader||''))continue;
      const rub=price(offer.priceRUB)??(offer.currency==='RUB'?price(offer.price):null);
      if(!rub||!price(offer.price)||!['RUB','USD','EUR'].includes(offer.currency))continue;
      if(!best||rub>best.priceRUB)best={traderId:offer.trader,price:offer.price,currency:offer.currency,priceRUB:rub};
    }
    let buy=null;
    for(const offer of Array.isArray(item.buyFromTrader)?item.buyFromTrader:[]){
      const rub=price(offer.priceRUB)??(offer.currency==='RUB'?price(offer.price):null);
      if(!idPattern.test(offer.trader||'')||!rub||!price(offer.price)||!['RUB','USD','EUR'].includes(offer.currency))continue;
      if(!buy||rub<buy.priceRUB)buy={traderId:offer.trader,price:offer.price,currency:offer.currency,priceRUB:rub,
        minTraderLevel:Number.isInteger(offer.minTraderLevel)&&offer.minTraderLevel>=1&&offer.minTraderLevel<=4?offer.minTraderLevel:null,
        taskUnlock:idPattern.test(offer.taskUnlock||'')?offer.taskUnlock:null,
        buyLimit:Number.isFinite(offer.buyLimit)&&offer.buyLimit>0?offer.buyLimit:null};
    }
    for(const quote of [best,buy].filter(Boolean)){
      const portrait=avatars[quote.traderId]?.file;
      traders[quote.traderId]={name:traderNames[quote.traderId]||'未知商人',avatar:/^data\/tasks\/assets\/traders\/[a-f0-9-]+\.webp$/.test(portrait||'')?portrait:null};
    }
    const fleaAllowed=raw.data.fleaMarket?.enabled!==false&&!item.types?.includes('noFlea');
    items[item.id]={trader:best,buyFromTrader:buy,fleaAllowed,fleaMin:fleaAllowed?price(item.lastLowPrice):null,
      fleaAvg:fleaAllowed?price(item.avg24hPrice):null,
      offers:fleaAllowed&&Number.isSafeInteger(item.lastOfferCount)&&item.lastOfferCount>=0?item.lastOfferCount:null,
      scannedAt:date(item.lastScan),updatedAt:date(item.updated)};
  }
  if(!Object.keys(items).length)throw new Error('价格来源没有有效物品');
  return {schemaVersion:1,purchaseSchemaVersion:1,mode,fetchedAt:new Date(now).toISOString(),source:`https://json.tarkov.dev/${mode}/items`,traders,items};
}

async function fetchSource(mode,fetchImpl){
  const response=await fetchImpl(`https://json.tarkov.dev/${mode}/items`,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('价格来源暂不可用');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>32*1024**2)throw new Error('价格响应过大');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMarketPriceService({seedDirectory,avatarManifest,fetchImpl=fetch,now=Date.now,ttl=5*60*1000,maxStale=24*60*60*1000,retryDelay=60*1000}={}){
  const cache=new Map();let queue=Promise.resolve(),avatars;
  async function getAvatars(){
    if(!avatars)avatars=avatarManifest?fs.readFile(avatarManifest,'utf8').then(JSON.parse).then(m=>m.traders||{}).catch(()=>({})):Promise.resolve({});
    return avatars;
  }
  async function seed(mode){
    if(!seedDirectory)return null;
    try{
      const value=JSON.parse(await fs.readFile(path.join(seedDirectory,mode+'.json'),'utf8'));
      if(value.schemaVersion!==1||value.mode!==mode||!date(value.fetchedAt)||!value.items||!Object.keys(value.items).length||!value.traders)return null;
      return value;
    }catch{return null;}
  }
  function pack(value,stale){
    const body=Buffer.from(JSON.stringify({...value,stale}));
    return {value:{...value,stale},body,gzip:gzipSync(body),etag:'"'+createHash('sha256').update(body).digest('hex')+'"'};
  }
  return {async get(mode){
    if(!MARKET_MODES.includes(mode)){const error=new Error('游戏模式无效');error.status=400;throw error;}
    if(!cache.has(mode))cache.set(mode,{loaded:seed(mode),value:null,pending:null,retryAt:0,packed:null});
    const entry=cache.get(mode);
    if(entry.loaded){entry.value=await entry.loaded;entry.loaded=null;}
    const age=()=>entry.value?Math.max(0,now()-Date.parse(entry.value.fetchedAt)):Infinity;
    if((age()>=ttl||entry.value?.purchaseSchemaVersion!==1)&&now()>=entry.retryAt&&!entry.pending){
      // Serialize upstream downloads so three different modes cannot multiply
      // the raw 17 MB dataset's temporary parsing cost on a small server.
      entry.pending=queue.catch(()=>{}).then(async()=>{
        try{entry.value=normalizeMarketPrices(await fetchSource(mode,fetchImpl),mode,{now:now(),avatars:await getAvatars()});entry.packed=null;entry.retryAt=0;}
        catch{entry.retryAt=now()+retryDelay;}
      }).finally(()=>{entry.pending=null;});
      queue=entry.pending;
    }
    if(entry.pending)await entry.pending;
    if(age()>maxStale){const error=new Error('价格服务暂不可用，请稍后重试');error.status=503;throw error;}
    const stale=age()>=ttl;
    if(!entry.packed||entry.packed.value.stale!==stale)entry.packed=pack(entry.value,stale);
    return entry.packed;
  }};
}
