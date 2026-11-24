// Store verified resource bytes, not Base64 responses or GPU objects. Metadata
// lives separately so the settings panel never reads every model.
import {cacheOwner} from './atlas-cache-identity.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {localResources} from './atlas-local-resources.js';
import {managedResources} from './atlas-managed-resources.js';
export const CACHE_DB = 'atlas-resources-v1';
const ENABLED_KEY = 'atlas-resource-cache-enabled-v2', EPOCH_KEY = 'atlas-resource-cache-epoch';
function browserPreferences() { try { return globalThis.localStorage; } catch { return undefined; } }
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
const complete = tx => {
  const done=new Promise((resolve, reject) => {
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('缓存事务中止'));
    tx.onerror = () => {}; // The abort event owns rejection.
  });
  // A failed request can throw before its caller reaches `await done`.
  done.catch(()=>{});return done;
};

export function createResourceCache({indexedDB = globalThis.indexedDB, storage = globalThis.navigator?.storage,
  preferences = browserPreferences(), dbName = CACHE_DB} = {}) {
  let opening, reason = '', generation = 0;
  const mapGenerations=new Map();
  const metrics = {hitBytes: 0, hitCount: 0, writeBytes: 0, missCount:0, writeFailures:0, readFailures:0, networkBytes:0, networkCount:0, resumedBytes:0};
  const preference = key => { try { return preferences?.getItem(key); } catch { return null; } };
  // Old capacity preferences no longer cause eviction. An explicitly disabled
  // legacy cache remains disabled; enabling never removes existing resources.
  function enabled() { return Boolean(indexedDB && (preference(ENABLED_KEY) ?? (preference('atlas-resource-cache-gib') === '0' ? 'false' : 'true')) !== 'false'); }
  const ticket = identity => {
    const mapId=cacheOwner(identity).mapId;
    return `${generation}:${preference(EPOCH_KEY)||''}:${mapGenerations.get(mapId)||0}:${preference(`${EPOCH_KEY}:${mapId}`)||''}`;
  };
  async function db() {
    if (!indexedDB) throw new Error('此浏览器无法使用本地资源缓存');
    if (!opening) {
      const pending = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 3);
      let expired=false;
      const timer = setTimeout(() => {expired=true;reject(new Error('本地缓存暂时不可用'));}, 3000);
      req.onupgradeneeded = () => {
        // A large existing cache can legitimately take longer than the open
        // timeout to migrate. Only metadata is touched, never resource bytes.
        clearTimeout(timer);
        const database=req.result,tx=req.transaction;
        const meta=database.objectStoreNames.contains('meta')?tx.objectStore('meta'):database.createObjectStore('meta',{keyPath:'key'});
        if(!database.objectStoreNames.contains('data'))database.createObjectStore('data');
        if(!meta.indexNames.contains('identity'))meta.createIndex('identity','identity');
        if(!meta.indexNames.contains('used'))meta.createIndex('used','used');
        if(!meta.indexNames.contains('mapId')){
          meta.createIndex('mapId','mapId');
          meta.getAll().onsuccess=event=>{for(const row of event.target.result)meta.put({...row,...cacheOwner(row.identity)});};
        }
        if(!database.objectStoreNames.contains('state')){
          const state=database.createObjectStore('state');
          // One-time migration of existing caches. Normal reads/writes use the
          // counters and indexes instead of scanning thousands of metadata rows.
          meta.getAll().onsuccess=event=>state.put({bytes:event.target.result.reduce((n,r)=>n+r.bytes,0),count:event.target.result.length},'usage');
        }
      };
      req.onsuccess = () => { clearTimeout(timer); if(expired){req.result.close();return;}req.result.onversionchange = () => {req.result.close();if(opening===pending)opening=null;}; resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
      });
      opening=pending;pending.catch(()=>{if(opening===pending)opening=null;});
    }
    return opening;
  }
  const keyFor = (identity, version) => `${identity}|${version}`;
  async function usage() {
    const tx = (await db()).transaction('state'), done = complete(tx);
    const value = await request(tx.objectStore('state').get('usage')); await done; return value || {bytes:0,count:0};
  }
  async function remove(identity, version) {
    try {
      const tx = (await db()).transaction(['meta', 'data','state'], 'readwrite'), done = complete(tx), key = keyFor(identity, version);
      const meta=tx.objectStore('meta'),state=tx.objectStore('state');
      meta.get(key).onsuccess=event=>{
        const row=event.target.result;if(!row)return;
        meta.delete(key);tx.objectStore('data').delete(key);
        state.get('usage').onsuccess=event=>{const totals=event.target.result;state.put({bytes:totals.bytes-row.bytes,count:totals.count-1},'usage');};
      };await done;
    } catch {}
  }
  async function get(identity, version) {
    try {
      const tx = (await db()).transaction(['meta', 'data']), done = complete(tx), key = keyFor(identity, version);
      const meta = tx.objectStore('meta'); let blob = null,invalid=false;
      meta.get(key).onsuccess = event => {
        const row = event.target.result; if (!row) return;
        tx.objectStore('data').get(key).onsuccess = event => {
          const value = event.target.result;
          if (value instanceof Blob && value.size === row.bytes) blob = value;
          else invalid=true;
        };
      };
      await done;
      if(invalid)await remove(identity,version);
      if (blob) { metrics.hitCount++; metrics.hitBytes += blob.size; } else metrics.missCount++;
      return blob;
    } catch (error) { metrics.readFailures++; reason = error.message; return null; }
  }
  async function put(identity, version, blob, startTicket = ticket(identity),replaceIdentities=[]) {
    if (!enabled() || startTicket !== ticket(identity)) return false;
    try {
      const tx=(await db()).transaction(['meta','data','state'],'readwrite'),done=complete(tx);
      const meta=tx.objectStore('meta'),data=tx.objectStore('data'),state=tx.objectStore('state'),key=keyFor(identity,version);
      let written=false,writeError;
      state.get('usage').onsuccess=event=>{
        const totals=event.target.result||{bytes:0,count:0};
        function commit(){meta.get(key).onsuccess=existing=>{
          if(!enabled()||startTicket!==ticket(identity)){tx.abort();return;}
          try{const old=existing.target.result;
            data.put(blob,key);meta.put({key,identity,version,bytes:blob.size,used:Date.now(),...cacheOwner(identity)});
            state.put({bytes:totals.bytes-(old?.bytes||0)+blob.size,count:totals.count+(old?0:1)},'usage');written=true;
          }catch(error){writeError=error;tx.abort();}
        };}
        // Promote completed models atomically: partial rows disappear only if
        // the full model commits. Quota/transaction failure restores them.
        const replacements=[...new Set(replaceIdentities)].filter(partial=>partial.startsWith('geometry-chunk:'+identity.slice(9)+':'));
        let remaining=replacements.length;
        if(!remaining)commit();
        for(const partial of replacements){const partialKey=keyFor(partial,version);meta.get(partialKey).onsuccess=found=>{
          const row=found.target.result;if(row){meta.delete(partialKey);data.delete(partialKey);totals.bytes-=row.bytes;totals.count--;}
          if(!--remaining)commit();
        };}
      };
      await done.catch(error=>{throw writeError||error;});
      if(written){metrics.writeBytes+=blob.size;reason='';}
      return written;
    } catch(error) {
      if(!enabled()||startTicket!==ticket(identity))return false;
      metrics.writeFailures++;
      reason=error.name==='QuotaExceededError'?'浏览器存储空间不足，新资源暂未保存。已有缓存保留，请按地图手动清理。':error.message;
      return false;
    }
  }
  async function clear() {
    generation++;
    try { preferences?.setItem(EPOCH_KEY, `${Date.now()}-${Math.random()}`); } catch {}
    const tx = (await db()).transaction(['meta', 'data','state'], 'readwrite'), done = complete(tx);
    tx.objectStore('meta').clear(); tx.objectStore('data').clear();tx.objectStore('state').put({bytes:0,count:0},'usage');await done;
    for(const key of Object.keys(metrics))metrics[key]=0; reason = '';
  }
  function setEnabled(value) {
    preferences?.setItem(ENABLED_KEY,String(Boolean(value)));
    if(!value){generation++;try{preferences?.setItem(EPOCH_KEY,`${Date.now()}-${Math.random()}`);}catch{}}
  }
  async function clearMap(mapId){
    if(!Object.hasOwn(ATLAS_MAPS,mapId))throw new Error('地图不存在');
    mapGenerations.set(mapId,(mapGenerations.get(mapId)||0)+1);
    try{preferences?.setItem(`${EPOCH_KEY}:${mapId}`,`${Date.now()}-${Math.random()}`);}catch{}
    const tx=(await db()).transaction(['meta','data','state'],'readwrite'),done=complete(tx);
    const meta=tx.objectStore('meta'),data=tx.objectStore('data'),state=tx.objectStore('state');
    state.get('usage').onsuccess=event=>{
      const totals=event.target.result||{bytes:0,count:0};
      meta.index('mapId').openCursor(mapId).onsuccess=event=>{
        const cursor=event.target.result;
        if(!cursor){state.put(totals,'usage');return;}
        totals.bytes-=cursor.value.bytes;totals.count--;data.delete(cursor.value.key);cursor.delete();cursor.continue();
      };
    };
    await done;
    reason='';
  }
  async function inventory(){
    try{
      const tx=(await db()).transaction('meta'),done=complete(tx);
      const records=await request(tx.objectStore('meta').getAll());await done;
      return {available:true,records};
    }catch(error){return {available:false,records:[],reason:error.message};}
  }
  async function stats() {
    try {
      const totals = await usage();
      let persistent=false,quota=null,originUsage=null;try{persistent=Boolean(await storage?.persisted?.());const estimate=await storage?.estimate?.();quota=estimate?.quota??null;originUsage=estimate?.usage??null;}catch{}
      return {available: true, bytes: totals.bytes, count: totals.count,
        limitGiB: null, enabled:enabled(), quota, originUsage, persistent, reason, ...metrics};
    } catch (error) { return {available: false, bytes: 0, count: 0, limitGiB: null, enabled:enabled(), reason: error.message, ...metrics}; }
  }
  return {get, put, remove, clear, clearMap, inventory, setEnabled, stats, ticket, enabled,
    recordFetch(bytes){metrics.networkBytes+=bytes;metrics.networkCount++;},
    recordResume(bytes){metrics.resumedBytes+=bytes;},
    async persist() { return Boolean(await storage?.persist?.()); },
    async close() { if (opening) (await opening).close(); }};
}

