import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {normalizeMarketPrices,createMarketPriceService} from '../lib/market-prices.mjs';
import {createSiteServer} from '../lib/site-server.mjs';

const id='5c0530ee86f774697952d952',traderA='54cb57776803fa99248b456e',traderB='5935c25fb3acc3127c3d8cd9';
const raw=(extra={})=>({data:{items:{[id]:{id,types:[],lastLowPrice:123000,avg24hPrice:150000,lastOfferCount:18,lastScan:'2026-10-15T16:00:00Z',sellToTrader:[{trader:traderA,price:50000,priceRUB:50000,currency:'RUB'},{trader:traderB,price:500,priceRUB:60000,currency:'USD'}],buyFromTrader:[{price:99999999}],...extra}}}});

test('purchase quotes choose lowest RUB equivalent, preserve unlocks and never reuse sell quotes or barter',()=>{
  const data=normalizeMarketPrices(raw({buyFromTrader:[
    {trader:traderA,price:25000,priceRUB:25000,currency:'RUB',minTraderLevel:1},
    {trader:traderB,price:180,priceRUB:23000,currency:'USD',minTraderLevel:3,taskUnlock:id,buyLimit:2},
    {trader:traderA,price:1,priceRUB:1,currency:'GP'},
    {trader:traderA,price:0,priceRUB:0,currency:'RUB'}
  ]}),'regular');
  assert.equal(data.purchaseSchemaVersion,1);
  assert.deepEqual(data.items[id].buyFromTrader,{traderId:traderB,price:180,priceRUB:23000,currency:'USD',minTraderLevel:3,taskUnlock:id,buyLimit:2});
  assert.equal(data.items[id].trader.priceRUB,60000);
  assert.equal(normalizeMarketPrices(raw(),'regular').items[id].buyFromTrader,null);
});

test('market normalization chooses the highest trader payout in rubles and retains all requested flea fields',()=>{
  const data=normalizeMarketPrices(raw(),'pve',{now:0,avatars:{[traderB]:{file:'data/tasks/assets/traders/59b91cbd86f77469aa5343cb-fc84ee3bc8.webp'}}});
  assert.deepEqual(data.items[id].trader,{traderId:traderB,price:500,currency:'USD',priceRUB:60000});
  assert.equal(data.items[id].fleaMin,123000);assert.equal(data.items[id].fleaAvg,150000);assert.equal(data.items[id].offers,18);
  assert.equal(data.traders[traderB].name,'Peacekeeper');assert.ok(data.traders[traderB].avatar);assert.equal(data.mode,'pve');
});
test('prohibited flea items, unknown values and unsafe portraits are never turned into invented sale data',()=>{
  const data=normalizeMarketPrices(raw({types:['noFlea'],lastOfferCount:-1}),'regular',{avatars:{[traderB]:{file:'https://evil.example/photo'}}});
  assert.equal(data.items[id].fleaAllowed,false);assert.equal(data.items[id].fleaMin,null);assert.equal(data.items[id].offers,null);assert.equal(data.traders[traderB].avatar,null);
  const unknown=normalizeMarketPrices(raw({lastLowPrice:0,avg24hPrice:'10000',lastOfferCount:null,sellToTrader:[]}),'regular');
  assert.equal(unknown.items[id].fleaMin,null);assert.equal(unknown.items[id].fleaAvg,null);assert.equal(unknown.items[id].offers,null);assert.equal(unknown.items[id].trader,null);
  assert.throws(()=>normalizeMarketPrices({data:{items:{}}},'regular'));
});
test('shared cache isolates modes, coalesces concurrent requests, backs off failures and expires stale data',async()=>{
  let clock=100000,calls=0,failing=false;
  const service=createMarketPriceService({now:()=>clock,ttl:100,maxStale:1000,retryDelay:100,fetchImpl:async url=>{
    calls++;await new Promise(resolve=>setImmediate(resolve));if(failing)throw Error('offline');
    return Response.json(raw({lastLowPrice:url.includes('/pve/')?500000:123000}));
  }});
  const [a,b]=await Promise.all([service.get('regular'),service.get('regular')]);
  assert.equal(calls,1);assert.equal(a.etag,b.etag);assert.equal(a.value.stale,false);
  const pve=await service.get('pve');assert.equal(pve.value.items[id].fleaMin,500000);assert.notEqual(a.etag,pve.etag);
  clock+=200;failing=true;const stale=await service.get('regular');assert.equal(stale.value.stale,true);assert.equal(stale.value.items[id].fleaMin,123000);
  const afterFailure=calls;await service.get('regular');assert.equal(calls,afterFailure);
  clock+=1200;await assert.rejects(service.get('regular'),/暂不可用/);await assert.rejects(service.get('../../file'),/模式无效/);
});
test('market HTTP endpoint supports mode allowlisting, gzip, ETag and HEAD without exposing arbitrary upstream requests',async t=>{
  const service=createMarketPriceService({fetchImpl:async()=>Response.json(raw())});
  const server=createSiteServer(new URL('../../site',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),{marketPrices:service});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/market-prices`;
  for(const query of ['', '?mode=unknown','?mode=regular&url=https://evil.example','?mode=regular&mode=pve']){
    const result=await fetch(base+query);assert.equal(result.status,400);await result.arrayBuffer();
  }
  const post=await fetch(base+'?mode=regular',{method:'POST'});assert.equal(post.status,405);await post.arrayBuffer();
  const response=await fetch(base+'?mode=pvp-season',{headers:{'accept-encoding':'gzip'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),'gzip');assert.equal((await response.json()).mode,'pvp-season');
  const cached=await fetch(base+'?mode=pvp-season',{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(cached.status,304);
  const head=await fetch(base+'?mode=pvp-season',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
});
