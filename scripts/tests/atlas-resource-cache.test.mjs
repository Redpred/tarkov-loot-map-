import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createResourceCache,loadCachedTexture,sha256} from '../../site/atlas-resource-cache.js';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';

function fixture(t,quota=2**30){
  const values=new Map(),indexedDB=new IDBFactory();
  const options={indexedDB,preferences:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},
    storage:{estimate:async()=>({quota,usage:0}),persisted:async()=>false,persist:async()=>false}};
  const caches=[];
  const create=()=>{const cache=createResourceCache(options);caches.push(cache);return cache;};
  t.after(async()=>{for(const cache of caches)await cache.close();});
  return {create,cache:create(),values};
}

test('verified model is reused across browser-cache instances; changed versions download independently',async t=>{
  const {cache,create}=fixture(t),original=globalThis.fetch;
  let source=Uint8Array.from({length:128},(_,i)=>i),calls=0;
  globalThis.fetch=async url=>{
    calls++;const params=new URL(url,'http://localhost/').searchParams,offset=Number(params.get('offset')),length=Number(params.get('length'));
    return Response.json({offset,total:source.length,encoding:'base64',data:Buffer.from(source.subarray(offset,offset+length)).toString('base64')});
  };
  t.after(()=>{globalThis.fetch=original;});
  const manifest=()=>sha256(source).then(sha256=>({sha256,stats:{bytes:source.length}}));
  const first=await manifest();
  assert.deepEqual(new Uint8Array(await loadFactoryGeometry(first,()=>{},'api/factory-geometry',undefined,cache)),source);
  assert.equal(calls,1);assert.equal((await cache.stats()).count,1);
  const reopened=create(),progress=[];
  await loadFactoryGeometry(first,(...args)=>progress.push(args),'api/factory-geometry',undefined,reopened);
  assert.equal(calls,1);assert.ok(progress.every(([, ,source])=>source==='cache'));
  source[0]=255;const second=await manifest();
  await loadFactoryGeometry(second,()=>{},'api/factory-geometry',undefined,reopened);
  assert.equal(calls,2);assert.equal((await cache.stats()).count,2);
  assert.equal((await cache.get('geometry:/api/factory-geometry',first.sha256)).size,128);

  await cache.put('geometry:/api/factory-geometry',second.sha256,new Blob([new Uint8Array(128)]));
  assert.deepEqual(new Uint8Array(await loadFactoryGeometry(second,()=>{},'api/factory-geometry',undefined,cache)),source);
  assert.equal(calls,3,'corrupt local model must be evicted and fetched once');
  const controller=new AbortController();controller.abort();
  await assert.rejects(loadFactoryGeometry(second,()=>{},'api/factory-geometry',controller.signal,cache),{name:'AbortError'});
  assert.equal(calls,3);
});

test('incomplete or corrupt downloads are never saved',async t=>{
  const {cache}=fixture(t),original=globalThis.fetch,source=new Uint8Array([1,2,3]);
  t.after(()=>{globalThis.fetch=original;});
  const manifest={stats:{bytes:3},sha256:await sha256(source)};
  globalThis.fetch=async()=>Response.json({offset:0,total:3,encoding:'base64',data:'AAAA'});
  await assert.rejects(loadFactoryGeometry(manifest,()=>{},'api/factory-geometry',undefined,cache),/完整性校验失败/);
  assert.equal((await cache.stats()).count,0);
  globalThis.fetch=async()=>Response.json({offset:0,total:3,encoding:'base64',data:'AA=='});
  await assert.rejects(loadFactoryGeometry(manifest,()=>{},'api/factory-geometry',undefined,cache),/长度不符/);
  assert.equal((await cache.stats()).count,0);
});

