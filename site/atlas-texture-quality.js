import {sha256} from './atlas-resource-cache.js';

export const TEXTURE_QUALITY_KEY='atlas-texture-quality-v1';
export const TEXTURE_QUALITIES={original:{label:'原画质 · 256 像素',maxSize:256},medium:{label:'均衡 · 128 像素',maxSize:128},low:{label:'低 · 64 像素',maxSize:64}};
export const validTextureQuality=value=>Object.hasOwn(TEXTURE_QUALITIES,value)?value:'medium';
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export function readTextureQuality(preferences=storage()){
  try{return validTextureQuality(preferences?.getItem(TEXTURE_QUALITY_KEY));}catch{return 'medium';}
}
export function saveTextureQuality(value,preferences=storage()){
  try{if(!preferences)return false;preferences.setItem(TEXTURE_QUALITY_KEY,validTextureQuality(value));return true;}catch{return false;}
}
// Bind to the complete active manifest, including local crops and texture hashes.
export const textureSourceVersion=manifest=>sha256(new TextEncoder().encode(JSON.stringify(manifest)));
export async function selectTextureManifest(manifest,catalog,mapId,quality){
  quality=validTextureQuality(quality);
  if(quality==='original')return manifest;
  if(catalog?.schemaVersion!==1||catalog.mapId!==mapId||catalog.sourceManifestSha256!==await textureSourceVersion(manifest))throw new Error('贴图版本与当前地图不一致');
  const entries=catalog.variants?.[quality]?.textures;
  if(!entries||Object.keys(entries).length!==Object.keys(manifest.textures).length)throw new Error('贴图目录不完整');
  const textures={};
  for(const [name,source] of Object.entries(manifest.textures)){
    const entry=entries[name],limit=TEXTURE_QUALITIES[quality].maxSize;
    if(!entry||entry.sourceSha256!==source.sha256||entry.colorSpace!==source.colorSpace||
      !new RegExp(`^${quality}/[a-f0-9]{64}\\.webp$`).test(entry.file)||
      !/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||
      !Array.isArray(entry.size)||entry.size.length!==2||entry.size.some((n,i)=>!Number.isInteger(n)||n<1||n>Math.min(limit,source.size[i])))throw new Error('贴图目录校验失败');
    textures[name]={...entry,file:`/data/model-quality/${mapId}/${entry.file}`};
  }
  return {...manifest,textures};
}
export async function loadTextureQuality(manifest,mapId,quality,{fetcher=globalThis.fetch}={}){
  quality=validTextureQuality(quality);
  if(quality==='original')return {manifest,quality};
  try{
    const response=await fetcher(`data/model-quality/${mapId}/manifest.json`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return {manifest:await selectTextureManifest(manifest,await response.json(),mapId,quality),quality};
  }catch(error){return {manifest,quality:'original',warning:'所选贴图暂不可用，本次使用原画质。',reason:error.message};}
}
