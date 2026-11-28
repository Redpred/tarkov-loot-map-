import {localResources} from './atlas-local-resources.js';
import {managedResources} from './atlas-managed-resources.js';
import {ATLAS_MAPS} from './atlas-maps.js';
import {formatCacheBytes} from './atlas-map-cache.js';

export function createLocalResourceSettings(panel,actions,map,action){
  actions.insertAdjacentHTML('beforeend','<button type="button" data-local-choose>使用本地资源包</button>');
  panel.insertAdjacentHTML('beforeend',`<input data-local-files type="file" webkitdirectory multiple hidden>
    <section class="settings-section" data-local-associated hidden>
      <div class="settings-inline"><h3>已关联资源包</h3><button type="button" class="settings-info" data-settings-tip="localPackHelp" aria-label="已关联资源包详情" aria-describedby="localPackHelp">?</button></div>
      <div id="localPackHelp" hidden><p>按需读取解压后的文件。解除关联会保留目录中的文件。</p><p data-local-metrics></p><ul data-local-packs></ul></div>
      <div class="view-actions">
        <button type="button" data-local-authorize hidden>重新授权读取</button>
        <button type="button" data-local-refresh hidden>重新检查资源包</button>
        <button type="button" data-local-forget>解除资源包关联</button>
      </div>
      <p data-local-status class="hint" role="status"></p>
    </section>`);
  const $=name=>panel.querySelector(`[data-local-${name}]`);
  const files=$('files');
  function selectPack(read){
    return action(async()=>{await read();managedResources.setMode('manual');});
  }
  $('choose').onclick=()=>{
    if(globalThis.showDirectoryPicker&&globalThis.isSecureContext)return selectPack(()=>localResources.choose());
    if(map)files.click();
    else return action(()=>{throw Error('请在地图页选择已解压的资源包目录。');});
  };
  files.onchange=()=>{
    const selection=[...files.files];
    files.value='';
    if(selection.length)return selectPack(()=>localResources.importFiles(selection));
  };
  $('authorize').onclick=()=>action(()=>localResources.authorize());
  $('refresh').onclick=()=>action(()=>localResources.refresh());
  $('forget').onclick=()=>action(()=>localResources.forget());

  return function update(info){
    $('associated').hidden=!info.name;
    $('status').textContent=info.reason||(info.needsPermission?'需要重新授权读取。':'');
    $('authorize').hidden=!info.needsPermission;
    $('refresh').hidden=!info.connected;
    $('metrics').textContent=info.connected?`已关联 ${info.packs.length} 个资源包 · 本次复用 ${formatCacheBytes(info.hitBytes)}`:'';
    const list=$('packs');
    list.replaceChildren();
    for(const pack of info.packs){
      const row=document.createElement('li');
      row.textContent=`${ATLAS_MAPS[pack.mapId]?.name||pack.mapId} · ${formatCacheBytes(pack.bytes)} · ${pack.name}`;
      list.append(row);
    }
  };
}
