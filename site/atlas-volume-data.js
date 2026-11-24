import {sha256} from './atlas-resource-cache.js';
import {validateVolume} from './atlas-volumes.js';

export const volumeSourceHash=source=>sha256(new TextEncoder().encode(JSON.stringify(source)));

async function readSidecar(url,fetcher,warn){
  try{
    const response=await fetcher(url,{cache:'no-cache',signal:AbortSignal.timeout(8000)});
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }catch(error){warn(`区域范围读取失败：${url}`,error);return null;}
}

function validHeader(sidecar,mapId,source){
  const mapping=value=>value&&typeof value==='object'&&!Array.isArray(value);
  return sidecar?.version===1&&sidecar.mapId===mapId&&Number.isInteger(sidecar.eftBuild)&&sidecar.eftBuild===source?.sources?.spt?.eftBuild&&mapping(sidecar.points)&&(!sidecar.regions||mapping(sidecar.regions));
}

function bind(entries,mapping,warn){
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))return 0;
  let count=0;
  for(const entry of entries||[]){
    if(!Object.hasOwn(mapping,entry.id))continue;
    const values=Array.isArray(mapping[entry.id])?mapping[entry.id]:[mapping[entry.id]];
    const volumes=values.map(validateVolume).filter(Boolean);
    if(volumes.length!==values.length)warn(`区域范围格式无效：${entry.id}`);
    if(volumes.length){entry.volumes=volumes;count++;}
  }
  return count;
}

// Runtime prepared maps and fallback JSON reads share the same source objects.
// Hash before attaching so neither generated indices nor source files change.
export async function attachMapVolumes({mapId,data,regions,geometrySha256,fetcher=fetch,warn=console.warn}){
  const sources=[data.poiSources,data.questSources];
  const urls=[`data/volumes/${mapId}.json`,`data/tasks/volumes/${mapId}.json`];
  const [sidecars,hashes,regionHash]=await Promise.all([
    Promise.all(urls.map(url=>readSidecar(url,fetcher,warn))),
    Promise.all(sources.map(source=>source?volumeSourceHash(source):null)),
    regions?volumeSourceHash(regions):null,
  ]);
  const result={points:0,regions:0};
  for(let i=0;i<sidecars.length;i++){
    const sidecar=sidecars[i];if(!sidecar)continue;
    if(!validHeader(sidecar,mapId,sources[i])||sidecar.baseSha256!==hashes[i]){warn(`区域范围版本或格式不匹配：${urls[i]}`);continue;}
    result.points+=bind(data.points.filter(point=>i===1?point.quest:point.kind==='poi'&&!point.quest),sidecar.points,warn);
    if(regions&&sidecar.regions&&Object.keys(sidecar.regions).length){
      if(sidecar.regionBaseSha256===regionHash&&/^[a-f0-9]{64}$/.test(sidecar.regionGeometrySha256||'')&&sidecar.regionGeometrySha256===geometrySha256)result.regions+=bind(regions.labels,sidecar.regions,warn);
      else warn(`建筑区域版本不匹配：${urls[i]}`);
    }
  }
  return result;
}