test('texture cache survives reopening, versions invalidate, failed decode retries and URLs are released',async t=>{
  const {cache,create}=fixture(t),original=globalThis.fetch;
  let source=new Uint8Array([1,2,3]),calls=0,decodeFailure=false;
  globalThis.fetch=async()=>{calls++;return new Response(source,{headers:{'content-type':'image/webp'}});};
  t.after(()=>{globalThis.fetch=original;});
  const urls=[],loader={loadAsync:async url=>{urls.push(url);if(decodeFailure){decodeFailure=false;throw new Error('bad image');}return {texture:true};}};
  let info={sha256:await sha256(source),bytes:3};
  await loadCachedTexture(loader,'data/atlas/textures/test.webp',info,cache);
  await loadCachedTexture(loader,'data/atlas/textures/test.webp',info,create());
  assert.equal(calls,1);assert.ok(urls.every(url=>url.startsWith('blob:')));
  await assert.rejects(original(urls[0]),/fetch failed/);
  decodeFailure=true;
  await loadCachedTexture(loader,'data/atlas/textures/test.webp',info,cache);assert.equal(calls,2);
  source[0]=9;info={...info,sha256:await sha256(source)};
  await loadCachedTexture(loader,'data/atlas/textures/test.webp',info,cache);assert.equal(calls,3);
  assert.equal((await cache.stats()).count,2);
});

test('cancelled texture decoding preserves valid disk cache and disposes the late GPU texture',async t=>{
  const {cache}=fixture(t),bytes=new Uint8Array([1,2,3]),info={sha256:await sha256(bytes),bytes:3},url='data/atlas/textures/cancel.webp';
  await cache.put('texture:/'+url,info.sha256,new Blob([bytes]));
  let started,finish,disposed=false,objectUrl;const decoding=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{finish=resolve;});
  const controller=new AbortController(),loader={loadAsync:async value=>{objectUrl=value;started();await pending;return {dispose(){disposed=true;}};}};
  const job=loadCachedTexture(loader,url,info,cache,controller.signal);await decoding;controller.abort();finish();
  await assert.rejects(job,{name:'AbortError'});assert.equal(disposed,true);assert.equal((await cache.get('texture:/'+url,info.sha256)).size,3);
  await assert.rejects(fetch(objectUrl),/fetch failed/);
});

test('cancelling a texture network request does not save incomplete data or start a replacement request',async t=>{
  const {cache}=fixture(t),previous=globalThis.fetch,controller=new AbortController(),info={sha256:await sha256(new Uint8Array([1])),bytes:1};
  let start;const started=new Promise(resolve=>{start=resolve;});let calls=0;
  globalThis.fetch=async(url,{signal})=>{calls++;start();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  t.after(()=>{globalThis.fetch=previous;});
  const job=loadCachedTexture({loadAsync(){throw Error('incomplete texture cannot decode');}},'data/atlas/textures/network.webp',info,cache,controller.signal);
  await started;controller.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(calls,1);assert.equal((await cache.stats()).count,0);
});

test('legacy capacity limits and low quota estimates never evict saved resources',async t=>{
  const {cache,values}=fixture(t,500),blob=new Blob([new Uint8Array(200)]);
  values.set('atlas-resource-cache-gib','16');
  await cache.put('old','v1',blob);
  await new Promise(r=>setTimeout(r,3));await cache.put('recent','v1',blob);
  await new Promise(r=>setTimeout(r,3));await cache.get('old','v1');
  await cache.put('new','v1',blob);
  assert.equal((await cache.get('recent','v1')).size,200);
  assert.equal((await cache.get('old','v1')).size,200);
  assert.equal((await cache.stats()).bytes,600);
  assert.equal((await cache.stats()).limitGiB,null);
  assert.equal(await cache.put('more','v1',new Blob([new Uint8Array(500)])),true);
});

test('quota failure preserves every existing resource and reports a manual-cleanup notice',async t=>{
  const {cache}=fixture(t);await cache.put('saved','v1',new Blob(['keep']));
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='data')throw new DOMException('full','QuotaExceededError');return original.call(this,value,...args);};
  t.after(()=>{IDBObjectStore.prototype.put=original;});
  assert.equal(await cache.put('new','v1',new Blob(['new'])),false);
  const stats=await cache.stats();assert.equal(stats.bytes,4);assert.equal(stats.count,1);assert.equal(stats.writeFailures,1);assert.match(stats.reason,/已有缓存保留/);
  assert.equal(await (await cache.get('saved','v1')).text(),'keep');
});

