import {localResources} from './atlas-local-resources.js';
import {managedResources} from './atlas-managed-resources.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {formatCacheBytes} from './atlas-map-cache.js';

export function createLocalResourceSettings(field,map){
  const panel=document.createElement('details');panel.className='map-cache-list';
  panel.innerHTML=`<summary>本地资源包（只读兼容）</summary>
    <p class="hint">已有解压资源包可在此关联。网站只读取文件；自动下载和分类请使用上方“资源保存位置”。</p>
    <div class="view-actions"><button type="button" data-local-choose>选择资源目录</button><button type="button" data-local-authorize hidden>重新授权读取</button><button type="button" data-local-refresh hidden>重新检查目录</button><button type="button" data-local-forget hidden>解除关联</button></div>
    <input data-local-files type="file" webkitdirectory multiple hidden>
    <p data-local-status class="hint" role="status"></p>
    <ul data-local-packs class="hint"></ul>
    <p class="hint">网页只显示目录名。解除关联不会删除文件。资源包仅包含对应画质的模型和贴图，网页与其他数据仍需联网。</p>`;
  field.append(panel);const $=selector=>panel.querySelector(selector);let busy=false;
  async function refresh(){const info=await localResources.stats();
    $('[data-local-status]').textContent=[info.name?`目录：${info.name}`:'尚未选择本地资源目录',info.connected?`已关联 ${info.packs.length} 个资源包 · 本次复用 ${formatCacheBytes(info.hitBytes)}`:'',info.needsPermission?'需要重新授权后才能读取':'',info.reason].filter(Boolean).join('；');
    $('[data-local-authorize]').hidden=!info.needsPermission;$('[data-local-refresh]').hidden=!info.connected;$('[data-local-forget]').hidden=!info.name;
    const list=$('[data-local-packs]');list.replaceChildren();for(const pack of info.packs){const row=document.createElement('li');row.textContent=`${ATLAS_MAPS[pack.mapId]?.name||pack.mapId} · ${formatCacheBytes(pack.bytes)} · ${pack.name}`;list.append(row);}
  }
  async function action(fn){if(busy)return;busy=true;for(const button of panel.querySelectorAll('button'))button.disabled=true;
    try{await fn();await refresh();}catch(error){if(error.name!=='AbortError')$('[data-local-status]').textContent=error.message;}
    finally{busy=false;for(const button of panel.querySelectorAll('button'))button.disabled=false;}
  }
  $('[data-local-choose]').onclick=()=>{if(globalThis.showDirectoryPicker)void action(async()=>{await localResources.choose();managedResources.setMode('manual');});else if(map)$('[data-local-files]').click();else $('[data-local-status]').textContent='此浏览器需要在地图页面选择目录，刷新后需重新选择。请先进入需要的地图。';};
  $('[data-local-files]').onchange=event=>action(async()=>{await localResources.importFiles(event.target.files);managedResources.setMode('manual');});
  $('[data-local-authorize]').onclick=()=>action(()=>localResources.authorize());
  $('[data-local-refresh]').onclick=()=>action(()=>localResources.refresh());
  $('[data-local-forget]').onclick=()=>action(()=>localResources.forget());
  panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});
  return {refresh};
}
