import {ATLAS_MAPS} from './atlas-maps.js';
import {cacheOwner} from './atlas-cache-identity.js';
import {resourceCache} from './atlas-resource-cache.js';
import {DEFAULT_GEOMETRY_QUALITY} from './atlas-geometry-quality.js';
import {DEFAULT_TEXTURE_QUALITY} from './atlas-texture-quality.js';
import {readSceneryMode,sceneryEndpoint} from './atlas-scenery-details.js';

export const formatCacheBytes=bytes=>bytes>=2**30?`${(bytes/2**30).toFixed(2)} GiB`:`${(bytes/2**20).toFixed(1)} MiB`;
export const selectedCacheQuality=()=>({geometry:DEFAULT_GEOMETRY_QUALITY,texture:DEFAULT_TEXTURE_QUALITY,scenery:readSceneryMode()});
export const cacheQualityText=quality=>`装饰${quality.scenery==='simple'?'精简':'保留'}`;

export function makeMapCachePlan(map,geometry,texture,quality){
  const endpoint=`/${map.endpoint}${quality.geometry==='original'?'':'/'+quality.geometry}${quality.scenery==='simple'?'/simple':''}`;
  const models=(map.streamed?geometry.sectors:[geometry]).map(s=>[`geometry:${sceneryEndpoint(endpoint,s)}${map.streamed?'/'+s.id:''}`,s.sha256,s.stats.bytes]);
  const materialIds=map.streamed?[...new Set(geometry.sectors.flatMap(s=>s.materialIds))]:[...new Set(geometry.meshes.map(m=>m.material))];
  const names=new Set();
  for(const id of materialIds){const m=texture.materials[id];if(!m)continue;for(const name of [m.tex,m.emis,m.vp?.heights,...(m.vp?.layers||[]).map(l=>l.tex)])if(name&&texture.textures[name])names.add(name);}
  const textures=new Map();
  for(const name of names){
    const entry=texture.textures[name],file=entry.file.startsWith('/')?entry.file:'/'+map.textureBase+entry.file;
    textures.set(file,[`texture:${file}`,entry.sha256,entry.bytes]);
  }
  const plan={schemaVersion:1,mapId:map.id,quality,geometry:models,texture:[...textures.values()]};
  for(const kind of ['geometry','texture'])for(const [identity,version,bytes] of plan[kind]){
    const owner=cacheOwner(identity);
    if(owner.mapId!==map.id||owner.kind!==kind||owner.quality!==quality[kind]||!/^[a-f0-9]{64}$/.test(version)||!Number.isSafeInteger(bytes)||bytes<=0)throw new Error('缓存资源清单无效');
  }
  return plan;
}

export function summarizeMapCache(mapId,records,plan=null){
  const own=records.filter(row=>(row.mapId||cacheOwner(row.identity).mapId)===mapId);
  const out={mapId,bytes:0,count:own.length,kinds:{geometry:0,texture:0,auxiliary:0,partial:0},parts:{},state:own.length?'unknown':'empty',percent:0};
  for(const row of own){const owner=cacheOwner(row.identity);out.bytes+=row.bytes;out.kinds[owner.kind]+=row.bytes;}
  if(!plan)return out;
  const saved=new Map(own.map(row=>[row.identity+'|'+row.version,row]));let total=0,matched=0,missing=0;
  for(const kind of ['geometry','texture']){
    const part={count:0,total:plan[kind].length,bytes:0,totalBytes:0};
    for(const [identity,version,bytes] of plan[kind]){
      const row=saved.get(identity+'|'+version);part.totalBytes+=bytes;
      if(row?.version===version&&row.bytes===bytes){part.count++;part.bytes+=bytes;}else{
        missing++;
        if(kind==='geometry')for(let offset=0;offset<bytes;offset+=4*2**20){
          const length=Math.min(4*2**20,bytes-offset),partial=saved.get(`geometry-chunk:${identity.slice(9)}:${offset}:${length}|${version}`);
          if(partial?.bytes===length+64)part.bytes+=length;
        }
      }
    }
    total+=part.totalBytes;matched+=part.bytes;out.parts[kind]=part;
  }
  out.percent=total?Math.floor(matched/total*100):0;
  if(missing&&out.percent===100)out.percent=99;
  out.state=!missing&&total?'complete':matched?'partial':own.length?'other':'empty';
  return out;
}
export function mapCacheStatus(summary){
  return {empty:'未缓存',unknown:'已有缓存 · 版本待核对',other:'当前设置未缓存或需更新',complete:'已缓存完整',partial:`部分缓存 · ${summary.percent}%`}[summary.state];
}
export function mapCacheDetail(summary){
  const p=summary.parts;
  return p.geometry?`模型 ${p.geometry.count}/${p.geometry.total} · 贴图 ${p.texture.count}/${p.texture.total}`:'进入地图后自动缓存已访问区域';
}
// Metadata only. Visiting the directory must never start downloading models.
export function createMapCacheReader({cache=resourceCache,fetcher=globalThis.fetch,now=Date.now}={}){
  const plans=new Map();
  async function planFor(mapId,quality){
    const key=`${mapId}:${quality.geometry}:${quality.texture}:${quality.scenery||'full'}`,existing=plans.get(key);
    if(existing&&now()-existing.at<60000)return existing.promise;
    const promise=(async()=>{
      const response=await fetcher(`api/cache-plan/${mapId}?${new URLSearchParams(quality)}`,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('暂时无法核对资源版本');
      const value=await response.json();
      if(value.schemaVersion!==1||value.mapId!==mapId||value.quality?.geometry!==quality.geometry||value.quality?.texture!==quality.texture||(value.quality?.scenery||'full')!==(quality.scenery||'full')||!Array.isArray(value.geometry)||!Array.isArray(value.texture))throw Error('缓存清单无效');
      return value;
    })().catch(()=>null);
    plans.set(key,{at:now(),promise});return promise;
  }
  return {invalidate(){plans.clear();},async read(quality=selectedCacheQuality()){
    const inventory=await cache.inventory(),maps=Object.values(ATLAS_MAPS).map(map=>summarizeMapCache(map.id,inventory.records));
    // Limit parallel metadata requests; uncached maps need no server request.
    let next=0;
    await Promise.all(Array.from({length:2},async()=>{while(next<maps.length){const i=next++,item=maps[i];if(!item.count)continue;const plan=await planFor(item.mapId,quality);if(plan)maps[i]=summarizeMapCache(item.mapId,inventory.records,plan);}}));
    return {...inventory,quality,maps,bytes:inventory.records.reduce((n,r)=>n+r.bytes,0)};
  }};
}