test('clear invalidates outstanding writes across tabs and preserves other preferences',async t=>{
  const {cache,create,values}=fixture(t),second=create(),blob=new Blob(['abc']);
  values.set('factory-marker-icons-v1','custom');
  const token=second.ticket();await cache.put('a','v1',blob);await cache.clear();
  assert.equal(await second.put('late','v1',blob,token),false);
  assert.equal((await second.stats()).count,0);assert.equal(values.get('factory-marker-icons-v1'),'custom');
  await cache.put('a','v1',blob);cache.setEnabled(false);
  assert.equal((await cache.stats()).count,1);assert.equal(await second.put('late','v1',blob),false);
  assert.equal(await (await second.get('a','v1')).text(),'abc');
  cache.setEnabled(true);assert.equal(await second.put('new','v1',blob),true);
});

test('model promotion is atomic: quota failure preserves chunks; success removes only matching partials',async t=>{
  const {cache}=fixture(t),identity='geometry:/api/factory-geometry',partial='geometry-chunk:/api/factory-geometry:0:4';
  await cache.put(partial,'v1',new Blob(['part']));await cache.put(partial,'old',new Blob(['older']));await cache.put('geometry:/api/woods-geometry/s_0_0','v1',new Blob(['woods']));
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='data'&&args[0]===identity+'|v1')throw new DOMException('full','QuotaExceededError');return original.call(this,value,...args);};
  t.after(()=>{IDBObjectStore.prototype.put=original;});
  assert.equal(await cache.put(identity,'v1',new Blob(['done']),cache.ticket(identity),[partial]),false);
  assert.equal(await (await cache.get(partial,'v1')).text(),'part');assert.equal((await cache.stats()).bytes,14);
  IDBObjectStore.prototype.put=original;
  assert.equal(await cache.put(identity,'v1',new Blob(['done']),cache.ticket(identity),[partial]),true);
  assert.equal(await cache.get(partial,'v1'),null);assert.equal(await (await cache.get(partial,'old')).text(),'older');assert.equal((await cache.stats()).bytes,14);assert.equal((await cache.stats()).count,3);
});

test('storage unavailability and write failures are safe cache misses',async()=>{
  const cache=createResourceCache({indexedDB:null,preferences:{getItem:()=>null}});
  assert.equal(await cache.get('x','v'),null);assert.equal(await cache.put('x','v',new Blob(['x'])),false);
  assert.equal((await cache.stats()).available,false);
  const denied=createResourceCache({indexedDB:{open(){throw new Error('blocked');}},preferences:{getItem(){throw new Error('blocked');}}});
  assert.equal(await denied.get('x','v'),null);assert.equal(await denied.put('x','v',new Blob(['x'])),false);
});

test('cache metadata upgrade preserves saved bytes and concurrent writes maintain exact totals',async t=>{
  const indexedDB=new IDBFactory(),dbName='upgrade-fixture';
  const old=await new Promise((resolve,reject)=>{
    const req=indexedDB.open(dbName,1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('meta',{keyPath:'key'});req.result.createObjectStore('data');};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=old.transaction(['meta','data'],'readwrite');
    tx.objectStore('meta').put({key:'legacy|v1',identity:'legacy',version:'v1',bytes:3,used:1});
    tx.objectStore('data').put(new Blob(['old']),'legacy|v1');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });old.close();
  const options={indexedDB,dbName,preferences:{getItem:()=>null}},a=createResourceCache(options),b=createResourceCache(options);
  t.after(async()=>{await a.close();await b.close();});
  assert.equal(await (await a.get('legacy','v1')).text(),'old');
  await Promise.all([a.put('model','v1',new Blob(['one'])),b.put('model','v2',new Blob(['two-two'])),a.put('texture','v1',new Blob(['tex']))]);
  const stats=await a.stats();assert.equal(stats.count,4);
  const versions=await Promise.all(['v1','v2'].map(v=>a.get('model',v)));
  assert.equal(versions.filter(Boolean).length,2);assert.equal(stats.bytes,16);
  await a.remove('legacy','v1');assert.equal((await b.stats()).count,3);
});

