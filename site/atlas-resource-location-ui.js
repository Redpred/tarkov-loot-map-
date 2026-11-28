import {managedResources,MANAGED_DIRECTORY} from './atlas-managed-resources.js';
import {localResources} from './atlas-local-resources.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {cacheQualityText,formatCacheBytes} from './atlas-map-cache.js';
import {createLocalResourceSettings} from './atlas-local-resources-ui.js';
import {createMapDiagnosticCopy,directoryError,formatMapDiagnostic,mapErrorMessage,mapLoadError} from './atlas-map-diagnostics.js';
import {readMapJson} from './atlas-resource-request.js';

const supported=()=>typeof globalThis.showDirectoryPicker==='function'&&globalThis.isSecureContext;
export async function clientResourceLocation(action){
  if(action){const bridge=globalThis.tarkovDesktop||window.top.tarkovDesktop;const result=await bridge.action(action);if(result===false)return null;}
  return readMapJson('/api/client-resources','客户端资源位置读取',{code:'CLIENT-LOCATION',cache:'no-store',readError:true,retries:0});
}
export async function chooseClientResourceLocation(){const info=await clientResourceLocation('choose-resources');if(info)managedResources.setMode('client');return info;}
let activePrompt;
export function showResourceLocation({map,plan,recovery=false,message='',failure}={}){
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
    $('[data-location-size]').textContent=plan?`${cacheQualityText(plan.quality)} · 整图资源约 ${formatCacheBytes([...plan.geometry,...plan.texture].reduce((n,row)=>n+row[2],0))}。按需要逐步下载，不会一次下载全部地图。`:'';
    $('[data-location-status]').textContent=message||(!supported()?'当前浏览器无法自动保存到自选目录，请使用下方兼容入口。':'');
    const copy=createMapDiagnosticCopy();
    dialog.querySelector('.resource-location-actions').append(copy.button);
    function showProblem(error){
      $('[data-location-status]').textContent=mapErrorMessage(error);
      copy.update(formatMapDiagnostic(error,{mapId:map?.id||document.documentElement.dataset.map,mode:managedResources.mode()}));
    }
    if(failure)showProblem(failure);
    $('[data-location-choose]').hidden=!supported();
    if(!supported()||recovery)dialog.querySelector('details').open=true;
    const finish=()=>{dialog.close();dialog.remove();activePrompt=null;resolve();};
    async function action(fn){if(busy)return;busy=true;for(const b of dialog.querySelectorAll('button'))b.disabled=true;
      try{await fn();finish();}catch(error){if(error.name!=='AbortError')showProblem(directoryError(error));}
      finally{busy=false;for(const b of dialog.querySelectorAll('button'))b.disabled=false;}
    }
    $('[data-location-client]').hidden=!managedResources.client;
    $('[data-location-client]').onclick=()=>action(async()=>{const info=await clientResourceLocation();if(!info.available)throw mapLoadError(info.code||'CLIENT-DIRECTORY-UNAVAILABLE',info.error);managedResources.setMode('client');});
    $('[data-location-choose]').onclick=()=>action(()=>managedResources.client?chooseClientResourceLocation().then(info=>{if(!info)throw new DOMException('已取消','AbortError');}):managedResources.choose());
    $('[data-location-authorize]').onclick=()=>action(async()=>{await managedResources.authorize();if(managedResources.mode()!=='managed')managedResources.setMode('managed');});
    $('[data-location-retry]').hidden=!recovery;
    $('[data-location-retry]').onclick=()=>action(async()=>{const state=await managedResources.stats();if(state.needsPermission)throw mapLoadError('STORAGE-PERMISSION','请点击重新授权，或重新选择目录');});
    $('[data-location-online]').onclick=()=>action(()=>managedResources.setMode('online'));
    $('[data-location-manual]').onclick=()=>{if(globalThis.showDirectoryPicker)void action(async()=>{await localResources.choose();managedResources.setMode('manual');});else $('[data-location-files]').click();};
    $('[data-location-files]').onchange=event=>action(async()=>{await localResources.importFiles(event.target.files);managedResources.setMode('manual');});
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy){if(managedResources.client){$('[data-location-status]').textContent='请选择本地资源位置，或在其他使用方式中手动切换模式。';return;}managedResources.setMode('online');finish();}});
    void managedResources.stats().then(info=>{$('[data-location-authorize]').hidden=!info.needsPermission||!info.name||!supported();});
    dialog.showModal();
  });return activePrompt;
}
managedResources.setRecoveryHandler((message,failure)=>showResourceLocation({recovery:true,message,failure}));

