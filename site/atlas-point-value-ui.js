import {MARKET_MODES} from './atlas-high-value-data.js';
import {marketTime,marketModeName} from './atlas-market-client.js';
import {DEFAULT_POINT_TIERS,POINT_VALUE_REASONS,shortValue,stockPercent,pointValuePreferences,pointTier,pointTierLabel,createPointValuation,pointMatches,createPointValueSelection,pointModelClient,valuePoint,valueContent,verifyPointModelSource} from './atlas-point-values.js';

const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const storage='atlas-point-value-preferences-v1';
export function createPointValuePanel({map,data,client,onApply,onCancel,onClose,pointName}){
  const selection=createPointValueSelection();let saved;try{saved=JSON.parse(localStorage.getItem(storage));}catch{}
  let preferences=pointValuePreferences(saved),market,dataset,values=new Map(),busy=false,request=0,error='',valid=true,shown=60;
  const element=make('div','point-value-panel'),controls=make('div','point-value-controls'),modes=make('div','high-value-modes');modes.setAttribute('aria-label','点位估值价格模式');
  for(const [id,name] of MARKET_MODES){const b=make('button','',name);b.type='button';b.dataset.pointValueMode=id;b.onclick=()=>{preferences.mode=id;load();};modes.append(b);}
  const metricLabel=make('label','point-value-metric','分档依据'),metric=make('select');metric.id='pointValueMetric';
  for(const [id,name] of [['expected','每局预估收益'],['conditional','有货时价值']]){const option=make('option','',name);option.value=id;metric.append(option);}metricLabel.append(metric);
  const note=make('p','point-value-note','每局预估收益 = 有货概率 × 有货时平均价值。按整个点位计算，未扣手续费。');
  const kinds=make('div','high-value-kinds');for(const [id,name] of [['container','容器'],['loose','散落物资']]){const label=make('label','high-value-check'),check=make('input');check.type='checkbox';check.dataset.pointValueKind=id;check.onchange=()=>{preferences.kinds=[...kinds.querySelectorAll('input:checked')].map(c=>c.dataset.pointValueKind);render();};label.append(check,make('span','',name));kinds.append(label);}
  const tiers=make('div','point-value-tiers'),tierChecks=[],tierColors=[],tierLabels=[],tierCounts=[];
  for(let i=0;i<4;i++){const card=make('div','point-value-tier'),label=make('label'),check=make('input'),color=make('input'),text=make('strong'),count=make('small');check.type='checkbox';check.dataset.pointValueTier=i;color.type='color';color.setAttribute('aria-label',`第 ${i+1} 档颜色`);check.onchange=()=>{preferences.tiers=tierChecks.flatMap((c,j)=>c.checked?[j]:[]);render();};color.oninput=()=>{preferences.colors[i]=color.value;render();};label.append(check,text,count);card.append(label,color);tiers.append(card);tierChecks.push(check);tierColors.push(color);tierLabels.push(text);tierCounts.push(count);}
  const settings=make('details','point-value-settings'),settingsTitle=make('summary','','调整分界与颜色'),limits=make('div','point-value-limits'),limitInputs=[];
  for(let i=0;i<3;i++){const label=make('label','',`分界 ${i+1}`),input=make('input');input.type='number';input.min='0.001';input.max='1000000000';input.step='1';input.inputMode='decimal';input.setAttribute('aria-label',`点位价值分界 ${i+1}，单位 K`);limitInputs.push(input);label.append(input,make('span','','K'));limits.append(label);input.oninput=()=>{const next=limitInputs.map(input=>input.value.trim()===''?NaN:Number(input.value)*1000);valid=next.every((n,j)=>Number.isFinite(n)&&n>0&&n<=1e12&&(!j||n>next[j-1]));if(valid)preferences.thresholds=next;render();};}
  const reset=make('button','','恢复默认档位');reset.type='button';reset.onclick=()=>{preferences.thresholds=[...DEFAULT_POINT_TIERS.thresholds];preferences.colors=[...DEFAULT_POINT_TIERS.colors];valid=true;syncInputs();render();};limits.append(reset);settings.append(settingsTitle,limits);
  const unknownLabel=make('label','high-value-check point-value-unknown'),unknown=make('input'),unknownText=make('span');unknown.type='checkbox';unknown.setAttribute('aria-label','显示暂无法估价的点位');unknown.onchange=()=>{preferences.unknown=unknown.checked;render();};unknownLabel.append(unknown,unknownText);
  const status=make('p','point-value-status');status.setAttribute('role','status');controls.append(modes,metricLabel,note,kinds,tiers,settings,unknownLabel,status);
  const scroll=make('div','high-value-scroll point-value-scroll'),table=make('table','point-value-table'),head=make('thead'),tr=make('tr');
  for(const title of ['点位','每局预估收益','有货概率','有货时价值'])tr.append(make('th','',title));head.append(tr);const body=make('tbody');table.append(head,body);const more=make('button','high-value-more','显示更多');more.type='button';more.onclick=()=>{shown+=60;render();};scroll.append(table,more);
  const footer=make('div','high-value-footer'),source=make('p','high-value-source'),actions=make('div','high-value-actions'),refresh=make('button','','刷新价格'),cancel=make('button','','取消筛选'),back=make('button','','返回'),apply=make('button','high-value-apply','确定');
  for(const b of [refresh,cancel,back,apply])b.type='button';refresh.onclick=()=>load(true);cancel.onclick=onCancel;back.onclick=onClose;
  apply.onclick=()=>{if(busy||!valid||!market||!dataset)return;selection.apply({preferences,market,values});saved=pointValuePreferences(preferences);try{localStorage.setItem(storage,JSON.stringify(preferences));}catch{}onApply();};actions.append(refresh,cancel,back,apply);footer.append(source,actions);element.append(controls,scroll,footer);
  metric.onchange=()=>{preferences.metric=metric.value;render();};
  const points=data.points.filter(p=>p.position&&!p.outsideClientEnvelope&&['container','loose'].includes(p.kind));
  function syncInputs(){metric.value=preferences.metric;limitInputs.forEach((input,i)=>input.value=preferences.thresholds[i]/1000);}
  function render(){
    for(const b of modes.children)b.setAttribute('aria-pressed',String(b.dataset.pointValueMode===preferences.mode));
    for(const input of kinds.querySelectorAll('input'))input.checked=preferences.kinds.includes(input.dataset.pointValueKind);
    unknown.checked=preferences.unknown;cancel.hidden=!selection.active&&!document.getElementById('openHighValue')?.classList.contains('active');
    const counts=[0,0,0,0];let unknownCount=0;for(const p of points){if(!preferences.kinds.includes(p.kind))continue;const tier=pointTier(values.get(p.id)?.[preferences.metric],preferences.thresholds);if(tier==null)unknownCount++;else counts[tier]++;}
    tierChecks.forEach((c,i)=>{c.checked=preferences.tiers.includes(i);tierColors[i].value=preferences.colors[i];tierLabels[i].textContent=pointTierLabel(i,preferences.thresholds);tierLabels[i].style.color=preferences.colors[i];tierCounts[i].textContent=market?`${counts[i]} 个点位`:'—';c.setAttribute('aria-label',`筛选 ${pointTierLabel(i,preferences.thresholds)} 点位`);});
    unknownText.textContent=`暂无法估价${market?`（${unknownCount}）`:''}`;
    const rows=points.filter(p=>pointMatches(p,values.get(p.id),preferences)).sort((a,b)=>(values.get(b.id)?.[preferences.metric]??-1)-(values.get(a.id)?.[preferences.metric]??-1)||a.id.localeCompare(b.id));
    status.textContent=!valid?'三个分界须为递增的正数。':busy?'正在计算点位估值…':error||`匹配 ${rows.length} 个点位 · 地图仍保留当前高度范围`;
    apply.disabled=busy||!valid||!market||!dataset;refresh.disabled=busy;apply.textContent=market&&!busy?`确定（${rows.length}）`:'确定';
    body.replaceChildren();for(const p of rows.slice(0,shown)){const v=values.get(p.id),row=make('tr'),name=make('td'),title=make('strong','',pointName(p)),sub=make('small','',`${p.kind==='container'?'容器':'散落'} · ${p.position.y.toFixed(1)} m`);name.append(title,sub);row.append(name);
      for(const key of ['expected','stock','conditional']){const cell=make('td','',key==='stock'?stockPercent(v?.stock):shortValue(v?.[key]));cell.dataset.label={expected:'每局预估收益',stock:'有货概率',conditional:'有货时价值'}[key];if(key===preferences.metric){const tier=pointTier(v?.[key],preferences.thresholds);cell.style.color=tier==null?'#95a4af':preferences.colors[tier];cell.className='point-value-number';}row.append(cell);}body.append(row);}
    more.hidden=rows.length<=shown||busy;source.textContent=`模型估计 · 非活动期 · 各模式共用同一概率模型${market?` · ${marketModeName(market.mode)} · ${market.stale?'缓存报价 · ':''}${marketTime(market.fetchedAt)}`:''}。缺资料或缺价的点位单独显示。`;
  }
  async function load(reload=false){const epoch=++request,mode=preferences.mode;busy=true;error='';market=null;values=new Map();render();try{const [d,m]=await Promise.all([pointModelClient.load(map.id),client.load(mode,{reload})]);if(epoch!==request)return;verifyPointModelSource(d,data);dataset=d;market=m;values=createPointValuation(d,m);}catch{if(epoch!==request)return;error='估值资料或价格获取失败，请刷新重试。';}busy=false;render();}
  return {element,selection,open({reset=true}={}){if(reset){preferences=pointValuePreferences(selection.current||saved);valid=true;shown=60;syncInputs();}if(reset||!market)load();else render();},cancel(){selection.cancel();},get mode(){return preferences.mode;}};
}