test('map clearing removes only that map across qualities and cancels its in-flight writes across tabs',async t=>{
  const {cache,create,values}=fixture(t),other=create(),blob=new Blob(['abc']);
  const factory='geometry:/api/factory-geometry/medium',woods='geometry:/api/woods-geometry/low/s_0_0';
  for(const key of [factory,'texture:/data/atlas/textures/test.webp','runtime:spatial:factory:whole',woods,'texture:/data/model-quality/woods/medium/test.webp'])await cache.put(key,'v1',blob);
  const factoryTicket=other.ticket(factory),woodsTicket=other.ticket(woods);
  values.set('task-progress','saved');await cache.clearMap('factory');
  assert.equal(await other.put(factory,'v1',blob,factoryTicket),false);
  assert.equal(await other.put(woods,'v1',blob,woodsTicket),true);
  assert.equal((await cache.stats()).count,2);assert.equal((await cache.stats()).bytes,6);
  const inventory=await other.inventory();assert.ok(inventory.records.every(row=>row.mapId==='woods'));
  assert.equal(values.get('task-progress'),'saved');assert.equal(await other.put(factory,'v1',blob),true);
  await assert.rejects(cache.clearMap('../woods'),/地图不存在/);
});

test('version 2 cache migration backfills map ownership without losing or duplicating bytes',async t=>{
  const indexedDB=new IDBFactory(),dbName='map-upgrade';
  const old=await new Promise((resolve,reject)=>{
    const req=indexedDB.open(dbName,2);
    req.onupgradeneeded=()=>{const meta=req.result.createObjectStore('meta',{keyPath:'key'});meta.createIndex('identity','identity');meta.createIndex('used','used');req.result.createObjectStore('data');req.result.createObjectStore('state');};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const identities=['geometry:/api/factory-geometry','texture:/data/atlas/woods/textures/a.webp','runtime:map:woods'];
  await new Promise((resolve,reject)=>{
    const tx=old.transaction(['meta','data','state'],'readwrite');
    for(const identity of identities){const key=identity+'|v';tx.objectStore('meta').put({key,identity,version:'v',bytes:3,used:1});tx.objectStore('data').put(new Blob(['abc']),key);}
    tx.objectStore('state').put({bytes:9,count:3},'usage');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });old.close();
  const cache=createResourceCache({indexedDB,dbName,preferences:{getItem:()=>null}});t.after(()=>cache.close());
  const rows=(await cache.inventory()).records;assert.deepEqual(rows.map(r=>r.mapId),['factory','woods','woods']);
  assert.equal((await cache.stats()).bytes,9);assert.equal(await (await cache.get(identities[0],'v')).text(),'abc');
  await cache.clearMap('woods');assert.equal((await cache.stats()).bytes,3);assert.equal((await cache.inventory()).records.length,1);
});

test('a transient database open failure is retried instead of disabling caching for the whole page',async t=>{
  const factory=new IDBFactory();let attempts=0;
  const cache=createResourceCache({indexedDB:{open(...args){if(!attempts++)throw Error('temporary failure');return factory.open(...args);}},preferences:{getItem:()=>null}});
  t.after(()=>cache.close());assert.equal((await cache.inventory()).available,false);
  assert.equal((await cache.inventory()).available,true);assert.equal(attempts,2);
});
