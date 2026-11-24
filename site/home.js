import {installPageBridge} from './atlas-page-session.js';
import {icon} from './ui-icons.js';
import {createMapCacheReader} from './atlas-map-cache.js';
import {updateHomeCache} from './atlas-map-cache-ui.js';
import {createViewSettingsUI} from './atlas-view-settings.js';
import {readHomeViewSettings,saveHomeViewSettings} from './atlas-view-preferences.js';
import {managedResources} from './atlas-managed-resources.js';
import {localResources} from './atlas-local-resources.js';
import {formatCacheBytes} from './atlas-map-cache.js';

installPageBridge();
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let refreshHomeCache=()=>{};
const settings=readHomeViewSettings();
const viewUI=createViewSettingsUI({home:true,settings,onChange:key=>{
  $('homeSettingsNotice').textContent=saveHomeViewSettings(settings,key)?'设置已保存，下次进入地图时生效。':'当前浏览器无法保存设置，请允许网站存储后重试。';
},onQualityApplied(){
  $('homeSettingsNotice').textContent='资源设置已保存，下次进入地图时生效。';refreshHomeCache();
}});
$('openHomeSettings').onclick=()=>viewUI.open();

function mapCard(map){
  const stats=map.stats||{},containers=(stats.containers||0)+(stats.clientOnlyContainers||0);
  const tag=map.ready?'a':'div';
  const preview=map.preview?`${map.preview.file}?v=${map.preview.sha256}`:'';
  return `<article class="map-card${map.ready?'':' pending'}">
    <${tag} ${map.ready?`href="${esc(map.href)}"`:''} class="map-card-link" aria-label="${esc(map.name)}${map.ready?'':'（准备中）'}" aria-describedby="cache-${esc(map.id)}">
      <div class="card-visual">${preview?`<img src="${esc(preview)}" alt="${esc(map.name)}全景俯视图" width="1440" height="960" loading="lazy" decoding="async">`:''}</div>
      <div class="card-content">
        <div class="card-title"><h2>${esc(map.name)}</h2>${map.ready?icon('arrow'):'<span class="card-status">准备中</span>'}</div>
        <div class="card-en">${esc(map.en)}</div>
        <div class="card-stats"><span><b>${(stats.loose||0).toLocaleString()}</b>散落</span><span><b>${containers.toLocaleString()}</b>容器</span><span><b>${map.quests||0}</b>任务</span></div>
        <div class="card-cache" id="cache-${esc(map.id)}" data-cache-map="${esc(map.id)}"><span class="card-cache-status">正在读取缓存…</span><span class="card-cache-size"></span><small class="card-cache-detail"></small></div>
      </div>
    </${tag}>
  </article>`;
}

try{
  const response=await fetch('data/atlas-catalog.json');
  if(!response.ok)throw new Error('地图加载失败，请刷新重试。');
  const {maps}=await response.json();
  if(!Array.isArray(maps)||!maps.length)throw new Error('暂无可用地图，请稍后重试。');
  $('maps').innerHTML=maps.map(mapCard).join('');
  const reader=createMapCacheReader();let refreshing=false,lastLocalScan=0,localMapInfo=[];
  const refresh=async()=>{if(refreshing||document.hidden)return;refreshing=true;try{
    updateHomeCache(await reader.read(),document);
    const info=await managedResources.stats();
    if(info.mode==='managed'){
      if(Date.now()-lastLocalScan>30000){localMapInfo=(await managedResources.stats({scan:true})).maps;lastLocalScan=Date.now();}
      for(const row of document.querySelectorAll('[data-cache-map]')){const map=localMapInfo.find(map=>map.mapId===row.dataset.cacheMap);
        row.querySelector('.card-cache-status').textContent=info.needsPermission?'本地目录需要授权':map?.bytes?'本地目录已有资源':'本地资源待下载';
        row.querySelector('.card-cache-size').textContent=map?.bytes?`已存 ${formatCacheBytes(map.bytes)}`:'';
        row.querySelector('.card-cache-detail').textContent='进入地图时校验并补充缺失资源';
      }
    }else if(info.mode==='client'){
      for(const row of document.querySelectorAll('[data-cache-map]')){row.querySelector('.card-cache-status').textContent='客户端本地资源';row.querySelector('.card-cache-size').textContent='';row.querySelector('.card-cache-detail').textContent='优先读取本地，缺失时下载';}
    }else if(info.mode==='manual'){
      const local=await localResources.stats();
      for(const row of document.querySelectorAll('[data-cache-map]')){const packs=local.packs.filter(pack=>pack.mapId===row.dataset.cacheMap);if(!packs.length)continue;
        row.querySelector('.card-cache-status').textContent=local.connected?'已关联只读资源包':'资源包需要重新授权';
        row.querySelector('.card-cache-size').textContent='';row.querySelector('.card-cache-detail').textContent='进入地图时核对版本与完整性';
      }
    }
  }finally{refreshing=false;}};
  refreshHomeCache=()=>{lastLocalScan=0;reader.invalidate();void refresh();};
  let timer;const resume=()=>{clearInterval(timer);reader.invalidate();void refresh();timer=setInterval(refresh,5000);};resume();
  window.addEventListener('pagehide',()=>clearInterval(timer));
  window.addEventListener('pageshow',resume);
  window.addEventListener('storage',event=>{if(event.key==='atlas-managed-directory-epoch'||event.key==='atlas-local-directory-epoch')refreshHomeCache();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){reader.invalidate();void refresh();}});
  document.getElementById('viewSettings').addEventListener('close',refreshHomeCache);
}catch(error){
  $('error').hidden=false;
  $('error').textContent=error instanceof TypeError?'地图加载失败，请检查网络后刷新。':error.message;
}finally{
  $('loading').hidden=true;
  $('maps').setAttribute('aria-busy','false');
}
