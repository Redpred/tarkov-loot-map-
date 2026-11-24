import {resourceCache} from './atlas-resource-cache.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {createMapCacheReader,cacheQualityText,formatCacheBytes} from './atlas-map-cache.js';
import {createMapCacheList} from './atlas-map-cache-ui.js';
import {createLocalResourceSettings} from './atlas-local-resources-ui.js';
import {createResourceLocationSettings} from './atlas-resource-location-ui.js';

export function createCacheSettings(dialog,map) {
  const field=document.createElement('fieldset');field.id='resourceCacheSettings';
  field.innerHTML=`<legend>资源保存与缓存</legend><details><summary>浏览器缓存（在线兼容）</summary>
    <label><input id="resourceCacheEnabled" type="checkbox"> 自动保存已访问的地图资源</label>
    <p id="resourceCacheUsage" class="hint" role="status">正在读取缓存…</p>
    <div class="view-actions"><button id="persistResourceCache" type="button">申请缓存保留保护</button><button id="clearResourceCache" type="button">清空全部地图缓存</button></div>
    <p class="hint">本站不设容量上限，不自动淘汰地图缓存。请按下方各地图的占用情况手动清理；关闭自动保存也会保留已有资源。</p>
    <p id="resourceCacheQuota" class="hint"></p>
    <p id="resourceCacheNotice" class="hint" role="status"></p>
    <p class="hint">浏览器仍有自身存储限制，也可能清理未受保护的站点数据。空间不足时保留已有缓存，新资源临时加载。完整缓存后仍需建立三维场景；清理不影响任务进度、自定义图标与区域名称。</p>
    <details><summary>本次加载详情</summary><p id="resourceCacheDiagnostics" class="hint"></p></details>
    <details class="map-cache-list" open><summary>各地图浏览器缓存</summary><p id="mapCacheQuality" class="hint"></p><p class="hint">这里只统计浏览器内的缓存，不包含自选目录。完成进度对应当前画质；占用包含其他画质、旧版本及续传数据。</p><div id="mapCacheRows"></div></details></details>`;
  dialog.querySelector('#streamSettings').after(field);
  const $=id=>field.querySelector('#'+id),format=formatCacheBytes,reader=createMapCacheReader(),local=createLocalResourceSettings(field,map),managed=createResourceLocationSettings(field,map);
  const mapList=createMapCacheList($('mapCacheRows'),{currentMap:map?.id,onClear:mapId=>action(async()=>{await resourceCache.clearMap(mapId);$('resourceCacheNotice').textContent=`${ATLAS_MAPS[mapId].name}的各档资源缓存已清理；其他地图保留。新加载的区域会重新保存。`;})});
  let timer,refreshing=false,busy=false,revision=0;
  async function refresh(){
    if(refreshing)return;refreshing=true;
    const stamp=revision;
    try{
      const [info,snapshot]=await Promise.all([resourceCache.stats(),reader.read()]);
      if(stamp!==revision)return;
      mapList.update(snapshot);$('mapCacheQuality').textContent=cacheQualityText(snapshot.quality);
      $('resourceCacheEnabled').checked=info.enabled;
      $('resourceCacheUsage').textContent=info.available?`已保存 ${format(info.bytes)} · ${info.count} 个资源 · 本次复用 ${format(info.hitBytes)}`:info.reason;
      $('resourceCacheQuota').textContent=info.quota?`浏览器估算的本站总配额 ${format(info.quota)} · 站点已用 ${format(info.originUsage||0)}（包括本站其他数据）`:'浏览器未提供可用空间估算';
      $('resourceCacheDiagnostics').textContent=`缓存命中 ${info.hitCount||0} 次 · 未命中 ${info.missCount||0} 次 · 读取失败 ${info.readFailures||0} 次 · 保存失败 ${info.writeFailures||0} 次；已续传 ${format(info.resumedBytes||0)}；在线读取 ${format(info.networkBytes||0)}（资源字节，可能由HTTP缓存提供，不等同于网络流量）。`;
      $('persistResourceCache').disabled=busy||!info.available||info.persistent||!navigator.storage?.persist;
      $('persistResourceCache').textContent=info.persistent?'已开启缓存保留保护':'申请缓存保留保护';
      $('clearResourceCache').disabled=busy||!info.available;
      if(info.reason&&info.available)$('resourceCacheNotice').textContent=info.reason;
      await local.refresh();
      await managed.refresh();
    }finally{refreshing=false;if(stamp!==revision&&dialog.open&&!busy)void refresh();}
  }
  async function action(fn){
    revision++;busy=true;mapList.setBusy(true);$('resourceCacheEnabled').disabled=true;$('clearResourceCache').disabled=true;$('persistResourceCache').disabled=true;
    try{await fn();}catch(error){$('resourceCacheNotice').textContent=error.message;}
    finally{busy=false;mapList.setBusy(false);$('resourceCacheEnabled').disabled=false;await refresh();}
  }
  $('resourceCacheEnabled').onchange=()=>action(async()=>{
    resourceCache.setEnabled($('resourceCacheEnabled').checked);
    $('resourceCacheNotice').textContent=$('resourceCacheEnabled').checked?'已开启自动保存，不设本站容量上限。':'已关闭自动保存，已有缓存保留。';
  });
  $('clearResourceCache').onclick=()=>action(async()=>{await resourceCache.clear();$('resourceCacheNotice').textContent='资源缓存已清空。新加载的区域会重新保存。';});
  $('persistResourceCache').onclick=()=>action(async()=>{
    const saved=await resourceCache.persist();
    $('resourceCacheNotice').textContent=saved?'已开启缓存保留保护，仍可手动清理。':'浏览器暂未批准保留保护。普通缓存仍可保存和复用，空间不足时可能被浏览器清理。';
  });
  dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;});
  return {open(){reader.invalidate();refresh();if(!timer)timer=setInterval(()=>{if(dialog.open&&!document.hidden&&!busy)refresh();else if(!dialog.open){clearInterval(timer);timer=null;}},5000);}};
}
