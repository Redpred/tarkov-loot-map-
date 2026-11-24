import {sha256} from './atlas-resource-cache.js';

export const SCENERY_DETAILS_KEY='atlas-scenery-details-v1';
export const validSceneryMode=value=>value==='simple'?'simple':'full';
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export function readSceneryMode(preferences=storage()){try{return validSceneryMode(preferences?.getItem(SCENERY_DETAILS_KEY));}catch{return 'full';}}
export function saveSceneryMode(value,preferences=storage()){try{if(!preferences)return false;preferences.setItem(SCENERY_DETAILS_KEY,validSceneryMode(value));return true;}catch{return false;}}
const fingerprint=value=>sha256(new TextEncoder().encode(JSON.stringify(value)));
export function sceneryEndpoint(endpoint,manifest){return manifest.decorationFilter?.removedMeshes===0?endpoint.replace(/\/simple(?=\/|$)/,''):endpoint;}
export async function loadSceneryDetails(geometry,map,mode,{fetcher=globalThis.fetch}={}){
  const full={...geometry,scenery:'full'};
  if(validSceneryMode(mode)==='full')return full;
  try{
    const read=async url=>{const r=await fetcher(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
    const catalog=await read(`data/scenery-details/${map.id}/manifest.json`),source=geometry.manifest,sourceSha=await fingerprint(source),variant=catalog.variants?.[geometry.quality];
    if(catalog.schemaVersion!==1||catalog.recipeVersion!==1||catalog.mapId!==map.id||catalog.sceneSha256!==source.sceneSha256||variant?.sourceManifestSha256!==sourceSha||variant.file!==`${geometry.quality}/manifest.json`)throw Error('装饰筛选版本不一致');
    const base=`/data/scenery-details/${map.id}/${geometry.quality}/`,manifest=await read(base+'manifest.json');
    if(await fingerprint(manifest)!==variant.manifestSha256||manifest.decorationFilter?.sourceManifestSha256!==sourceSha)throw Error('装饰筛选目录校验失败');
    for(const key of ['bounds','materials','textures','sceneSha256','coordinateSystem','viewerTransform'])if(JSON.stringify(source[key])!==JSON.stringify(manifest[key]))throw Error('场景关联数据不一致');
    if(map.streamed){
      const originals=new Map(source.sectors.map(s=>[s.id,s])),seen=new Set();
      if(!manifest.sectors?.length)throw Error('场景分区为空');
      for(const s of manifest.sectors){const original=originals.get(s.id);if(seen.has(s.id)||!original||s.file!==`sectors/${s.id}.json`||s.decorationFilter?.sourceGeometrySha256!==original.sha256||JSON.stringify(s.bounds)!==JSON.stringify(original.bounds))throw Error('场景分区不一致');seen.add(s.id);}
    }else if(manifest.decorationFilter?.sourceGeometrySha256!==source.sha256)throw Error('场景模型不一致');
    return {...geometry,manifest,base,endpoint:`/${map.endpoint}${geometry.quality==='original'?'':'/'+geometry.quality}/simple`,runtime:variant.runtime,scenery:'simple',sceneryStats:variant.stats};
  }catch(error){return {...full,sceneryWarning:'装饰筛选暂不可用，本次保留完整场景。',sceneryReason:error.message};}
}
