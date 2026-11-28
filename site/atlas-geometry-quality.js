import {sha256} from './atlas-resource-cache.js';
import {readMapJson} from './atlas-resource-request.js';
import {mapLoadError} from './atlas-map-diagnostics.js';

export const DEFAULT_GEOMETRY_QUALITY='low';
const GEOMETRY_QUALITIES=['original','medium','low'];
const fingerprint=manifest=>sha256(new TextEncoder().encode(JSON.stringify(manifest)));
export async function loadGeometryQuality(source,map,quality,{fetcher=globalThis.fetch}={}){
  if(!GEOMETRY_QUALITIES.includes(quality))quality=DEFAULT_GEOMETRY_QUALITY;
  const original={manifest:source,quality:'original',base:map.textureBase,endpoint:map.endpoint,runtime:null};
  if(quality==='original')return original;
  try{
    const catalogUrl=`data/geometry-quality/${map.id}/manifest.json`;
    const catalog=await readMapJson(catalogUrl,'模型目录读取',{code:'MODEL-CATALOG',fetcher,readError:true}),sourceSha=await fingerprint(source);
    if(catalog?.schemaVersion!==1||catalog.mapId!==map.id||catalog.sourceManifestSha256!==sourceSha)throw mapLoadError('MODEL-CATALOG-VERSION', '模型版本与当前地图不一致', {url:catalogUrl});
    const variant=catalog.variants?.[quality];
    if(variant?.file!==`${quality}/manifest.json`||!/^[a-f0-9]{64}$/.test(variant.manifestSha256))throw mapLoadError('MODEL-CATALOG-FORMAT', '模型目录无效', {url:catalogUrl});
    const base=`/data/geometry-quality/${map.id}/${quality}/`,url=base+'manifest.json';
    const manifest=await readMapJson(url,'模型清单读取',{code:'MODEL-MANIFEST',fetcher,readError:true});
    if(await fingerprint(manifest)!==variant.manifestSha256||manifest?.geometryQuality?.quality!==quality||manifest.geometryQuality.sourceManifestSha256!==sourceSha)throw mapLoadError('MODEL-MANIFEST-HASH', '模型目录校验失败', {url});
    for(const key of ['bounds','materials','textures','sceneSha256','coordinateSystem','viewerTransform'])if(JSON.stringify(source[key])!==JSON.stringify(manifest[key]))throw mapLoadError('MODEL-MANIFEST-ASSOCIATION', '模型关联数据不一致', {url});
    if(map.streamed){
      if(!Array.isArray(source.sectors)||manifest.sectors?.length!==source.sectors.length)throw mapLoadError('MODEL-MANIFEST-SECTORS', '分区目录不完整', {url});
      for(let i=0;i<source.sectors.length;i++){
        const a=source.sectors[i],b=manifest.sectors[i];
        if(a.id!==b?.id||b.file!==`sectors/${a.id}.json`||JSON.stringify(a.bounds)!==JSON.stringify(b.bounds)||JSON.stringify(a.materialIds)!==JSON.stringify(b.materialIds))throw mapLoadError('MODEL-MANIFEST-SECTORS', '模型分区不一致', {url});
      }
    }
    return {manifest,quality,base,endpoint:`/api/${map.id}-geometry/${quality}`,runtime:variant.runtime};
  }catch(error){return {...original,warning:'所选模型暂不可用，本次使用原始模型。',reason:error.message,error};}
}
