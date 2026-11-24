import {sha256} from './atlas-resource-cache.js';
import {loadEncyclopediaManifest,fetchEncyclopediaResource,boundSnapshot} from './encyclopedia-data.js';
import {presentBossCatalog,bossName} from './boss-presentation.js';

export const bossKey=id=>'boss:'+id;
export const roleById=(catalog,id)=>catalog.roles.find(r=>r.id===id);
export const appearanceById=(catalog,id)=>catalog.appearances.find(a=>a.id===id);
export function allowedAppearance(a,mode,variant=''){
  // Explicitly browsing archived dark-lab positions is independent of the live
  // mode selector: the two saved versions disagree on mode flags.
  if(a?.context&&a.location==='laboratory_dark')return variant==='laboratory_dark';
  return Boolean(a&&a.modes.includes(mode)&&(!variant||a.location===variant)
    &&(!a.context||a.location!=='laboratory_dark'||variant==='laboratory_dark'));
}
export function bossPointEligible(point,catalog,mode,variant=''){
  return (point.bossRefs||[]).some(r=>allowedAppearance(appearanceById(catalog,r.appearanceId),mode,variant));
}
export function bossPointSelected(point,catalog,selected,mode,variant=''){
  return (point.bossRefs||[]).some(r=>allowedAppearance(appearanceById(catalog,r.appearanceId),mode,variant)
    &&[r.role,...r.companions||[]].some(id=>selected.has(bossKey(id))));
}
export function probabilityLabel(appearance){
  const p=appearance?.probability;
  return p?.basis==='version-configuration'&&p.scope==='wave'&&Number.isFinite(p.value)&&p.value>=0&&p.value<=100
    ? `记录刷新率 ${p.value}%`:'';
}
export function attachBossPoints(data,sidecar){
  if(!sidecar||sidecar.eftBuild!==data.sources?.atlas?.eftBuild||sidecar.sourceCommit!==data.sources?.spt?.commit)throw Error('BOSS 数据版本不一致');
  // Retire only the old Boss region placeholders in memory. Their source file,
  // other POIs, quest IDs and saved progress are not rewritten.
  data.points=[...data.points.filter(p=>!(p.kind==='poi'&&!p.quest&&p.poiTypes?.includes('boss'))),...sidecar.points];
  return data;
}
async function verifiedJson(info,fetcher){
  if(!info?.file?.startsWith('data/bosses/')||!/^[a-f0-9]{64}$/.test(info.sha256))throw Error('BOSS 数据清单无效');
  const response=await fetcher(`${info.file}?v=${info.sha256}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('BOSS 数据暂不可用');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==info.bytes||await sha256(bytes)!==info.sha256)throw Error('BOSS 数据校验失败');
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function loadBossData({mapId,geometrySha256,source,fetcher=fetch}={}){
  const response=await fetcher('data/bosses/manifest.json',{cache:'no-cache',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('BOSS 资料加载失败');
  const manifest=await response.json();
  if(manifest.version!==1)throw Error('BOSS 资料格式无效');
  const [catalog,map]=await Promise.all([verifiedJson(manifest.catalog,fetcher),mapId?verifiedJson(manifest.maps[mapId],fetcher):null]);
  if(catalog.version!==1||catalog.sourceCommit!==manifest.sourceCommit||catalog.eftBuild!==manifest.eftBuild)throw Error('BOSS 资料版本不符');
  if(map&&(map.mapId!==mapId||map.version!==1||map.geometrySha256!==geometrySha256||map.sourceCommit!==source?.spt?.commit||map.eftBuild!==source?.atlas?.eftBuild))throw Error('BOSS 地图资料待更新');
  // Optional, separately versioned official snapshot; never replace geometry,
  // selection membership, old probabilities, or point coordinates with it.
  try{
    const encyclopedia=await loadEncyclopediaManifest(fetcher);
    catalog.liveSnapshot=boundSnapshot(await fetchEncyclopediaResource(encyclopedia.mapSnapshot,fetcher),manifest);
  }catch{catalog.liveSnapshotUnavailable=true;}
  presentBossCatalog(catalog);
  if(map)for(const point of map.points){
    const names=[...new Set(point.bossRefs.map(r=>bossName(r.role)))];
    const zone=point.label.split(' · ').at(-1);
    point.label=names.join(' / ')+(zone?' · '+zone:'');
  }
  return {catalog,map};
}
