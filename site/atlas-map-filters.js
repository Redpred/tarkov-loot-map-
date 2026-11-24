import {VALUE_BASES,highValuePreferences,valuableMapItems,searchValueItems} from './atlas-high-value-data.js';
import {getGameMode,subscribeGameMode} from './game-mode.js';
import {DEFAULT_POINT_TIERS,pointValuePreferences,pointTier,pointTierLabel,pointMatches,createPointValuation,pointModelClient,verifyPointModelSource,shortValue} from './atlas-point-values.js';
import {marketTime} from './atlas-market-client.js';
import {createMapMarketSession} from './atlas-map-market.js';

const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
export function createMapFilters({host,map,data,index,onChange}){
  const prefs=pointValuePreferences(read('atlas-point-value-preferences-v1'));
  const itemPrefs=highValuePreferences(read('atlas-high-value-preferences-v1'));
  // A fresh visit starts with all point tiers and the default expected metric.
  prefs.metric='expected';prefs.tiers=[0,1,2,3];prefs.unknown=false;prefs.kinds=['loose','container'];
  const session=createMapMarketSession({initialMode:getGameMode()});
  subscribeGameMode(mode=>session.load(mode));
  let dataset=null,modelPending=null,modelError='',values=new Map(),rows=[],priceIds=null,excluded=new Set(),itemQuery='',shown=60;
  let pointEnabled=false,itemEnabled=false,limitsValid=true,itemValid=true,activated=false;
  host.innerHTML=`<summary>价值筛选 <small id="valueFilterSummary">未启用</small></summary>
    <div class="map-price-context"><button type="button" id="mapPriceRefresh">刷新价格</button></div>
    <p id="mapPriceStatus" class="hint" role="status">筛选和点位详情共用价格</p>
    <div class="value-point-kinds"><label><input type="checkbox" data-value-kind="loose" checked>散落物资</label><label><input type="checkbox" data-value-kind="container" checked>可搜刮容器</label></div>
    <label class="filter-enable"><input id="enablePointValue" type="checkbox">按点位收益筛选</label>
    <div id="pointValueControls" hidden><label class="filter-field">分档依据<select id="mapValueMetric"><option value="expected">每局预估收益</option><option value="conditional">有货时价值</option></select></label>
    <div id="mapValueTiers" class="map-value-tiers"></div>
    <label class="filter-unknown"><input id="mapValueUnknown" type="checkbox">包含暂无法估价 <span id="mapUnknownCount">—</span></label>
    <details class="filter-custom"><summary>自定义档位与颜色</summary><div id="mapTierLimits" class="map-tier-limits"></div><div id="mapTierColors" class="map-tier-colors"></div><p id="mapTierError" class="filter-error" role="alert" hidden>请输入三个递增的正数；目前沿用上次有效档位。</p><button id="resetValueTiers" type="button">恢复默认档位</button></details>
    <p class="hint">售价取商人最高收购与跳蚤最低价的较高者。按整个点位计算，未扣手续费；估值不代表单局必得。</p></div>
    <details id="unitPriceAdvanced" class="filter-custom"><summary>高级：候选物品单价</summary><label class="filter-enable"><input id="enableItemPrice" type="checkbox">限定候选物品单价</label><div id="unitPriceControls" hidden><label class="filter-field">售价依据<select id="mapItemBasis"></select></label><label class="filter-field">单件至少 <span><input id="mapItemMinimum" type="number" min="0" max="1000000000" step="1" inputmode="decimal" aria-label="候选物品最低单价，单位 K"> K</span></label><p id="mapItemError" class="filter-error" role="alert" hidden>请输入 0–1,000,000,000 K；目前沿用上次有效单价。</p><p class="hint">与点位收益条件同时满足；不改变完整物资池的估值。</p><details class="filter-custom"><summary>选择符合价格的物品 <span id="mapPriceItemCount">0</span></summary><input id="mapPriceItemSearch" type="search" placeholder="在符合价格的物品中查找…" aria-label="查找符合价格的物品"><div class="type-actions"><button id="mapPriceItemsAll">全选搜索结果</button><button id="mapPriceItemsNone">取消搜索结果</button></div><div id="mapPriceItems" class="map-price-items"></div><button id="mapPriceItemsMore" hidden>显示更多</button></details></div></details>`;
  const $=id=>host.querySelector('#'+id);
  for(const check of host.querySelectorAll('[data-value-kind]'))check.onchange=()=>{prefs.kinds=[...host.querySelectorAll('[data-value-kind]:checked')].map(c=>c.dataset.valueKind);change();};
  const options=(select,entries)=>{for(const [id,name] of entries){const o=make('option','',name);o.value=id;select.append(o);}};
  options($('mapItemBasis'),VALUE_BASES);
  $('mapItemBasis').value=itemPrefs.basis;$('mapItemMinimum').value=itemPrefs.minimum/1000;
  const tierChecks=[],tierLabels=[],tierCounts=[],limits=[],colors=[];
  for(let i=0;i<4;i++){
    const label=make('label','map-value-tier'),check=make('input'),name=make('strong'),count=make('small','', '—');check.type='checkbox';check.checked=true;check.dataset.mapTier=i;
    label.append(check,name,count);$('mapValueTiers').append(label);tierChecks.push(check);tierLabels.push(name);tierCounts.push(count);
    check.onchange=()=>{prefs.tiers=tierChecks.flatMap((c,j)=>c.checked?[j]:[]);change();};
    const colorLabel=make('label','',`第 ${i+1} 档`),color=make('input');color.type='color';color.value=prefs.colors[i];color.setAttribute('aria-label',`第 ${i+1} 档颜色`);colorLabel.append(color);$('mapTierColors').append(colorLabel);colors.push(color);
    color.oninput=()=>{prefs.colors[i]=color.value;change();};
    if(i<3){const label=make('label','',`分界 ${i+1}`),input=make('input');input.type='number';input.min='.001';input.max='1000000000';input.step='any';input.inputMode='decimal';input.value=prefs.thresholds[i]/1000;input.setAttribute('aria-label',`收益分界 ${i+1}，单位 K`);label.append(input,make('span','','K'));$('mapTierLimits').append(label);limits.push(input);
      input.oninput=()=>{const next=limits.map(c=>c.value.trim()===''?NaN:Number(c.value)*1000);limitsValid=next.every((n,j)=>Number.isFinite(n)&&n>0&&n<=1e12&&(!j||n>next[j-1]));if(limitsValid)prefs.thresholds=next;change();};}
  }
  function renderRows(){
    const focused=$('mapPriceItems').contains(document.activeElement)?document.activeElement.dataset.pricedItem:null;
    $('mapPriceItemCount').textContent=`${rows.filter(row=>!excluded.has(row.tpl)).length} / ${rows.length}`;
    const found=searchValueItems(rows,itemQuery);$('mapPriceItems').replaceChildren();
    for(const row of found.slice(0,shown)){
      const label=make('label'),check=make('input'),name=make('span','',row.name),price=make('strong','',shortValue(row.value));check.type='checkbox';check.checked=!excluded.has(row.tpl);check.dataset.pricedItem=row.tpl;
      check.onchange=()=>{check.checked?excluded.delete(row.tpl):excluded.add(row.tpl);reprice();change();};label.append(check,name,price);$('mapPriceItems').append(label);
    }
    if(!found.length)$('mapPriceItems').append(make('p','hint',session.state.status==='ready'?'没有符合条件的物品。':'价格尚未就绪。'));
    $('mapPriceItemsMore').hidden=found.length<=shown;
    if(focused)$('mapPriceItems').querySelector(`[data-priced-item="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function reprice(){
    rows=session.state.market?valuableMapItems(index,session.state.market,itemPrefs.minimum,itemPrefs.basis):[];
    priceIds=itemEnabled?new Set(rows.filter(r=>!excluded.has(r.tpl)).map(r=>r.tpl)):null;renderRows();
  }
  function render(){
    const s=session.state;$('mapPriceRefresh').disabled=s.status==='loading';
    $('mapPriceStatus').textContent=s.status==='loading'?'正在获取全图价格…':s.status==='error'?'价格获取失败，请刷新重试。':modelError||(s.market?`${s.market.stale?'缓存价格 · ':''}${marketTime(s.market.fetchedAt)} · tarkov.dev`:'筛选和点位详情共用价格');
    if(pointEnabled&&modelPending)$('mapPriceStatus').textContent+=' · 加载点位估值…';
    $('enablePointValue').checked=pointEnabled;$('pointValueControls').hidden=!pointEnabled;
    $('enableItemPrice').checked=itemEnabled;$('unitPriceControls').hidden=!itemEnabled;
    $('valueFilterSummary').textContent=pointEnabled?(prefs.metric==='expected'?'每局收益':'有货时价值')+(itemEnabled?' + 单价':''):itemEnabled?'物品单价':'未启用';
    $('mapValueMetric').value=prefs.metric;$('mapValueUnknown').checked=prefs.unknown;
    tierLabels.forEach((label,i)=>{label.textContent=pointTierLabel(i,prefs.thresholds);label.style.color=prefs.colors[i];tierChecks[i].checked=prefs.tiers.includes(i);});
    $('mapTierError').hidden=limitsValid;$('mapItemError').hidden=itemValid;
    for(const input of limits)input.setAttribute('aria-invalid',String(!limitsValid));$('mapItemMinimum').setAttribute('aria-invalid',String(!itemValid));
  }
  function change(){render();save('atlas-point-value-preferences-v1',{...prefs,mode:session.state.mode});save('atlas-high-value-preferences-v1',{...itemPrefs,mode:session.state.mode});onChange();}
  async function ensureModel(){
    if(dataset||modelPending)return modelPending;modelError='';
    modelPending=pointModelClient.load(map.id).then(d=>{verifyPointModelSource(d,data);dataset=d;if(session.state.market)values=createPointValuation(d,session.state.market);}).catch(()=>{modelError='点位估值资料暂不可用，请刷新重试。';}).finally(()=>{modelPending=null;change();});render();return modelPending;
  }
  $('enablePointValue').onchange=()=>{pointEnabled=$('enablePointValue').checked;if(pointEnabled){ensureModel();session.ensure();}change();};
  $('enableItemPrice').onchange=()=>{itemEnabled=$('enableItemPrice').checked;if(itemEnabled)session.ensure();reprice();change();};
  $('mapPriceRefresh').onclick=()=>{if(pointEnabled)ensureModel();session.load(session.state.mode,{reload:true});};
  $('mapValueMetric').onchange=()=>{prefs.metric=$('mapValueMetric').value;change();};
  $('mapValueUnknown').onchange=()=>{prefs.unknown=$('mapValueUnknown').checked;change();};
  $('mapItemBasis').onchange=()=>{itemPrefs.basis=$('mapItemBasis').value;reprice();change();};
  $('mapItemMinimum').oninput=()=>{const n=$('mapItemMinimum').value.trim()===''?NaN:Number($('mapItemMinimum').value)*1000;itemValid=Number.isFinite(n)&&n>=0&&n<=1e12;if(itemValid){itemPrefs.minimum=n;reprice();}change();};
  $('resetValueTiers').onclick=()=>{prefs.thresholds=[...DEFAULT_POINT_TIERS.thresholds];prefs.colors=[...DEFAULT_POINT_TIERS.colors];limitsValid=true;limits.forEach((c,i)=>c.value=prefs.thresholds[i]/1000);colors.forEach((c,i)=>c.value=prefs.colors[i]);change();};
  $('mapPriceItemSearch').oninput=()=>{itemQuery=$('mapPriceItemSearch').value;shown=60;renderRows();};
  $('mapPriceItemsAll').onclick=()=>{for(const row of searchValueItems(rows,itemQuery))excluded.delete(row.tpl);reprice();change();};
  $('mapPriceItemsNone').onclick=()=>{for(const row of searchValueItems(rows,itemQuery))excluded.add(row.tpl);reprice();change();};
  $('mapPriceItemsMore').onclick=()=>{shown+=60;renderRows();};
  session.subscribe(s=>{save('atlas-map-price-mode-v1',s.mode);values=dataset&&s.market?createPointValuation(dataset,s.market):new Map();reprice();render();onChange();});
  return {session,get pointEnabled(){return pointEnabled;},get itemEnabled(){return itemEnabled;},get priceIds(){return priceIds;},get metric(){return prefs.metric;},
    get ready(){return Boolean(dataset&&session.state.market);},get blocked(){return (pointEnabled&&(!dataset||!session.state.market))||(itemEnabled&&!session.state.market);},
    activate(){if(activated)return;activated=true;pointEnabled=true;ensureModel();session.ensure();change();},
    matchesKind:p=>prefs.kinds.includes(p.kind),
    matches:p=>prefs.kinds.includes(p.kind)&&(!pointEnabled||Boolean(dataset&&session.state.market&&pointMatches(p,values.get(p.id),prefs))),value:p=>values.get(p.id),
    color(p){if(!pointEnabled||!dataset||!session.state.market||p.kind==='poi')return null;const t=pointTier(values.get(p.id)?.[prefs.metric],prefs.thresholds);return t===null?'#84939f':prefs.colors[t];},
    compare:(a,b)=>(values.get(b.id)?.[prefs.metric]??-1)-(values.get(a.id)?.[prefs.metric]??-1),
    reset(){pointEnabled=itemEnabled=false;excluded.clear();reprice();change();},
    disablePoint(){pointEnabled=false;change();},disableItem(){itemEnabled=false;reprice();change();},
    selection:()=>({pointEnabled,itemEnabled,...prefs,mode:session.state.mode,fetchedAt:session.state.market?.fetchedAt,item:{...itemPrefs,excludedIds:[...excluded]}}),
    counts(points){const counts=[0,0,0,0];let unknown=0;for(const p of points){const tier=pointTier(values.get(p.id)?.[prefs.metric],prefs.thresholds);tier===null?unknown++:counts[tier]++;}tierCounts.forEach((el,i)=>el.textContent=dataset&&session.state.market?`${counts[i]} 点`:'—');$('mapUnknownCount').textContent=dataset&&session.state.market?`${unknown} 点`:'—';},
    chips(){return [...(pointEnabled?[{label:`${prefs.metric==='expected'?'每局收益':'有货时价值'}：${prefs.tiers.length===4?'全部档位':prefs.tiers.map(i=>pointTierLabel(i,prefs.thresholds)).join(' / ')||'未选档位'}${prefs.unknown?' · 含未知':''}`,remove:()=>{pointEnabled=false;change();}}]:[]),...(itemEnabled?[{label:`候选单价 ≥ ${shortValue(itemPrefs.minimum)}${excluded.size?' · 已排除部分物品':''}`,remove:()=>{itemEnabled=false;reprice();change();}}]:[])];}
  };
}

export function renderFilterStatus({host,lootCount,auxCount,overlap,chips,suggestions=[],blocked=false}){
  const signature=JSON.stringify([lootCount,auxCount,overlap,chips.map(c=>c.label),suggestions.map(c=>c.label),blocked]);
  // Keep focused remove buttons stable on marker-only refreshes.
  if(host.dataset.signature===signature)return;const wasOpen=host.querySelector('details')?.open;host.dataset.signature=signature;host.replaceChildren();
  const row=make('div','filter-counts');row.append(make('strong','',`物资 ${lootCount}`),make('span','',`辅助 ${auxCount}`));row.title=overlap?`${overlap} 个位置同时匹配物资和辅助图层，已去重计入物资。`:'分别计数，同一位置只显示一次';host.append(row);
  const details=make('details','active-filter-details'),summary=make('summary','',chips.length?`当前条件 ${chips.length} 项`:'全部物资 · 未限定条件');details.open=wasOpen??false;details.append(summary);host.append(details);
  const list=make('div','active-filter-chips');for(const chip of chips){const button=make('button','',chip.label+' ×');button.type='button';button.title='移除：'+chip.label;button.setAttribute('aria-label','移除：'+chip.label);button.onclick=chip.remove;list.append(button);}details.append(list);
  if(lootCount===0){const empty=make('div','filter-empty');empty.append(make('p','',blocked?'价格或估值尚未就绪，物资结果暂不可用。':'没有匹配的物资点位。'));if(auxCount)empty.append(make('small','',`地图仍显示 ${auxCount} 个辅助点位。`));for(const suggestion of suggestions){const button=make('button','',suggestion.label);button.type='button';button.onclick=suggestion.remove;empty.append(button);}host.append(empty);}
}
