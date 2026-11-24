import {managedResources,MANAGED_DIRECTORY} from './atlas-managed-resources.js';
import {localResources} from './atlas-local-resources.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {formatCacheBytes,cacheQualityText} from './atlas-map-cache.js';

const supported=()=>typeof globalThis.showDirectoryPicker==='function'&&globalThis.isSecureContext;
export async function clientResourceLocation(action){
  if(action){const bridge=globalThis.tarkovDesktop||window.top.tarkovDesktop;const result=await bridge.action(action);if(result===false)return null;}
  const response=await fetch('/api/client-resources',{cache:'no-store'});if(!response.ok)throw Error('无法读取客户端资源位置');return response.json();
}
export async function chooseClientResourceLocation(){const info=await clientResourceLocation('choose-resources');if(info)managedResources.setMode('client');return info;}
let activePrompt;
export function showResourceLocation({map,plan,recovery=false,message=''}={}){
  if(activePrompt)return activePrompt;
  activePrompt=new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='resource-location-dialog';
    dialog.setAttribute('aria-label',recovery?'恢复本地资源访问':'选择资源保存位置');
    dialog.innerHTML=`<h2>${recovery?'恢复本地资源访问':'选择资源保存位置'}</h2>
      <p data-location-description></p><p data-location-size class="hint"></p>
      <p class="hint">推荐选择一个本地位置。网站在其中创建 ${MANAGED_DIRECTORY} 专用子文件夹，按地图分类保存；以后先校验并读取已有文件，只补充缺失资源。</p>
      <p class="hint">需要目录读写授权。不设网站容量上限，不自动删除文件。清理时可在设置中查看各地图的目录与占用，自行删除。</p>
      <p data-location-status role="status"></p>
      <div class="resource-location-actions"><button type="button" data-location-client hidden>使用客户端资源目录</button><button type="button" data-location-choose>选择资源保存位置</button><button type="button" data-location-authorize hidden>重新授权并继续</button><button type="button" data-location-retry hidden>已处理，重试</button></div>
      <details><summary>其他使用方式</summary><p class="hint">在线模式使用浏览器缓存；已有解压资源包可只读关联。之后可在设置中更改。</p>
      <div class="resource-location-actions"><button type="button" data-location-online>使用在线模式</button><button type="button" data-location-manual>选择已解压资源包</button></div></details>
      <input type="file" webkitdirectory multiple hidden data-location-files>`;
    document.body.append(dialog);const $=selector=>dialog.querySelector(selector);let busy=false;
    $('[data-location-description]').textContent=recovery?'资源读写已暂停。已保存的文件会保留，处理后可继续。':`${map?.name||'地图'}的资源将保存在哪里？`;
    $('[data-location-size]').textContent=plan?`${cacheQualityText(plan.quality)} · 当前画质整图资源约 ${formatCacheBytes([...plan.geometry,...plan.texture].reduce((n,row)=>n+row[2],0))}。按需要逐步下载，不会一次下载全部地图。`:'';
    $('[data-location-status]').textContent=message||(!supported()?'当前浏览器无法自动保存到自选目录，请使用下方兼容入口。':'');
    $('[data-location-choose]').hidden=!supported();
    if(!supported()||recovery)dialog.querySelector('details').open=true;
    const finish=()=>{dialog.close();dialog.remove();activePrompt=null;resolve();};
    async function action(fn){if(busy)return;busy=true;for(const b of dialog.querySelectorAll('button'))b.disabled=true;
      try{await fn();finish();}catch(error){if(error.name!=='AbortError')$('[data-location-status]').textContent=error.message;}
      finally{busy=false;for(const b of dialog.querySelectorAll('button'))b.disabled=false;}
    }
    $('[data-location-client]').hidden=!managedResources.client;
    $('[data-location-client]').onclick=()=>action(async()=>{const info=await clientResourceLocation();if(!info.available)throw Error(info.error);managedResources.setMode('client');});
    $('[data-location-choose]').onclick=()=>action(()=>managedResources.client?chooseClientResourceLocation().then(info=>{if(!info)throw new DOMException('已取消','AbortError');}):managedResources.choose());
    $('[data-location-authorize]').onclick=()=>action(async()=>{await managedResources.authorize();if(managedResources.mode()!=='managed')managedResources.setMode('managed');});
    $('[data-location-retry]').hidden=!recovery;
    $('[data-location-retry]').onclick=()=>action(async()=>{const state=await managedResources.stats();if(state.needsPermission)throw Error('请点击重新授权，或重新选择目录');});
    $('[data-location-online]').onclick=()=>action(()=>managedResources.setMode('online'));
    $('[data-location-manual]').onclick=()=>{if(globalThis.showDirectoryPicker)void action(async()=>{await localResources.choose();managedResources.setMode('manual');});else $('[data-location-files]').click();};
    $('[data-location-files]').onchange=event=>action(async()=>{await localResources.importFiles(event.target.files);managedResources.setMode('manual');});
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy){if(managedResources.client){$('[data-location-status]').textContent='请选择本地资源位置，或在其他使用方式中手动切换模式。';return;}managedResources.setMode('online');finish();}});
    void managedResources.stats().then(info=>{$('[data-location-authorize]').hidden=!info.needsPermission||!info.name||!supported();});
    dialog.showModal();
  });return activePrompt;
}
managedResources.setRecoveryHandler(message=>showResourceLocation({recovery:true,message}));

