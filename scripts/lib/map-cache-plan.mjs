import path from 'node:path';
import fs from 'node:fs/promises';
import {makeMapCachePlan} from '../../site/atlas-map-cache.js';
import {loadGeometryQuality} from '../../site/atlas-geometry-quality.js';
import {loadTextureQuality} from '../../site/atlas-texture-quality.js';
import {loadSceneryDetails} from '../../site/atlas-scenery-details.js';

// Revalidate small file stamps, then reuse the plan. A directory refresh must
// not repeatedly parse/hash whole material manifests on the live server.
export function createMapCachePlanReader(root,readManifest){
  const entries=new Map();
  return async(map,quality)=>{
    const files=[map.geometry];
    if(quality.geometry!=='original')files.push(`data/geometry-quality/${map.id}/manifest.json`,`data/geometry-quality/${map.id}/${quality.geometry}/manifest.json`);
    if(quality.texture!=='original')files.push(`data/model-quality/${map.id}/manifest.json`);
    if(quality.scenery==='simple')files.push(`data/scenery-details/${map.id}/manifest.json`,`data/scenery-details/${map.id}/${quality.geometry}/manifest.json`);
    const signature=(await Promise.all(files.map(async file=>{const s=await fs.stat(path.join(root,file));return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}))).join('|');
    // Keep legacy responses without a scenery field intact even after an
    // explicit full-scene request populated the cache.
    const key=`${map.id}:${quality.geometry}:${quality.texture}:${quality.scenery??'legacy'}`,old=entries.get(key);
    if(old?.signature===signature)return old.promise;
    const promise=readMapCachePlan(root,map,quality,readManifest);entries.delete(key);entries.set(key,{signature,promise});
    if(entries.size>52)entries.delete(entries.keys().next().value);
    try{return await promise;}catch(error){if(entries.get(key)?.promise===promise)entries.delete(key);throw error;}
  };
}

export async function readMapCachePlan(root,map,quality,readManifest){
  const source=await readManifest(path.join(root,map.geometry));
  const fetcher=async file=>{
    // These paths are produced exclusively by the quality selectors.
    const target=path.resolve(root,String(file).replace(/^\//,''));
    if(!target.startsWith(root+path.sep))throw Error('Invalid manifest path');
    return {ok:true,json:()=>readManifest(target)};
  };
  const [geometry,texture]=await Promise.all([loadGeometryQuality(source,map,quality.geometry,{fetcher}),loadTextureQuality(source,map.id,quality.texture,{fetcher})]);
  if(geometry.quality!==quality.geometry||texture.quality!==quality.texture)throw Error('所选档位资源暂不可用');
  const scenery=await loadSceneryDetails(geometry,map,quality.scenery,{fetcher});
  if(scenery.scenery!==(quality.scenery||'full'))throw Error('所选场景资源暂不可用');
  return makeMapCachePlan(map,scenery.manifest,texture.manifest,quality);
}
