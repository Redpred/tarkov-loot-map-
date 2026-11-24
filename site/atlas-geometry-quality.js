import {sha256} from './atlas-resource-cache.js';

export const DEFAULT_GEOMETRY_QUALITY='low';
export const GEOMETRY_QUALITY_KEY='atlas-geometry-quality-v1';
export const GEOMETRY_QUALITIES={original:{label:'高 · 原始模型'},medium:{label:'均衡 · 适度简化'},low:{label:'低 · 更多简化'}};
export const validGeometryQuality=value=>Object.hasOwn(GEOMETRY_QUALITIES,value)?value:DEFAULT_GEOMETRY_QUALITY;
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export function readGeometryQuality(preferences=storage()){try{return validGeometryQuality(preferences?.getItem(GEOMETRY_QUALITY_KEY));}catch{return DEFAULT_GEOMETRY_QUALITY;}}
export function saveGeometryQuality(value,preferences=storage()){try{if(!preferences)return false;preferences.setItem(GEOMETRY_QUALITY_KEY,validGeometryQuality(value));return true;}catch{return false;}}
const fingerprint=manifest=>sha256(new TextEncoder().encode(JSON.stringify(manifest)));
export async function loadGeometryQuality(source,map,quality,{fetcher=globalThis.fetch}={}){
  quality=validGeometryQuality(quality);
  const original={manifest:source,quality:'original',base:map.textureBase,endpoint:map.endpoint,runtime:null};
  if(quality==='original')return original;
  try{
    const read=async url=>{const r=await fetcher(url);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
    const catalog=await read(`data/geometry-quality/${map.id}/manifest.json`),sourceSha=await fingerprint(source);
    if(catalog.schemaVersion!==1||catalog.mapId!==map.id||catalog.sourceManifestSha256!==sourceSha)throw Error('模型版本与当前地图不一致');
    const variant=catalog.variants?.[quality];
    if(variant?.file!==`${quality}/manifest.json`||!/^[a-f0-9]{64}$/.test(variant.manifestSha256))throw Error('模型目录无效');
    const base=`/data/geometry-quality/${map.id}/${quality}/`,manifest=await read(base+'manifest.json');
    if(await fingerprint(manifest)!==variant.manifestSha256||manifest.geometryQuality?.quality!==quality||manifest.geometryQuality.sourceManifestSha256!==sourceSha)throw Error('模型目录校验失败');
    for(const key of ['bounds','materials','textures','sceneSha256','coordinateSystem','viewerTransform'])if(JSON.stringify(source[key])!==JSON.stringify(manifest[key]))throw Error('模型关联数据不一致');
    if(map.streamed){
      if(manifest.sectors?.length!==source.sectors.length)throw Error('分区目录不完整');
      for(let i=0;i<source.sectors.length;i++){
        const a=source.sectors[i],b=manifest.sectors[i];
        if(a.id!==b.id||b.file!==`sectors/${a.id}.json`||JSON.stringify(a.bounds)!==JSON.stringify(b.bounds)||JSON.stringify(a.materialIds)!==JSON.stringify(b.materialIds))throw Error('模型分区不一致');
      }
    }
    return {manifest,quality,base,endpoint:`/api/${map.id}-geometry/${quality}`,runtime:variant.runtime};
  }catch(error){return {...original,warning:'所选模型暂不可用，本次使用原始模型。',reason:error.message};}
}
