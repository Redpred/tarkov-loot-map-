import {ATLAS_MAPS,atlasMapHref} from './atlas-maps.js';
import {getGameMode} from './game-mode.js';
import {roleById,probabilityLabel} from './boss-data.js';
import {bossContext,bossFamily,bossBriefing} from './boss-presentation.js';
import {describeBossWave} from './boss-conditions.js';
import {caliberLabel} from './encyclopedia-fields.js';

export const escapeBoss=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeBoss;
const slots={Headwear:'头部装备',Earpiece:'耳机',FaceCover:'面部装备',ArmorVest:'护甲',Eyewear:'眼镜',ArmBand:'臂带',TacticalVest:'胸挂',Backpack:'背包',FirstPrimaryWeapon:'主武器',SecondPrimaryWeapon:'第二武器',Holster:'手枪',Scabbard:'近战武器',Pockets:'口袋',SpecialLoot:'特殊物资',SecuredContainer:'内部储备',mods:'配件与装备组合候选'};
const kinds={equipment:'装备',loot:'随身物资',ammo:'弹药',mods:'配件',reserve:'内部储备'};
const modes={regular:'PvP 常规',pve:'PvE','pvp-season':'PvP 赛季'};
const inventoryVariants={bossbullyblackdiv:'Black Division 配置',bosskillaagro:'迷宫配置',bosstagillaagro:'迷宫配置',bosswedgelab:'Blackout 活动记录',pmcbotblackdiv:'实验室停电记录',infectedtagilla:'感染者活动记录',ravangezryachiyevent:'活动记录'};
export function bossInventoryChoices(catalog,entry){
  const waves=entry.waves||[entry],ids=new Set(waves.map(w=>String(w.role||'').toLowerCase()));
  const families=new Set([...ids].map(bossFamily)),related=new Set(catalog.roles.filter(r=>families.has(bossFamily(r.id))).map(r=>r.id));
  for(const a of catalog.appearances)if(ids.has(a.role))for(const companion of a.companions||[])related.add(companion.role);
  for(const w of waves){
    const raw=w.detail||w.raw||{};
    if(raw.BossEscortType&&String(raw.BossEscortAmount??'').split(',').some(v=>Number(v)>0))related.add(String(raw.BossEscortType).toLowerCase());
    for(const support of Array.isArray(raw.Supports)?raw.Supports:[])if(support.BossEscortType&&String(support.BossEscortAmount??'').split(',').some(v=>Number(v)>0))related.add(String(support.BossEscortType).toLowerCase());
  }
  const choices=catalog.roles.map(r=>({id:r.id,name:r.name,label:r.name+(inventoryVariants[r.id]?' · '+inventoryVariants[r.id]:''),related:related.has(r.id)}));
  choices.sort((a,b)=>Number(b.related)-Number(a.related)||a.label.localeCompare(b.label,'en'));
  const selected=roleById(catalog,entry.role)?.id||(entry.waves?entry.waves.find(w=>roleById(catalog,w.role))?.role:'')||'';
  return {choices,selected};
}
export function bossInventoryGroupLabel(group){
  if(group.kind==='reserve')return kinds.reserve;
  const label=slots[group.id]||caliberLabel(group.id).replace(/^(\d+) gauge$/,'$1 铅径');
  return (kinds[group.kind]||'物品')+' · '+label;
}
export function mapBossLink(mapId,roleId,pointId){
  const url=atlasMapHref(mapId);
  return url+(url.includes('?')?'&':'?')+'boss='+encodeURIComponent(roleId)+(pointId?'&bossPoint='+encodeURIComponent(pointId):'');
}
export function renderBossInventory(host,{catalog,roleId}){
  const role=roleById(catalog,roleId),groups=(role?.groups||[]).filter(g=>g.items?.length);
  if(!groups.length){host.innerHTML='<p class="boss-note">此角色暂无已收录的装备与携带物资资料。</p>';return;}
  host.innerHTML=`<p class="boss-note">装备记录版本 EFT ${e(catalog.eftVersion)}。以下为可能携带的物品，不保证每次出现；不确定的携带概率不显示。</p>
    <label class="boss-item-search">筛选物品<input type="search" data-boss-item-search placeholder="搜索武器、钥匙、弹药…" aria-label="筛选 BOSS 物品"></label>
    <div class="boss-inventory">${groups.map(g=>`<details class="boss-item-group"${g.id==='FirstPrimaryWeapon'?' open':''}><summary>${e(bossInventoryGroupLabel(g))} <small>${g.items.length} 种</small></summary>
      ${g.kind==='reserve'?'<p class="boss-note">内部储备不计入可搜取物资。</p>':''}
      <div class="boss-items">${g.items.map(row=>{const item=catalog.items[row.tpl];return `<div class="boss-item" data-boss-search="${e([item?.name,item?.en,row.tpl].filter(Boolean).join(' ').toLocaleLowerCase())}">${item?.icon?`<img loading="lazy" src="${e(item.icon)}" alt="" width="44" height="44">`:'<span class="boss-no-icon">?</span>'}<span title="${e(item?.en)}">${e(item?.name||'未命名物品')}</span></div>`;}).join('')}</div></details>`).join('')}</div>
    <p class="boss-no-match" hidden>没有匹配的物品。</p>`;
  const input=host.querySelector('[data-boss-item-search]');
  const initialOpen=new Set([...host.querySelectorAll('.boss-item-group[open]')]);
  input.oninput=()=>{
    const q=input.value.trim().toLocaleLowerCase();let found=0;
    for(const group of host.querySelectorAll('.boss-item-group')){
      let count=0;for(const row of group.querySelectorAll('[data-boss-search]')){row.hidden=Boolean(q&&!row.dataset.bossSearch.includes(q));if(!row.hidden)count++;}
      group.querySelector('summary small').textContent=q?`${count} / ${group.querySelectorAll('[data-boss-search]').length} 种`:`${count} 种`;
      group.hidden=!count;group.open=q?count>0:initialOpen.has(group);found+=count;
    }
    host.querySelector('.boss-no-match').hidden=found>0;
  };
}
function conditionFacts(w){
  const {facts,notes}=describeBossWave(w);
  return `<dl class="boss-rule-facts">${facts.map(f=>`<div><dt>${e(f.label)}</dt><dd>${e(f.value)}</dd></div>`).join('')}</dl>${notes.length?`<ul class="boss-rule-notes">${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul>`:''}`;
}
export function readableBossFacts(w){
  const {facts,notes}=describeBossWave(w);
  const advanced=f=>['强制生成标志','随机时机标志','AI 数量上限标志'].includes(f.label)||f.label==='延迟参数'&&f.value==='0 秒';
  const rows=values=>`<dl class="boss-rule-facts">${values.map(f=>`<div><dt>${e(f.label)}</dt><dd>${e(f.value)}</dd></div>`).join('')}</dl>`;
  return rows(facts.filter(f=>f.label!=='波次配置概率'&&!advanced(f)))+
    `<details class="boss-wave-conditions"><summary>补充标志与数值说明</summary>${rows(facts.filter(advanced))}<ul class="boss-rule-notes">${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul></details>`;
}
function appearanceHtml(a,catalog,{mapId,point}){
  const context=a.context||bossContext(a),prob=context.showRate?probabilityLabel(a):'',available=a.modes.includes(getGameMode());
  const positions=a.pointIds.length,refs=a.referenceIds.length;
  return `<article class="boss-appearance${available?'':' boss-other-mode'}">
    <strong>${e(a.mapName)} · ${e(a.variant)}</strong>
    ${context.showRate?'':`<p class="boss-note">${e(context.note)}</p>`}
    <p class="boss-tags">${a.modes.map(m=>`<span>${e(modes[m]||m)}</span>`).join('')}${prob?`<b>${e(prob)}</b>`:''}</p>
    ${available?'':'<p class="boss-note">这份旧记录没有列出当前选择的模式；不据此判断当前可否刷新。</p>'}
    <p>${a.zones.length?a.zones.map(z=>e(z.name)).join('、'):'固定区域尚未核验'}</p>
    ${conditionFacts(a)}
    ${a.companions.some(c=>c.amounts.some(n=>n>0))?`<p class="boss-note">查看随行装备：${[...new Set(a.companions.filter(c=>c.amounts.some(n=>n>0)).map(c=>c.role))].map(id=>`<button class="boss-inline" data-boss-role="${e(id)}">${e(roleById(catalog,id)?.name||id)}</button>`).join(' · ')}</p>`:''}
    <p class="boss-note">${positions?`${positions} 个已核验候选点`:refs?'仅有区域参考位置':'暂无已核验点位'}${refs&&positions?`，另有 ${refs} 个区域参考位置`:''}。</p>
    ${!mapId&&ATLAS_MAPS[a.mapId]?`<a class="boss-map-link" href="${e(mapBossLink(a.mapId,a.role))}">在${e(a.mapName)}查看 →</a>`:''}
  </article>`;
}
function officialSnapshotHtml(catalog,roleId,mapId,point){
  const snapshot=catalog.liveSnapshot;
  if(!snapshot)return catalog.liveSnapshotUnavailable?'<p class="boss-note">官服配置快照暂不可用，下方保留已收录的版本资料。</p>':'';
  const waves=snapshot.waves.filter(w=>w.role===roleId&&(!mapId||w.mapId===mapId)&&(!point||w.points.some(p=>p.id===point.id)));
  return `<details class="boss-spawns" open><summary>官服刷新配置 · 2026-10-20 <small>${waves.length} 条</small></summary>
    <p class="boss-note">EFT ${e(snapshot.eftVersion)} 快照；按下方模式标志与触发条件阅读。PvE / 赛季未分别采集验证；刷新率属于波次，不是逐点概率。</p>
    ${!waves.length?'<p class="boss-note">此角色或点位暂无可关联的官服配置。</p>':''}
    ${waves.map(w=>{const context=bossContext(w);return `<article class="boss-appearance${w.enabled&&w.modes.includes(getGameMode())?'':' boss-other-mode'}"><strong>${e(w.mapName)} · ${e(w.variant)}</strong>
      <p class="boss-tags"><b>${e(context.label)}</b><span>波次配置概率 ${e(w.chance)}%</span></p>
      <p class="boss-note">${e(context.note)}</p>
      ${!w.enabled?'<p class="boss-note">该场景在此快照中未启用。</p>':''}
      ${!w.modes.includes(getGameMode())?'<p class="boss-note">配置未列出当前选择的游戏模式。</p>':''}
      <details class="boss-wave-conditions"><summary>查看模式、触发与随行条件</summary>${conditionFacts(w)}</details>
      <p class="boss-note">${w.points.length?`${w.points.length} 个候选点已与当前地图核验关联。`:'暂无可与当前地图核验关联的候选点。'}</p>
      </article>`;}).join('')}</details>`;
}
export function renderBossDetails(host,{catalog,roleId,mapId,point,onRole=()=>{},onLocate}){
  const role=roleById(catalog,roleId);if(!role){host.textContent='未收录此角色。';return;}
  const appearances=catalog.appearances.filter(a=>role.appearanceIds.includes(a.id)&&(!mapId||a.mapId===mapId)
    &&(!point||point.bossRefs.some(r=>r.appearanceId===a.id)));
  const direct=appearances.filter(a=>a.role===roleId),related=appearances.filter(a=>a.role!==roleId);
  const ids=[...new Set(appearances.flatMap(a=>[...a.pointIds,...a.referenceIds]))];
  host.innerHTML=`<div class="boss-detail">
    <div class="boss-eyebrow">BOSS 与特殊敌人</div><h2>${e(role.name)}</h2>
    ${bossBriefing({waves:appearances}).map(n=>`<div class="boss-appearance"><p class="boss-note"><strong>${e(n.title)}</strong><br>${e(n.text)}</p>${n.url?`<a class="boss-map-link" href="${e(n.url)}" target="_blank" rel="noopener noreferrer">官方公告 ↗</a>`:''}</div>`).join('')}
    ${point?`<p class="boss-coordinate">X ${point.position.x.toFixed(2)} · Y ${point.position.y.toFixed(2)} · Z ${point.position.z.toFixed(2)}</p>
      <p class="boss-note">${point.referenceOnly?'区域参考位置，不能作为精确出生点。':'候选出生点，实际生成与移动以战局为准。'}</p>
      ${point.range?`<p class="boss-note">点位关联球形范围：半径 ${point.range.radius} 米。该范围不表示活动边界，也不表示球内任意位置都能出生。</p>`:'<p class="boss-note">此点没有已核验范围。</p>'}`:''}
    ${officialSnapshotHtml(catalog,roleId,mapId,point)}
    <p class="boss-note">地图与装备记录版本 ${e(catalog.eftVersion)}。下方为该版本的地点与波次配置。</p>
    <details class="boss-spawns"${catalog.liveSnapshot?'':' open'}><summary>地图版本的地点与条件 <small>${appearances.length} 条</small></summary>
    ${!appearances.length?'<p class="boss-note">该角色的固定刷新位置尚未核验。保留物资资料，不推测坐标。</p>':''}
    ${related.length?'<p class="boss-note">作为以下首领的随行成员；下方概率属于首领波次，不能视为护卫独立刷新率。</p>':''}
    ${[...direct,...related].map(a=>appearanceHtml(a,catalog,{mapId,point})).join('')}
    </details>
    ${onLocate&&ids.length?`<details class="boss-locations"><summary>定位候选点 <small>${ids.length}</small></summary><div class="boss-location-list">${ids.map((id,i)=>`<button data-boss-point="${e(id)}">位置 ${i+1}${id.startsWith('boss-region:')?' · 区域参考':''}</button>`).join('')}</div></details>`:''}
    <h3>装备与携带物资</h3><div data-boss-inventory></div>
  </div>`;
  host.onclick=event=>{
    const roleButton=event.target.closest('[data-boss-role]');if(roleButton)onRole(roleButton.dataset.bossRole);
    const pointButton=event.target.closest('[data-boss-point]');if(pointButton)onLocate?.(pointButton.dataset.bossPoint);
  };
  renderBossInventory(host.querySelector('[data-boss-inventory]'),{catalog,roleId});
}
