import {ATLAS_MAPS} from './atlas-maps.js';
import {managedResources} from './atlas-managed-resources.js';
import {resourceCache, sha256} from './atlas-resource-cache.js';
import {loadFactoryGeometry} from './factory-geometry.js';
import {formatCacheBytes, selectedCacheQuality} from './atlas-map-cache.js';
import {clientResourceLocation,chooseClientResourceLocation} from './atlas-resource-location-ui.js';
const $ = id => document.getElementById(id);
let controller;
// This page owns pause/retry feedback rather than the map's modal recovery UI.
managedResources.setRecoveryHandler(null);
for (const map of Object.values(ATLAS_MAPS)) $('map').add(new Option(map.name, map.id));
for (const [key, value] of Object.entries(selectedCacheQuality())) $(key).value = value;
async function refresh() { const state = await managedResources.stats(); $('directory').textContent = state.name ? `资源目录：${state.name}${state.needsPermission ? '（需要重新授权）' : ''}` : '尚未选择目录'; $('authorize').hidden = !state.needsPermission;
  if(state.mode==='client'){const info=await clientResourceLocation();$('directory').textContent=`资源目录：${info.path}${info.error?'；'+info.error:''}`;$('authorize').hidden=true;}
}
$('choose').onclick = async () => { try { await chooseClientResourceLocation(); await refresh(); } catch (e) { if (e.name !== 'AbortError') $('status').textContent = e.message; } };
$('authorize').onclick = async () => { try { await managedResources.authorize(); await refresh(); } catch (e) { $('status').textContent = e.message; } };
$('pause').onclick = () => { controller?.abort(); void globalThis.tarkovDesktop.cancelPrepare(); };
window.addEventListener('beforeunload', event => { if (controller) { event.preventDefault(); event.returnValue = ''; } });
$('download').onclick = async () => {
  if (controller) return;
  const state = await managedResources.stats();
  const client=state.mode==='client'||!['managed','manual'].includes(state.mode);
  if(client){const info=await clientResourceLocation();if(!info.available){$('status').textContent=info.error;return;}}
  else if (!state.connected || state.needsPermission) { $('status').textContent = '请先选择资源保存位置或重新授权。'; return; }
  if (!globalThis.tarkovDesktop) { $('status').textContent = '请从桌面版的“应用菜单 → 离线地图”进入。'; return; }
  controller = new AbortController(); const signal = controller.signal;
  for (const node of document.querySelectorAll('select,button')) node.disabled = node.id !== 'pause';
  $('progress').value = 0;
  try {
    managedResources.setMode(client?'client':'managed');
    const mapId = $('map').value, quality = Object.fromEntries(['geometry', 'texture', 'scenery'].map(key => [key, $(key).value]));
    $('status').textContent = '准备场景清单，完成后开始下载。首次准备可能需要几分钟…';
    const plan = await globalThis.tarkovDesktop.prepareMap(mapId, quality); signal.throwIfAborted();
    await managedResources.register(plan); await managedResources.prepare();
    const cache = client?managedResources.clientCache:managedResources.cache(resourceCache, signal), total = [...plan.geometry, ...plan.texture].reduce((n, row) => n + row[2], 0);
    $('estimate').textContent = `${ATLAS_MAPS[mapId].name} · 当前画质 ${formatCacheBytes(total)}（已保存资源会校验后跳过）`;
    let completed = 0;
    const progress = extra => { if(signal.aborted)return;$('progress').value = (completed + extra) / total * 100; $('status').textContent = `正在下载 / 校验 · ${formatCacheBytes(completed + extra)} / ${formatCacheBytes(total)}`; };
    for (const [identity, hash, bytes] of plan.geometry) {
      signal.throwIfAborted();
      await loadFactoryGeometry({sha256: hash, stats: {bytes}}, done => progress(done), identity.slice('geometry:'.length), signal, cache);
      completed += bytes; progress(0);
    }
    // A small fixed concurrency keeps both memory and disk queues bounded.
    let next = 0;
    const downloads = await Promise.allSettled(Array.from({length: 4}, async () => { try { while (next < plan.texture.length) {
      signal.throwIfAborted(); const [identity, hash, bytes] = plan.texture[next++], ticket = cache.ticket(identity);
      let blob = await cache.get(identity, hash);
      if (!blob || blob.size !== bytes || await sha256(await blob.arrayBuffer()) !== hash) {
        const response = await fetch(`${identity.slice('texture:'.length)}?v=${hash}`, {signal,cache:'no-store',headers:client?{'X-Tarkov-Storage':'client'}:{}});
        if (!response.ok) {const detail=await response.json().catch(()=>null);throw Error(detail?.error||`贴图下载失败（${response.status}），可再次点击下载续传`);}
        blob = await response.blob(); await cache.put(identity, hash, blob, ticket);
      }
      completed += bytes; progress(0);
    } } catch (error) { controller.abort(); throw error; } }));
    const failure = downloads.find(item => item.status === 'rejected'); if (failure) throw failure.reason;
    $('progress').value = 100; $('status').textContent = '下载并校验完成。请在地图设置中使用本次选择的画质；现在可以断网浏览这张地图。';
  } catch (e) {
    controller.abort();
    const reason = e.name === 'QuotaExceededError' ? '磁盘空间不足，请手动清理后重试，或更换资源保存位置。' : e.name === 'NotAllowedError' ? '目录权限已失效，请重新授权后继续。' : e.message;
    $('status').textContent = e.name === 'AbortError' ? '已暂停，已保存的资源会保留。再次下载可继续。' : `未完成：${reason}`;
  }
  finally { controller = null; for (const node of document.querySelectorAll('select,button')) node.disabled = node.id === 'pause'; await refresh(); }
};
await refresh();
