import {ATLAS_MAPS} from './atlas-maps.js';
import {cacheQualityLabel,formatCacheBytes,mapCacheStatus,mapCacheDetail} from './atlas-map-cache.js';

export function createMapCacheList(container,{currentMap,onClear}){
  const maps=Object.values(ATLAS_MAPS).sort((a,b)=>Number(b.id===currentMap)-Number(a.id===currentMap)),rows=new Map();
  for(const map of maps){
    const row=document.createElement('article');row.className='map-cache-row';row.dataset.mapCache=map.id;
    row.innerHTML=`<div class="map-cache-heading"><strong>${map.name}${map.id===currentMap?' · 当前地图':''}</strong><button type="button" aria-label="清理${map.name}的资源缓存" disabled>清理</button></div><p class="map-cache-status">正在读取…</p><progress max="100" value="0" aria-label="${map.name}当前设置缓存进度" hidden></progress><p class="map-cache-detail"></p><p class="map-cache-breakdown"></p>`;
    row.querySelector('button').onclick=()=>onClear(map.id);container.append(row);rows.set(map.id,row);
  }
  let last,busy=false;
  function update(snapshot){
    last=snapshot;
    for(const info of snapshot.maps){
      const row=rows.get(info.mapId);if(!row)continue;
      row.querySelector('button').disabled=busy||!snapshot.available||!info.count;
      row.querySelector('.map-cache-status').textContent=snapshot.available?`${mapCacheStatus(info)} · 共 ${formatCacheBytes(info.bytes)}`:'浏览器缓存不可用';
      const progress=row.querySelector('progress');progress.hidden=!info.parts.geometry;progress.value=info.percent;
      row.querySelector('.map-cache-detail').textContent=snapshot.available?mapCacheDetail(info):(snapshot.reason||'');
      const tiers=Object.entries(info.tiers).map(([tier,bytes])=>`${cacheQualityLabel(tier)}档 ${formatCacheBytes(bytes)}`);
      row.querySelector('.map-cache-breakdown').textContent=info.count?`模型 ${formatCacheBytes(info.kinds.geometry)} · 贴图 ${formatCacheBytes(info.kinds.texture)} · 辅助数据 ${formatCacheBytes(info.kinds.auxiliary)}${info.kinds.partial?' · 续传分块 '+formatCacheBytes(info.kinds.partial):''}${tiers.length?'；'+tiers.join(' / '):''}`:'';
    }
  }
  return {update,setBusy(value){busy=value;if(last)update(last);}};
}

export function updateHomeCache(snapshot,root){
  for(const info of snapshot.maps){
    const row=root.querySelector(`[data-cache-map="${info.mapId}"]`);if(!row)continue;
    row.dataset.state=info.state;
    row.querySelector('.card-cache-status').textContent=snapshot.available?mapCacheStatus(info):'缓存不可用';
    row.querySelector('.card-cache-size').textContent=info.count?`已存 ${formatCacheBytes(info.bytes)}`:'';
    row.querySelector('.card-cache-detail').textContent=!snapshot.available?'可刷新页面重试':info.count?mapCacheDetail(info):'访问后自动缓存';
  }
}
