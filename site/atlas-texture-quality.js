import {sha256} from './atlas-resource-cache.js';
import {readMapJson} from './atlas-resource-request.js';
import {mapLoadError} from './atlas-map-diagnostics.js';

export const DEFAULT_TEXTURE_QUALITY='medium';
export const TEXTURE_QUALITIES={original:{maxSize:256},medium:{maxSize:128},low:{maxSize:64}};
const validTextureQuality=value=>Object.hasOwn(TEXTURE_QUALITIES,value)?value:DEFAULT_TEXTURE_QUALITY;
// Bind to the complete active manifest, including local crops and texture hashes.
export const textureSourceVersion=manifest=>sha256(new TextEncoder().encode(JSON.stringify(manifest)));
export async function selectTextureManifest(manifest,catalog,mapId,quality){
  quality=validTextureQuality(quality);
  if(quality==='original')return manifest;
  const url=`data/model-quality/${mapId}/manifest.json`;
  if(catalog?.schemaVersion!==1||catalog.mapId!==mapId||catalog.sourceManifestSha256!==await textureSourceVersion(manifest))throw mapLoadError('TEXTURE-CATALOG-VERSION', '贴图版本与当前地图不一致', {url});
  const entries=catalog.variants?.[quality]?.textures;
  if(!entries||Object.keys(entries).length!==Object.keys(manifest.textures).length)throw mapLoadError('TEXTURE-CATALOG-MISSING', '贴图目录不完整', {url});
  const textures={};
  for(const [name,source] of Object.entries(manifest.textures)){
    const entry=entries[name],limit=TEXTURE_QUALITIES[quality].maxSize;
    if(!entry||entry.sourceSha256!==source.sha256||entry.colorSpace!==source.colorSpace||
      !new RegExp(`^${quality}/[a-f0-9]{64}\\.webp$`).test(entry.file)||
      !/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||
      !Array.isArray(entry.size)||entry.size.length!==2||entry.size.some((n,i)=>!Number.isInteger(n)||n<1||n>Math.min(limit,source.size[i])))throw mapLoadError('TEXTURE-CATALOG-ENTRY', '贴图目录校验失败', {url});
    textures[name]={...entry,file:`/data/model-quality/${mapId}/${entry.file}`};
  }
  return {...manifest,textures};
}
export async function loadTextureQuality(manifest,mapId,quality,{fetcher=globalThis.fetch}={}){
  quality=validTextureQuality(quality);
  if(quality==='original')return {manifest,quality};
  try{
    const catalog=await readMapJson(`data/model-quality/${mapId}/manifest.json`,'贴图目录读取',{code:'TEXTURE-CATALOG',fetcher,readError:true});
    return {manifest:await selectTextureManifest(manifest,catalog,mapId,quality),quality};
  }catch(error){return {manifest,quality:'original',warning:'所选贴图暂不可用，本次使用原画质。',reason:error.message,error};}
}
