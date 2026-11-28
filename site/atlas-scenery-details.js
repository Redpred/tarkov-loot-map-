import {sha256} from './atlas-resource-cache.js';
import {readMapJson} from './atlas-resource-request.js';
import {mapLoadError} from './atlas-map-diagnostics.js';

export const SCENERY_DETAILS_KEY='atlas-scenery-details-v1';
export const validSceneryMode=value=>value==='simple'?'simple':'full';
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export function readSceneryMode(preferences=storage()){try{return validSceneryMode(preferences?.getItem(SCENERY_DETAILS_KEY));}catch{return 'full';}}
export function saveSceneryMode(value,preferences=storage()){try{if(!preferences)return false;preferences.setItem(SCENERY_DETAILS_KEY,validSceneryMode(value));return true;}catch{return false;}}
const fingerprint=value=>sha256(new TextEncoder().encode(JSON.stringify(value)));
export function sceneryEndpoint(endpoint,manifest){return manifest?.decorationFilter?.removedMeshes===0?endpoint.replace(/\/simple(?=\/|$)/,''):endpoint;}
export async function loadSceneryDetails(geometry,map,mode,{fetcher=globalThis.fetch}={}){
  const full={...geometry,scenery:'full'};
  if(validSceneryMode(mode)==='full')return full;
  try{
    const catalogUrl=`data/scenery-details/${map.id}/manifest.json`;
    const catalog=await readMapJson(catalogUrl,'装饰目录读取',{code:'SCENERY-CATALOG',fetcher,readError:true}),source=geometry.manifest,sourceSha=await fingerprint(source),variant=catalog?.variants?.[geometry.quality];
    if(catalog?.schemaVersion!==1||catalog.recipeVersion!==1||catalog.mapId!==map.id||catalog.sceneSha256!==source.sceneSha256||variant?.sourceManifestSha256!==sourceSha||variant.file!==`${geometry.quality}/manifest.json`)throw mapLoadError('SCENERY-CATALOG-VERSION', '装饰筛选版本不一致', {url:catalogUrl});
    const base=`/data/scenery-details/${map.id}/${geometry.quality}/`,url=base+'manifest.json';
    const manifest=await readMapJson(url,'装饰清单读取',{code:'SCENERY-MANIFEST',fetcher,readError:true});
    if(await fingerprint(manifest)!==variant.manifestSha256||manifest?.decorationFilter?.sourceManifestSha256!==sourceSha)throw mapLoadError('SCENERY-MANIFEST-HASH', '装饰筛选目录校验失败', {url});
    for(const key of ['bounds','materials','textures','sceneSha256','coordinateSystem','viewerTransform'])if(JSON.stringify(source[key])!==JSON.stringify(manifest[key]))throw mapLoadError('SCENERY-MANIFEST-ASSOCIATION', '场景关联数据不一致', {url});
    if(map.streamed){
      const originals=new Map(source.sectors.map(s=>[s.id,s])),seen=new Set();
      if(!manifest.sectors?.length)throw mapLoadError('SCENERY-MANIFEST-SECTORS', '场景分区为空', {url});
      for(const s of manifest.sectors){const original=originals.get(s.id);if(seen.has(s.id)||!original||s.file!==`sectors/${s.id}.json`||s.decorationFilter?.sourceGeometrySha256!==original.sha256||JSON.stringify(s.bounds)!==JSON.stringify(original.bounds))throw mapLoadError('SCENERY-MANIFEST-SECTORS', '场景分区不一致', {url});seen.add(s.id);}
    }else if(manifest.decorationFilter?.sourceGeometrySha256!==source.sha256)throw mapLoadError('SCENERY-MANIFEST-ASSOCIATION', '场景模型不一致', {url});
    return {...geometry,manifest,base,endpoint:`/${map.endpoint}${geometry.quality==='original'?'':'/'+geometry.quality}/simple`,runtime:variant.runtime,scenery:'simple',sceneryStats:variant.stats};
  }catch(error){return {...full,sceneryWarning:'装饰筛选暂不可用，本次保留完整场景。',sceneryReason:error.message,sceneryError:error};}
}
