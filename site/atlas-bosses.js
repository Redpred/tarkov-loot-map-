import {bossKey,roleById,bossPointEligible,bossPointSelected} from './boss-data.js';
import {escapeBoss as e,renderBossDetails} from './boss-ui.js';
import {getGameMode,subscribeGameMode} from './game-mode.js';

export function createMapBosses({catalog,map,selection,host,details,foldout,onChange,onOpen,onLocate}){
  let variant='',currentRole='',currentPoint=null;
  const rangeCache=new WeakMap();
  const section=document.createElement('div');section.id='bossSection';section.className='type-group';
  const appearances=catalog.appearances.filter(a=>a.mapId===map.mapId);
  const variants=[...new Map(appearances.map(a=>[a.location,a.variant])).entries()];
  const hasDarkScene=variants.some(([id])=>id==='laboratory_dark');
  const members=[...new Set([...map.roleIds,...appearances.flatMap(a=>a.companions.filter(c=>['followerbigpipe','followerbirdeye'].includes(c.role)).map(c=>c.role))])];
  const memberLabel=id=>{
    const related=appearances.filter(a=>a.role===id||a.companions.some(c=>c.role===id));
    const suffix=related.length&&related.every(a=>a.context?.kind==='history')?'（历史活动）':
      related.length&&related.every(a=>a.location==='laboratory_dark')?'（停电记录）':'';
    return e((roleById(catalog,id)?.name||id)+suffix);
  };
  section.innerHTML=`<div class="type-group-heading"><input type="checkbox" data-boss-all aria-label="BOSS全选"><button type="button" class="type-group-toggle" aria-controls="typeGroup-boss" aria-expanded="false">BOSS</button></div>
    <div class="type-group-options" id="typeGroup-boss" hidden>
    ${variants.length>1||hasDarkScene?`<label class="boss-variant">场景<select aria-label="BOSS 场景"><option value="">${hasDarkScene?'常规场景记录':'全部场景记录'}</option>${variants.map(([id,name])=>`<option value="${e(id)}">${e(name)}${id==='laboratory_dark'?'（条件待核验）':''}</option>`).join('')}</select></label>`:variants.length?`<p class="boss-note">记录场景：${e(variants[0][1])}</p>`:''}
    <div class="boss-map-list">${members.map(id=>`<div class="boss-map-row"><label><input type="checkbox" data-boss-select="${e(id)}"><span>${memberLabel(id)}</span></label></div>`).join('')}</div>
    <p class="boss-note">选中点位时显示其关联范围；区域参考点不补造边界。</p><p class="boss-mode-note boss-note" role="status"></p></div>`;
  host.append(section);
  const parent=section.querySelector('[data-boss-all]'),toggle=section.querySelector('.type-group-toggle'),content=section.querySelector('.type-group-options');
  if(foldout)foldout(toggle,content,'boss');else toggle.onclick=()=>{content.hidden=!content.hidden;toggle.setAttribute('aria-expanded',String(!content.hidden));};
  function sync(){for(const input of section.querySelectorAll('[data-boss-select]'))input.checked=selection.keys.has(bossKey(input.dataset.bossSelect));
    const selectedCount=members.filter(id=>selection.keys.has(bossKey(id))).length;
    parent.checked=members.length>0&&selectedCount===members.length;parent.indeterminate=selectedCount>0&&selectedCount<members.length;parent.disabled=!members.length;
    const count=map.points.filter(p=>bossPointEligible(p,catalog,getGameMode(),variant)).length;
    section.querySelector('.boss-mode-note').textContent=variant==='laboratory_dark'?'正在查看停电场景的全部留存位置，不按当前模式筛选。新旧记录的模式标记不同；这些点位不代表当前可刷新。':count?`${count} 个候选或参考位置符合地图资料版本的模式标记。`:hasDarkScene?'常规场景暂无已核验 BOSS 点位；停电记录需手动选择场景查看。':'当前选择没有已核验点位。';
  }
  const api={
    matches:p=>bossPointSelected(p,catalog,selection.keys,getGameMode(),variant),
    eligible:p=>bossPointEligible(p,catalog,getGameMode(),variant),
    rangeEntry(p){if(!p?.range)return null;if(!rangeCache.has(p))rangeCache.set(p,{...p,volumes:[p.range]});return rangeCache.get(p);},
    rangeEntries(points,selected){return points.filter(p=>p.bossPoint&&p.range&&p===selected).map(p=>api.rangeEntry(p));},
    openRole(id,point=null){currentRole=id;currentPoint=point;onOpen(point);renderBossDetails(details,{catalog,roleId:id,mapId:map.mapId,point,onRole:next=>api.openRole(next),onLocate});details.scrollTop=0;},
    openPoint(p,roleId){const refs=p.bossRefs.filter(r=>catalog.appearances.some(a=>a.id===r.appearanceId&&a.modes.includes(getGameMode())&&(!variant||a.location===variant)));const id=roleId||refs[0]?.role||p.bossRefs[0]?.role;
      api.openRole(id,p);
      if(refs.length>1){const bar=document.createElement('div');bar.className='boss-point-roles';for(const rid of new Set(refs.map(r=>r.role))){const button=document.createElement('button');button.textContent=roleById(catalog,rid)?.name||rid;button.onclick=()=>api.openPoint(p,rid);bar.append(button);}details.prepend(bar);}
    },
    enable(id){
      const related=appearances.filter(a=>a.role===id||a.companions.some(c=>c.role===id));
      if(related.length&&related.every(a=>a.location==='laboratory_dark')){
        variant='laboratory_dark';const select=section.querySelector('select');if(select)select.value=variant;
      }
      selection.set(bossKey(id),true);if(content.hidden)toggle.click();const types=host.closest('details');if(types)types.open=true;
    },
    keys:members.map(bossKey),
  };
  section.onchange=event=>{
    const el=event.target;
    if(el.hasAttribute('data-boss-all'))selection.setMany(members.map(bossKey),el.checked);
    if(el.dataset.bossSelect)selection.set(bossKey(el.dataset.bossSelect),el.checked);
    if(el.matches('select'))variant=el.value;
    sync();onChange();
  };
  selection.subscribe(sync);
  subscribeGameMode(()=>{sync();onChange();if(currentRole&&details.querySelector('.boss-detail'))api.openRole(currentRole,currentPoint);});
  sync();return api;
}