export const resourceCache = createResourceCache();
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

// Texture object URLs never reach download-manager extensions. The exported
// content hash changes even when a texture's source filename stays the same.
export async function loadCachedTexture(loader, url, info, cache = resourceCache, signal) {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(info.sha256 || '')) {
    const texture = await loader.loadAsync(url);
    if (signal?.aborted) { texture.dispose?.(); signal.throwIfAborted(); }
    return texture;
  }
  const identity = `texture:${new URL(url, globalThis.location?.href || 'http://localhost/').pathname}`;
  const external=cache===resourceCache&&managedResources.mode()!=='client'?await localResources.get(identity,info.sha256,info.bytes):null;
  if(cache===resourceCache&&managedResources.mode()==='managed')cache=managedResources.cache(cache,signal);
  if(cache===resourceCache&&managedResources.mode()==='client')cache=managedResources.clientCache;
  const startTicket = cache.ticket(identity);
  let blob = external || await cache.get(identity, info.sha256);
  signal?.throwIfAborted();
  async function decode(value) {
    const objectUrl = URL.createObjectURL(value);
    try {
      const texture = await loader.loadAsync(objectUrl);
      if (signal?.aborted) { texture.dispose?.(); signal.throwIfAborted(); }
      return texture;
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  if (blob) {
    try { return await decode(blob); } catch (error) { signal?.throwIfAborted(); if(!external)await cache.remove(identity, info.sha256); }
  }
  signal?.throwIfAborted();
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${info.sha256}`, {signal,cache:cache.managed?'no-store':'default',headers:cache.client?{'X-Tarkov-Storage':'client'}:{}});
  if (!response.ok) {const detail=cache.client?await response.json().catch(()=>null):null;throw new Error(detail?.error||`材质读取失败（HTTP ${response.status}）`);}
  blob = await response.blob();
  cache.recordFetch?.(blob.size);
  signal?.throwIfAborted();
  if ((info.bytes && blob.size !== info.bytes) || await sha256(await blob.arrayBuffer()) !== info.sha256) throw new Error('材质完整性校验失败，请刷新页面');
  signal?.throwIfAborted();
  const texture = await decode(blob);
  try{await cache.put(identity, info.sha256, blob, startTicket);}catch(error){texture.dispose?.();throw error;}
  if (signal?.aborted) { texture.dispose?.(); signal.throwIfAborted(); }
  return texture;
}