export function attachPointValueSummary(details,point,map){
  const panel=make('section','point-value-detail'),heading=make('div','point-value-detail-heading');heading.append(make('h3','','点位价值'),make('span','','模型估计'));
  const stats=make('dl','point-value-detail-stats'),note=make('p','point-value-detail-note','正在加载估值资料…'),contributions=make('details','point-value-contributions'),summary=make('summary','','主要价值贡献'),list=make('ol');contributions.append(summary,list);panel.append(heading,stats,note,contributions);details.querySelector('.detail-divider').before(panel);
  let dataset,market;
  pointModelClient.load(map.id).then(d=>{verifyPointModelSource(d,map);dataset=d;render();}).catch(()=>{if(panel.isConnected)note.textContent='点位估值资料暂不可用。';});
  function render(){if(!panel.isConnected||!dataset||!market)return;const record=dataset.points[point.id],model=dataset.models[record?.model],content=valueContent(model,market),v=valuePoint(record,model,content);stats.replaceChildren();
    for(const [label,text] of [['每局预估收益',shortValue(v.expected)],['有货概率',stockPercent(v.stock)],['有货时价值',shortValue(v.conditional)]]){const item=make('div');item.append(make('dt','',label),make('dd','',text));stats.append(item);}
    const reasons=v.issues.map(code=>POINT_VALUE_REASONS[code]||'估值资料不完整');
    note.textContent=`${marketModeName(market.mode)} · ${marketTime(market.fetchedAt)}${market.stale?' · 缓存报价':''}。${reasons.length?[...new Set(reasons)].join('；')+'。':`每局平均 ${Number(v.count||0).toLocaleString('zh-CN',{maximumFractionDigits:2})} 件。`}${v.expected==null&&v.knownExpected>0?`已知部分每局约 ${shortValue(v.knownExpected)}，不参与普通分档。`:''}概率为非活动期模型估计，各价格模式共用；并非已核实的实际对局刷新率。`;
    contributions.hidden=!content.contributions.length;list.replaceChildren();for(const row of content.contributions.slice(0,5)){const item=make('li'),name=make('span','',map.items?.[row.tpl]?.zh||row.tpl),value=make('strong','',Number.isFinite(record?.probability)?shortValue(row.value*record.probability):'—');item.append(name,value);list.append(item);}summary.textContent='主要价值贡献（每局）';
  }
  return {loading(){market=null;stats.replaceChildren();list.replaceChildren();contributions.hidden=true;note.textContent='正在获取所选模式的价格…';},market(value){market=value;render();},error(){market=null;stats.replaceChildren();contributions.hidden=true;note.textContent='价格暂不可用，请刷新重试。';}};
}
