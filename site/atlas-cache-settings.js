import {resourceCache} from './atlas-resource-cache.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {createMapCacheReader,cacheQualityText,formatCacheBytes as format} from './atlas-map-cache.js';
import {createMapCacheList} from './atlas-map-cache-ui.js';
import {createResourceLocationSettings} from './atlas-resource-location-ui.js';

export function createCacheSettings(dialog,map){
  const pane=dialog.querySelector('#settings-resources');
  const location=document.createElement('fieldset');
  location.id='resourceLocationSettings';
  location.innerHTML='<legend>资源保存</legend>';
  const field=document.createElement('fieldset');
  field.id='browserCacheSettings';
  field.innerHTML=`<legend>浏览器缓存</legend>
    <div class="settings-inline">
      <p id="resourceCacheUsage" class="hint" role="status">正在读取缓存…</p>
      <button type="button" class="settings-info" data-settings-tip="resourceCacheHelp" aria-label="浏览器缓存详情" aria-describedby="resourceCacheHelp">?</button>
    </div>
    <label class="check"><input id="resourceCacheEnabled" type="checkbox" aria-describedby="resourceCacheHelp" disabled>自动缓存已访问的地图</label>
    <div class="view-actions">
      <button id="clearResourceCache" type="button" disabled>清空浏览器地图缓存</button>
      <button id="persistResourceCache" type="button" disabled>申请缓存保留保护</button>
    </div>
    <p id="resourceCacheNotice" class="hint" role="status"></p>
    <div id="resourceCacheHelp" hidden>
      <p>关闭自动缓存会保留已有缓存。缓存保留保护可减少浏览器自动清理的机会。</p>
      <p id="resourceCacheQuota"></p><p id="resourceCacheDiagnostics"></p>
    </div>
    <section class="settings-section" aria-labelledby="mapCacheTitle">
      <div class="settings-inline"><h3 id="mapCacheTitle">按地图查看与清理</h3><button type="button" class="settings-info" data-settings-tip="mapCacheHelp" aria-label="按地图清理说明" aria-describedby="mapCacheHelp">?</button></div>
      <div id="mapCacheHelp" hidden><p>清理只移除浏览器缓存中的地图资源。</p><p id="mapCacheQuality"></p></div>
      <div id="mapCacheRows" class="map-cache-rows"></div>
    </section>`;
  pane.querySelector('#streamSettings').after(location,field);
  const $=id=>field.querySelector('#'+id);
  const enabled=$('resourceCacheEnabled'),clear=$('clearResourceCache'),persist=$('persistResourceCache');
  const notice=$('resourceCacheNotice'),reader=createMapCacheReader();
  const managed=createResourceLocationSettings(location,map);
  const mapList=createMapCacheList($('mapCacheRows'),{currentMap:map?.id,onClear:mapId=>action(async()=>{
    await resourceCache.clearMap(mapId);
    notice.textContent=`已清理${ATLAS_MAPS[mapId].name}的浏览器缓存。`;
  })});
  const visible=()=>dialog.open&&!pane.hidden;
  let timer,active=false,reading=false,pending=false,busy=false,revision=0;

  async function refresh(){
    if(!visible()||busy)return;
    if(reading){pending=true;return;}
    reading=true;
    const stamp=revision;
    try{
      const info=await resourceCache.stats();
      if(stamp!==revision||!visible())return;
      enabled.checked=info.enabled;
      enabled.disabled=false;
      $('resourceCacheUsage').textContent=info.available?`已用 ${format(info.bytes)} · ${info.count} 项`:'浏览器缓存暂不可用。';
      $('resourceCacheQuota').textContent=info.quota?`本站已用 ${format(info.originUsage||0)} / 浏览器配额 ${format(info.quota)}`:'浏览器未提供存储空间估算。';
      $('resourceCacheDiagnostics').textContent=`本次复用 ${format(info.hitBytes)} · 续传 ${format(info.resumedBytes)} · 在线读取 ${format(info.networkBytes)} · 读写失败 ${(info.readFailures||0)+(info.writeFailures||0)} 次`;
      persist.disabled=!info.available||info.persistent||!navigator.storage?.persist;
      persist.textContent=info.persistent?'已开启缓存保留保护':'申请缓存保留保护';
      clear.disabled=!info.available||!info.count;
      if(info.reason)notice.textContent=info.reason;
      const snapshot=await reader.read();
      if(stamp!==revision||!visible())return;
      mapList.update(snapshot);
      $('mapCacheQuality').textContent=cacheQualityText(snapshot.quality);
    }finally{
      reading=false;
      if(pending){pending=false;void refresh();}
    }
  }
  async function action(fn){
    if(busy)return;
    revision++;
    busy=true;
    mapList.setBusy(true);
    enabled.disabled=clear.disabled=persist.disabled=true;
    try{await fn();}
    catch(error){notice.textContent=error.message;}
    finally{
      busy=false;
      mapList.setBusy(false);
      void refresh();
    }
  }
  enabled.onchange=()=>action(async()=>{
    resourceCache.setEnabled(enabled.checked);
    notice.textContent=enabled.checked?'已开启自动缓存。':'已关闭自动缓存，已有文件仍保留。';
  });
  clear.onclick=()=>action(async()=>{
    await resourceCache.clear();
    notice.textContent='已清空浏览器地图缓存。';
  });
  persist.onclick=()=>action(async()=>{
    const saved=await resourceCache.persist();
    notice.textContent=saved?'已开启缓存保留保护。':'浏览器暂未允许保留保护。';
  });

  function updateVisibility(){
    const next=visible();
    if(next===active)return;
    active=next;
    if(active){
      void managed.refresh();
      void refresh();
      timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);
    }else{
      clearInterval(timer);
    }
  }
  dialog.addEventListener('close',updateVisibility);
  return {updateVisibility,invalidate(){reader.invalidate();void refresh();}};
}
