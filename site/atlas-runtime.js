import {resourceCache,sha256} from './atlas-resource-cache.js';
import {readMapResource} from './atlas-resource-request.js';
import {createItemIndex} from './atlas-item-index.js';
import {restoreTaskMapIndex} from './task-map-index.js';

export const RUNTIME_VERSION = 1;
export function runtimeInputs(map) {
  return [map.data,`data/${map.id}-pois.json`,`data/tasks/maps/${map.id}.json`,
    `data/${map.id}-regions.json`,'data/tasks/catalog.json'];
}
export function mergeMapData(loot,poi,quests) {
  const data={...loot,points:[...loot.points,...(poi?.points||[]),...(quests?.points||[])],
    items:{...quests?.items,...poi?.items,...loot.items}};
  if(poi)data.poiSources=poi;
  if(quests)data.questSources=quests;
  return data;
}
export async function readPreparedJson(info,identity,{fetcher=fetch,cache=resourceCache,signal}={}) {
  signal?.throwIfAborted();
  if(!info||!/^data\/runtime\/[a-f0-9]{64}\.json$/.test(info.file)||!info.file.includes(info.sha256))throw new Error('预计算资源地址无效');
  const ticket=cache.ticket(identity);
  async function parse(blob) {
    signal?.throwIfAborted();
    const bytes=await blob.arrayBuffer();
    signal?.throwIfAborted();
    if(bytes.byteLength!==info.bytes||await sha256(bytes)!==info.sha256)throw new Error('预计算资源校验失败');
    signal?.throwIfAborted();
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const stored=await cache.get(identity,info.sha256);
  if(stored){try{return await parse(stored);}catch{signal?.throwIfAborted();await cache.remove(identity,info.sha256);}}
  signal?.throwIfAborted();
  const blob=await readMapResource(info.file,'预计算资源读取',response=>response.blob(),{fetcher,signal,timeout:8000,retries:0});
  const value=await parse(blob);
  // Disk writes are useful for the next visit, but must not hold up the scene.
  void cache.put(identity,info.sha256,blob,ticket).catch(()=>{});
  return value;
}
export async function loadRuntimeDescriptor(mapId,{fetcher=fetch}={}) {
  try {
    const response=await fetcher(`api/runtime/${mapId}`,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)return null;
    const value=await response.json();
    return value.version===RUNTIME_VERSION&&value.mapId===mapId?value:null;
  }catch{return null;}
}
export async function loadPreparedMap(mapId,descriptor,options) {
  try {
    if(!descriptor?.map)return null;
    const value=await readPreparedJson(descriptor.map,`runtime:map:${mapId}`,options);
    if(value.version!==RUNTIME_VERSION||value.mapId!==mapId)throw new Error('地图预计算版本不符');
    const data=mergeMapData(value.loot,value.poi,value.quests);
    const itemIndex=createItemIndex(data,value.itemIndex),taskIndex=restoreTaskMapIndex(value.taskIndex,data,mapId);
    return {data,regions:value.regions,itemIndex,taskIndex};
  }catch{return null;}
}
export async function loadPreparedSpatial(mapId,key,manifest,descriptor,options) {
  try {
    const info=descriptor?.geometry?.[key];if(!info||info.geometrySha256!==manifest.sha256)return null;
    // Bind offsets, counts and order as well as the original geometry bytes.
    if(await sha256(new TextEncoder().encode(JSON.stringify(manifest)))!==info.manifestSha256)return null;
    const value=await readPreparedJson(info,`runtime:spatial:${mapId}:${key}`,options);
    if(value.version!==1||value.geometrySha256!==manifest.sha256||value.meshes?.length!==manifest.meshes.length)return null;
    return value;
  }catch{return null;}
}
