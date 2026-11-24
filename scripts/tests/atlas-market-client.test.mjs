import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketClient,itemPriceDisplay,traderAvatar} from '../../site/atlas-market-client.js';

test('dialog and point details coalesce concurrent loads and share the mode cache',async()=>{
  let calls=0,clock=0,finish;
  const client=createMarketClient({now:()=>clock,fetchImpl:async url=>{calls++;await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({schemaVersion:1,mode:new URL(url,'http://local').searchParams.get('mode'),items:{},traders:{},fetchedAt:'2026-10-16T00:00:00Z'})};}});
  const first=client.load('regular'),second=client.load('regular',{reload:true});assert.equal(calls,1);finish();assert.equal(await first,await second);
  assert.equal((await client.load('regular')).mode,'regular');assert.equal(calls,1);
  clock=60001;const expired=client.load('regular');finish();await expired;assert.equal(calls,2);
  const pve=client.load('pve');finish();assert.equal((await pve).mode,'pve');assert.equal(calls,3);
});
test('invalid modes and invalid responses are rejected; failed loads can retry',async()=>{
  let calls=0;const client=createMarketClient({fetchImpl:async()=>({ok:true,json:async()=>{calls++;return calls===1?{}:{schemaVersion:1,mode:'pve',items:{},traders:{},fetchedAt:'2026-10-16T00:00:00Z'};}})});
  await assert.rejects(client.load('bad'));assert.equal(calls,0);await assert.rejects(client.load('pve'));assert.equal((await client.load('pve')).mode,'pve');
});
test('compact point prices distinguish missing prices, no offers and flea restrictions',()=>{
  assert.deepEqual(itemPriceDisplay(null),{trader:'—',low:'—',average:'—',offers:'—'});
  const item={trader:{priceRUB:12000},fleaMin:15000,fleaAvg:16000,offers:0};
  assert.deepEqual(itemPriceDisplay(item),{trader:'12,000 ₽',low:'暂无报价',average:'16,000 ₽',offers:'0'});
  assert.equal(itemPriceDisplay({...item,fleaAllowed:false}).low,'不可上架');assert.equal(itemPriceDisplay({...item,fleaAllowed:false}).average,'—');
  assert.equal(traderAvatar('https://unknown/avatar.webp'),null);assert.equal(traderAvatar('data/tasks/assets/traders/123-abc.webp'),'data/tasks/assets/traders/123-abc.webp');
});