export async function prepareResourceLocation(map,plan,geometry){
  await managedResources.register(plan);
  for(const model of map.streamed?geometry.sectors:[geometry]){
    const filter=model.decorationFilter;if(filter?.removedMeshes>0){
      const identity=plan.geometry.find(row=>row[1]===model.sha256)?.[0]?.replace(/\/simple(?=\/|$)/,'');
      if(identity)managedResources.addSource(identity,filter.sourceGeometrySha256,filter.sourceBytes);
    }
  }
  const state=await managedResources.stats();
  if(!state.mode)await showResourceLocation({map,plan,message:state.reason});
  else if(state.mode==='managed'&&(!state.connected||!supported())){
    const code=state.needsPermission&&!state.reason?'STORAGE-PERMISSION':'STORAGE-DIRECTORY-UNAVAILABLE';
    await showResourceLocation({map,plan,failure:mapLoadError(code,state.reason||'请重新授权或选择资源目录。')});
  }
  if(managedResources.mode()==='manual'){
    const local=await localResources.stats();
    if(!local.connected)await showResourceLocation({map,plan,failure:mapLoadError('STORAGE-PACK-DISCONNECTED','请重新选择已解压资源包，或切换其他使用方式。')});
  }
  await managedResources.prepare();
}

export function createResourceLocationSettings(field,map){
  const panel=document.createElement('div');
  panel.className='resource-location-settings';
  panel.innerHTML=`<div class="settings-inline resource-mode-row">
      <button type="button" data-managed-switch disabled>切换模式</button>
      <p class="resource-mode-status" role="status">当前模式：<strong data-managed-status>正在读取…</strong></p>
      <button type="button" class="settings-info" data-settings-tip="resourceModeHelp" aria-label="资源模式说明" aria-describedby="resourceModeHelp">?</button>
    </div>
    <p class="resource-path">保存路径：<span data-managed-path>正在读取…</span></p>
    <div class="view-actions resource-main-actions" data-managed-main>
      <button type="button" data-managed-folder hidden>打开资源文件夹</button>
      <button type="button" data-managed-choose>更改保存位置</button>
    </div>
    <p id="resourceModeHelp" hidden></p>
    <p class="hint" data-managed-warning role="status"></p>
    <p class="hint" data-managed-message role="status"></p>
    <section class="settings-section" data-managed-inventory hidden>
      <div class="settings-inline"><h3>本地地图占用</h3><button type="button" class="settings-info" data-settings-tip="managedInventoryHelp" aria-label="本地地图占用说明" aria-describedby="managedInventoryHelp">?</button></div>
      <p id="managedInventoryHelp" hidden>网页只能显示已授权的目录名与相对路径。切换在线模式并关闭地图页后，可在文件管理器中清理对应地图目录。解除关联会保留文件。</p>
      <p data-managed-count class="hint" role="status">尚未统计占用。</p>
      <div data-managed-maps></div>
      <div class="view-actions">
        <button type="button" data-managed-scan>统计占用</button>
        <button type="button" data-managed-authorize hidden>重新授权文件夹</button>
        <button type="button" data-managed-use hidden>恢复已关联文件夹</button>
        <button type="button" data-managed-pause hidden>暂停文件夹读写</button>
        <button type="button" data-managed-forget>解除文件夹关联</button>
      </div>
    </section>`;
  field.append(panel);
  const $=name=>panel.querySelector(`[data-managed-${name}]`);
  const updatePack=createLocalResourceSettings(panel,$('main'),map,action);
  const buttons=panel.querySelectorAll('button:not([data-settings-tip])');
  const switchMode=$('switch'),choose=$('choose'),folderButton=$('folder');
  const count=$('count'),list=$('maps'),message=$('message');
  const desktop=managedResources.client;
  folderButton.hidden=!desktop;
  choose.hidden=!desktop&&!supported();
  panel.querySelector('#resourceModeHelp').textContent=desktop?
    '切换模式可在客户端本地资源和在线模式之间切换。完整安装包已包含默认地图资源，已解压资源包可只读关联。':
    '在线模式使用浏览器缓存。本地文件夹会保存新下载的资源，网页只显示已授权的目录名。已解压资源包可只读关联。';
  let state,busy=false,revision=0,inventoryRevision;

  function syncSwitch(){
    switchMode.disabled=busy||!state||(state.mode==='online'&&!desktop&&!supported());
  }

  async function refresh(scan=false){
    const stamp=++revision;
    const [info,pack]=await Promise.all([managedResources.stats({scan}),localResources.stats()]);
    const native=info.mode==='client',folder=info.mode==='managed',manual=info.mode==='manual';
    const location=native?await clientResourceLocation().catch(error=>({error:error.message})):null;
    if(stamp!==revision)return;
    state=info;
    const modes={client:'客户端本地资源',managed:'本地文件夹',online:'在线模式',manual:'只读资源包'};
    $('status').textContent=modes[info.mode]||'未选择';
    $('path').textContent=native?location.path||'暂不可用':folder?info.name||'未关联文件夹':
      manual?pack.name||'未关联资源包':info.mode==='online'?'浏览器缓存':'未设置';
    $('warning').textContent=location?.error||(folder&&(info.reason||
      (!info.connected?'请重新授权或更改保存位置。':'')))||(manual&&!pack.name?'请关联已解压的资源包。':'');
    $('inventory').hidden=!info.name;
    $('authorize').hidden=!info.needsPermission||!supported();
    $('use').hidden=!desktop||!info.connected||folder;
    $('pause').hidden=!map||!folder||!info.connected;
    $('pause').textContent=info.paused?'继续文件夹读写':'暂停文件夹读写';
    syncSwitch();
    updatePack(pack);
    if(!scan&&inventoryRevision===info.revision)return;
    inventoryRevision=info.revision;
    list.replaceChildren();
    for(const entry of info.maps){
      const row=document.createElement('p');
      row.className='hint';
      row.textContent=`${ATLAS_MAPS[entry.mapId].name} · ${formatCacheBytes(entry.bytes)} · ${entry.path}`;
      list.append(row);
    }
    count.textContent=scan?(info.maps.length?
      `${info.maps.length} 张地图 · 共 ${formatCacheBytes(info.maps.reduce((total,entry)=>total+entry.bytes,0))}`:
      info.reason||'暂无可统计的地图文件。'):'尚未统计占用。';
  }

  async function action(fn,scan=false){
    if(busy)return;
    busy=true;
    revision++;
    message.textContent='';
    for(const button of buttons)button.disabled=true;
    let problem='';
    try{await fn?.();}
    catch(error){if(error.name!=='AbortError')problem=error.message;}
    try{await refresh(scan);}
    catch(error){problem||=error.message;}
    finally{
      busy=false;
      for(const button of buttons)button.disabled=false;
      syncSwitch();
      message.textContent=problem;
    }
  }

  async function useFolder(){
    managedResources.setMode('managed');
    await managedResources.prepare();
  }
  switchMode.onclick=()=>action(async()=>{
    if(managedResources.mode()!=='online')return managedResources.setMode('online');
    if(desktop)return managedResources.setMode('client');
    if(state.needsPermission&&state.name){
      await managedResources.authorize();
    }else if(!state.connected){
      await managedResources.choose();
      await managedResources.prepare();
      return;
    }
    await useFolder();
  });
  folderButton.onclick=()=>action(()=>clientResourceLocation('resource-folder'));
  choose.onclick=()=>action(async()=>{
    if(desktop)return chooseClientResourceLocation();
    await managedResources.choose();
    await managedResources.prepare();
  });
  $('authorize').onclick=()=>action(()=>managedResources.authorize());
  $('use').onclick=()=>action(useFolder);
  $('pause').onclick=()=>action(()=>managedResources.setPaused(!state.paused));
  $('forget').onclick=()=>action(()=>managedResources.forget());
  $('scan').onclick=()=>{
    count.textContent='正在统计本地占用…';
    return action(null,true);
  };
  return {refresh:async()=>{
    if(busy)return;
    try{await refresh();}
    catch(error){message.textContent=error.message;}
  }};
}