export async function prepareResourceLocation(map,plan,geometry){
  await managedResources.register(plan);
  for(const model of map.streamed?geometry.sectors:[geometry]){
    const filter=model.decorationFilter;if(filter?.removedMeshes>0){
      const identity=plan.geometry.find(row=>row[1]===model.sha256)?.[0]?.replace(/\/simple(?=\/|$)/,'');
      if(identity)managedResources.addSource(identity,filter.sourceGeometrySha256,filter.sourceBytes);
    }
  }
  const state=await managedResources.stats();
  if(!state.mode||(state.mode==='managed'&&(!state.connected||!supported())))await showResourceLocation({map,plan,message:state.reason});
  if(managedResources.mode()==='manual'){
    const local=await localResources.stats();
    if(!local.connected)await showResourceLocation({map,plan,message:'请重新选择已解压资源包，或切换其他使用方式。'});
  }
  await managedResources.prepare();
}

export function createResourceLocationSettings(field,map){
  const panel=document.createElement('section');panel.className='resource-location-settings';
  panel.innerHTML=`<h3>资源保存位置</h3><p data-managed-status class="hint" role="status"></p>
    <div class="view-actions"><button type="button" data-managed-downloads hidden>下载地图</button><button type="button" data-managed-client hidden>使用客户端资源目录</button><button type="button" data-managed-folder hidden>打开资源文件夹</button><button type="button" data-managed-choose>选择资源保存位置</button><button type="button" data-managed-authorize hidden>重新授权</button><button type="button" data-managed-use hidden>启用自动管理</button><button type="button" data-managed-pause hidden>暂停资源加载</button><button type="button" data-managed-online>切换在线模式</button><button type="button" data-managed-forget hidden>解除目录关联</button></div>
    <p class="hint">自动管理模式按需保存模型和贴图，后续优先读取本地文件。地图已加载的部分在下次刷新时开始保存。</p>
    <details class="map-cache-list"><summary>各地图本地资源与清理位置</summary><button type="button" data-managed-scan>重新统计占用</button><p data-managed-count class="hint" role="status"></p><div data-managed-maps></div>
    <p class="hint">占用包含已保存分块、其他画质与旧版本。请先切换在线模式并关闭其他地图标签页，再自行删除对应地图子目录。网站不会自动删除文件；重新启用后会补充当前地图缺失资源。</p></details>
    <p class="hint">网页仅显示目录名与相对路径。目录授权可能需要更新；解除关联不会删除文件。任务等其他数据仍需联网。</p>`;
  field.querySelector('legend').after(panel);const $=selector=>panel.querySelector(selector);let busy=false;
  async function refresh(scan=false){const info=await managedResources.stats({scan});
    $('[data-managed-status]').textContent=[{managed:'自动管理本地资源',online:'在线模式（浏览器缓存）',manual:'手动资源包模式'}[info.mode]||'首次进入地图时选择保存方式',info.name?`目录：${info.name}`:'尚未关联专用目录',info.needsPermission?'需要重新授权':'',`本次读取 ${formatCacheBytes(info.hitBytes)} · 保存 ${formatCacheBytes(info.writeBytes)}`,info.reason].filter(Boolean).join('；');
    $('[data-managed-choose]').hidden=!supported();$('[data-managed-authorize]').hidden=!info.needsPermission||!info.name||!supported();
    $('[data-managed-use]').hidden=!info.connected||info.mode==='managed';$('[data-managed-forget]').hidden=!info.name;
    $('[data-managed-pause]').hidden=!map||info.mode!=='managed';$('[data-managed-pause]').textContent=info.paused?'继续资源加载':'暂停资源加载';
    $('[data-managed-client]').hidden=!managedResources.client||info.mode==='client';$('[data-managed-folder]').hidden=!managedResources.client;$('[data-managed-downloads]').hidden=!managedResources.client;
    if(info.mode==='client'){const location=await clientResourceLocation();$('[data-managed-status]').textContent=`客户端本地资源：${location.path}。${location.error||'优先读取已有文件，只下载缺失资源。'}`;}
    if(scan){const list=$('[data-managed-maps]');list.replaceChildren();
      for(const map of info.maps){const row=document.createElement('p');row.className='hint';row.textContent=`${ATLAS_MAPS[map.mapId].name} · ${formatCacheBytes(map.bytes)} · ${map.path}`;list.append(row);}
      $('[data-managed-count]').textContent=info.maps.length?`${info.maps.length} 张地图 · 共 ${formatCacheBytes(info.maps.reduce((n,m)=>n+m.bytes,0))}（文件字节）`:'尚无可统计的本地地图资源，或目录需要重新授权。';
    }
  }
  async function action(fn,scan=false){if(busy)return;busy=true;for(const b of panel.querySelectorAll('button'))b.disabled=true;
    try{await fn();await refresh(scan);}catch(error){if(error.name!=='AbortError')$('[data-managed-status]').textContent=error.message;}
    finally{busy=false;for(const b of panel.querySelectorAll('button'))b.disabled=false;}
  }
  $('[data-managed-client]').onclick=()=>action(()=>managedResources.setMode('client'));
  $('[data-managed-folder]').onclick=()=>action(()=>clientResourceLocation('resource-folder'));
  $('[data-managed-downloads]').onclick=()=>action(()=>clientResourceLocation('downloads'));
  $('[data-managed-choose]').onclick=()=>action(async()=>{if(managedResources.client)await chooseClientResourceLocation();else await managedResources.choose();await managedResources.prepare();},true);
  $('[data-managed-authorize]').onclick=()=>action(()=>managedResources.authorize(),true);
  $('[data-managed-use]').onclick=()=>action(async()=>{managedResources.setMode('managed');await managedResources.prepare();});
  $('[data-managed-online]').onclick=()=>action(()=>managedResources.setMode('online'));
  $('[data-managed-pause]').onclick=()=>action(async()=>managedResources.setPaused(!(await managedResources.stats()).paused));
  $('[data-managed-forget]').onclick=()=>action(()=>managedResources.forget(),true);
  $('[data-managed-scan]').onclick=()=>action(async()=>{},true);
  panel.querySelector('details').addEventListener('toggle',event=>{if(event.target.open)void action(async()=>{},true);});
  return {refresh:()=>refresh()};
}
