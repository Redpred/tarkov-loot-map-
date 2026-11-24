import {loadEncyclopediaManifest,fetchEncyclopediaResource,filterEntries,labelField,fieldNames,groupBossEntries} from './encyclopedia-data.js';
import {fieldNotes,itemFieldGroups,translatedValue,caliberLabel} from './encyclopedia-fields.js';
import {bossName,bossContext,bossBriefing,presentBossWave,LAB_CONTEXT} from './boss-presentation.js';
import {atlasMapHref} from './atlas-maps.js';
import {escapeBoss as e,mapBossLink,renderBossInventory,bossInventoryChoices,readableBossFacts} from './boss-ui.js';
import {loadBossData} from './boss-data.js';
import {readerLabel,readerNote,formatNumber,duration,enumText,isTechnical,isIdentifier,presentEntry,sectionNote,languages,readableNumber} from './encyclopedia-reader.js';
import {describeBuff,rewardItem,paymentText,timecode,requirementExtra,currencies} from './encyclopedia-explain.js';

const $=id=>document.getElementById(id),number=n=>Number(n).toLocaleString('zh-CN');
const modes={regular:'PvP 常规',pve:'PvE','pvp-season':'PvP 赛季'};
const icons={items:'◈',bosses:'⌖',maps:'⌖',crafts:'◇',hideout:'⌂',prestige:'☆',customization:'◇',mechanics:'≡',presets:'⊞',market:'₽',handbook:'▤',story:'▤',media:'▷',languages:'文'};
let manifest,sectionId='items',rows=[],shown=[],page=1,loadToken=0,detailToken=0,itemsById=new Map();
let displayNames={},readerContext={},buffGroups={},bossCatalogPromise;
const cache=new Map(),size=30;
async function resource(info){
  if(!cache.has(info.file))cache.set(info.file,fetchEncyclopediaResource(info).catch(error=>{cache.delete(info.file);throw error;}));
  return cache.get(info.file);
}
const section=()=>manifest.sections.find(s=>s.id===sectionId);
function setUrl({entry}={}){
  const url=new URL(location.href);url.searchParams.set('section',sectionId);
  const values={q:$('encyclopediaSearch').value,group:$('groupFilter').value,kind:sectionId==='items'?$('kindFilter').value:'',sort:$('encyclopediaSort').value,
    view:sectionId==='bosses'?$('bossView').value:'',scope:sectionId==='bosses'?$('bossScope').value:'',mode:sectionId==='bosses'?$('bossMode').value:'',entry};
  for(const [key,value] of Object.entries(values))value?url.searchParams.set(key,value):url.searchParams.delete(key);
  history.replaceState(null,'',url);
}
function card(r){
  const context=r.context||null;
  const value=r.waves?`${r.locations} 个场景 · ${r.waves.length} 条波次记录`
    :r.chance!=null?(context?.showRate?`波次配置值 ${r.chance}%`:context?.label||'生成条件待核验')
    :r.price!=null?`手册基准价 ${number(r.price)} 卢布`:'';
  const badges=r.contexts||(context?[context.label]:[]);
  return `<button class="entry-card${r.waves?' boss-card':''}" data-entry="${e(r.id)}" aria-label="查看 ${e(r.name)}">
    ${r.icon?`<span class="entry-image"><img src="${e(r.icon)}" alt="" loading="lazy" width="64" height="64"></span>`:`<span class="entry-symbol" aria-hidden="true">${icons[sectionId]}</span>`}
    <span class="entry-copy"><small class="entry-category">${e(r.group)}</small><strong>${e(r.name)}</strong>
    ${r.subtitle?`<small>${e(enumText(r.subtitle,'Caliber'))}</small>`:''}
    ${r.facts?`<span class="entry-facts">${r.facts.filter(([,v])=>v!=null).map(([k,v])=>`<span>${e(k)} <b>${e(v)}</b></span>`).join('')}</span>`:''}
    ${value?`<small class="entry-value">${e(value)}</small>`:''}
    ${badges.length?`<span class="entry-badges">${badges.map(s=>`<span>${e(s)}</span>`).join('')}</span>`:''}
    ${r.enabled===false?'<small class="disabled-record">未启用场景配置</small>':''}</span><span class="entry-arrow" aria-hidden="true">↗</span></button>`;
}
function render(){
  const filtered=filterEntries(rows,{query:$('encyclopediaSearch').value,group:$('groupFilter').value,
    kind:sectionId==='items'?$('kindFilter').value:'all',sort:$('encyclopediaSort').value,
    scope:sectionId==='bosses'?$('bossScope').value:'all',mode:sectionId==='bosses'?$('bossMode').value:''});
  shown=sectionId==='bosses'&&$('bossView').value==='roles'?groupBossEntries(filtered):filtered;
  const pages=Math.max(1,Math.ceil(shown.length/size));page=Math.min(page,pages);
  $('resultCount').textContent=sectionId==='bosses'&&$('bossView').value==='roles'?`${number(shown.length)} 类敌人 · ${number(filtered.length)} 条波次`:`${number(shown.length)} 条资料`;
  $('encyclopediaResults').classList.toggle('boss-results',sectionId==='bosses');
  $('encyclopediaResults').innerHTML=shown.slice((page-1)*size,page*size).map(card).join('');
  $('encyclopediaStatus').textContent=shown.length?'':'没有匹配的资料，请调整关键词或分类。';
  $('pageNumber').textContent=`${page} / ${pages}`;$('previousPage').disabled=page<=1;$('nextPage').disabled=page>=pages;
}
async function chooseSection(id,params=new URLSearchParams()){
  if(!manifest.sections.some(s=>s.id===id))id='items';
  sectionId=id;const token=++loadToken;page=1;rows=[];shown=[];
  $('sectionTitle').textContent=section().title;$('sectionNote').textContent=sectionNote(id,section().note);
  $('sectionMetrics').innerHTML=(section().metrics||[]).map(([n,label])=>`<span><b>${number(n)}</b> ${e(label.replace(/声望/g,'转生'))}</span>`).join('');
  $('encyclopediaResults').innerHTML='';$('encyclopediaStatus').textContent='正在加载资料…';$('resultCount').textContent='';
  $('previousPage').disabled=true;$('nextPage').disabled=true;$('encyclopediaSearch').value=params.get('q')||'';
  $('kindFilter').hidden=id!=='items';$('kindFilter').value=['items','ammo','quest','market','all'].includes(params.get('kind'))?params.get('kind'):'items';
  $('bossView').hidden=$('bossScope').hidden=$('bossMode').hidden=id!=='bosses';
  $('bossView').value=params.get('view')==='waves'?'waves':'roles';
  $('bossScope').value=['all','configuration','history','event','conditional','disabled'].includes(params.get('scope'))?params.get('scope'):'all';
  $('bossMode').value=['regular','pve','pvp-season'].includes(params.get('mode'))?params.get('mode'):'';
  $('encyclopediaSort').innerHTML='<option value="name">名称排序</option>'+(id==='items'?'<option value="price">基准价从高到低</option>':'');
  $('encyclopediaSort').value=id==='items'&&params.get('sort')==='price'?'price':'name';
  $('groupFilter').innerHTML=`<option value="">${id==='bosses'?'全部地图':'全部类别'}</option>`;
  $('bossGuide').hidden=id!=='bosses';
  for(const a of $('sectionNav').querySelectorAll('a'))a.setAttribute('aria-current',a.dataset.section===id?'page':'false');
  try{
    const loaded=await resource(section().resource);if(token!==loadToken)return;rows=loaded.map((r,i)=>presentEntry(id==='bosses'?presentBossWave(r):r,id,displayNames,i));
    for(const group of [...new Set(rows.map(r=>r.group))].sort((a,b)=>a.localeCompare(b,'zh-CN'))){const option=document.createElement('option');option.value=group;option.textContent=group;$('groupFilter').append(option);}
    $('groupFilter').value=[...$('groupFilter').options].some(o=>o.value===params.get('group'))?params.get('group'):'';
    render();setUrl({entry:params.get('entry')});
    const entry=rows.find(r=>r.id===params.get('entry'))||groupBossEntries(id==='bosses'?rows:[]).find(r=>r.id===params.get('entry'));
    if(entry)await openEntry(entry);
  }catch(error){if(token!==loadToken)return;$('encyclopediaStatus').innerHTML=`${e(error.message)}。<button id="retrySection">重试</button>`;$('retrySection').onclick=()=>chooseSection(id,params);}
}
function valueHtml(value,key='',path=''){
  if(value===null||value===undefined)return '<span class="muted">未提供</span>';
  if(typeof value==='boolean')return value?'是':'否';
  if(typeof value==='string'&&itemsById.has(value))return `<a href="encyclopedia.html?section=items&kind=all&entry=${encodeURIComponent(value)}" data-item="${e(value)}">${e(itemsById.get(value).name)}</a>`;
  if(['area','areaType'].includes(key)&&manifest.areas[value])return e(manifest.areas[value]);
  if(['BossName','BossEscortType','Role'].includes(key))return e(bossName(value));
  if(typeof value==='number')return e(formatNumber(value,key,path));
  if(value==='')return '<span class="muted">未设置</span>';
  const translated=enumText(String(value),key,path,displayNames);
  if(translated!==String(value))return e(translated);
  if(displayNames[value])return e(displayNames[value]);
  if(isIdentifier(value))return '<span class="muted">名称尚未收录</span>';
  return e(enumText(String(value),key,path,displayNames));
}
function fieldHeading(key,path=''){
  if(path.endsWith('FenceSettings.Levels'))return e(`声望档 ${key}`);
  if(/^\d+$/.test(key))return `第 ${Number(key)+1} 项`;
  if(itemsById.has(key))return e(itemsById.get(key).name);
  return e(readerLabel(key,path,displayNames)||'未解释的参数');
}
function renderFields(host,data,parentKey='',{notes=true,path=sectionId}={}){
  const original=data&&typeof data==='object'?Object.entries(data):[['value',data]];
  const pairs=original.filter(([k,v])=>/^-?\d+$/.test(k)||(!isTechnical(k)&&Boolean(readerLabel(k,path,displayNames)||itemsById.has(k))&&v!==null&&v!==''));
  const simple=pairs.filter(([,v])=>!v||typeof v!=='object'||Array.isArray(v)&&v.every(x=>x===null||typeof x!=='object'));
  if(simple.length){
    const table=document.createElement('table');table.className='field-table';
    table.innerHTML='<tbody>'+simple.map(([k,v])=>`<tr><th scope="row">${fieldHeading(k,path)}${notes&&readerNote(k,path)?`<details class="field-help"><summary>说明</summary><p>${e(readerNote(k,path))}</p></details>`:''}</th><td>${Array.isArray(v)?(v.length?v.map(x=>valueHtml(x,Array.isArray(data)?parentKey:k,path)).join('、'):'<span class="muted">未列出条目</span>'):valueHtml(v,Array.isArray(data)?parentKey:k,path)}</td></tr>`).join('')+'</tbody>';host.append(table);
  }
  for(const [key,value] of pairs.filter(([,v])=>v&&typeof v==='object'&&!(Array.isArray(v)&&v.every(x=>x===null||typeof x!=='object')))){
    const details=document.createElement('details');details.className='detail-section';
    const title=path.endsWith('FenceSettings.Levels')?`声望档 ${key}`:Array.isArray(data)?(displayNames[value.Name]||displayNames[value.name]||`第 ${Number(key)+1} 项`):/^-?\d+$/.test(key)?`第 ${Number(key)+1} 项`:readerLabel(key,path,displayNames),count=Object.keys(value).length;
    details.innerHTML=`<summary>${e(title)} <span class="muted">· ${count} 项</span></summary><div></div>`;
    let built=false;details.addEventListener('toggle',()=>{if(details.open&&!built){built=true;renderFields(details.lastElementChild,value,key,{notes,path:path+'.'+key});}});
    host.append(details);
  }
  if(!pairs.length)host.insertAdjacentHTML('beforeend',`<p class="muted">${original.length?'这组资料仅含内部标识或尚未解释的参数，可在底部原始资料中查阅。':'暂无内容。'}</p>`);
  const unexplained=original.filter(([k,v])=>! /^-?\d+$/.test(k)&&!isTechnical(k)&&!readerLabel(k,path,displayNames)&&!itemsById.has(k)&&v!=null&&v!=='').length;
  if(pairs.length&&unexplained)host.insertAdjacentHTML('beforeend',`<p class="coverage-note">另有 ${unexplained} 项参数含义尚未核验，完整值保留在底部原始资料中。</p>`);
}
function addFields(host,title,data,{open=false,path=sectionId}={}){
  const details=document.createElement('details');details.className='detail-section';details.open=open;
  details.innerHTML=`<summary>${e(title)} <span class="muted">· ${Object.keys(data).length} 项</span></summary><div></div>`;
  let built=false;const build=()=>{if(!built){built=true;renderFields(details.lastElementChild,data,'',{path});}};
  if(open)build();else details.addEventListener('toggle',()=>{if(details.open)build();});
  host.append(details);
}
function rawDetails(host,data){
  const details=document.createElement('details');details.className='detail-section raw-parameters';
  details.innerHTML='<summary>原始资料与技术标识</summary><p class="muted">用于核对未解释的字段与原始数值。这里保留英文键、标识和完整精度。</p><pre></pre>';
  let built=false;details.addEventListener('toggle',()=>{if(details.open&&!built){built=true;details.querySelector('pre').textContent=JSON.stringify(data,null,2);}});host.append(details);
}
function metricStrip(host,metrics){
  const visible=metrics.filter(([,v])=>v!==undefined&&v!==null);
  host.insertAdjacentHTML('beforeend',`<dl class="reader-metrics" style="--metric-count:${Math.min(4,visible.length)}">${visible.map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`);
}
function itemDetails(host,entry){
  const p=entry.detail||{},used=new Set();
  const metrics=entry.ammo?[['基础伤害',formatNumber(p.Damage,'Damage')],['穿透力',readableNumber(p.PenetrationPower)],['护甲伤害',formatNumber(p.ArmorDamage,'ArmorDamage')],['弹丸初速',formatNumber(p.InitialSpeed,'InitialSpeed')]]:
    p.armorClass?[['防护等级',formatNumber(p.armorClass,'armorClass')],['最大耐久',formatNumber(p.MaxDurability,'MaxDurability')],['材质',enumText(p.ArmorMaterial,'ArmorMaterial')],['重量',formatNumber(p.Weight,'Weight')]]:
    [['重量',formatNumber(p.Weight,'Weight')],['占用空间',`${p.Width} × ${p.Height} 格`],...(p.MaxHpResource?[['治疗资源',formatNumber(p.MaxHpResource,'MaxHpResource')],['单次使用',duration(p.medUseTime)]]:[])];
  metricStrip(host,metrics);
  host.insertAdjacentHTML('beforeend',`<div class="detail-tags"><span>手册基准价 ${entry.price!=null?number(entry.price)+' 卢布':'未收录'}</span><span>${entry.market===true?'允许跳蚤出售':entry.market===false?'禁止跳蚤出售':'交易标志未知'}</span></div>
    <p class="entry-notice">基准价不是实时行情。交易还受等级、分类与角色状态限制。</p>${entry.description?`<p class="entry-description">${e(entry.description)}</p>`:''}`);
  if(p.StimulatorBuffs&&buffGroups[p.StimulatorBuffs])buffDetails(host,buffGroups[p.StimulatorBuffs],p);
  if(p.effects_health||p.effects_damage){
    const effects=document.createElement('section');effects.className='reader-section';effects.innerHTML='<h3>使用后会发生什么</h3>';
    for(const [kind,label] of [['effects_health','能量与水分'],['effects_damage','伤势处理']])if(Object.keys(p[kind]||{}).length){
      used.add(kind);addFields(effects,label,p[kind],{open:true,path:'items.'+kind});
      for(const d of effects.querySelectorAll('details'))d.open=true;
    }
    host.append(effects);
  }
  for(const group of itemFieldGroups){
    if(group.title==='弹药性能'&&!entry.ammo)continue;
    if(group.title==='防护性能'&&!p.armorClass)continue;
    if(group.title==='武器与配件'&&!['weapClass','Recoil','Ergonomics','ScopesCount'].some(k=>Object.hasOwn(p,k)))continue;
    const keys=group.keys.filter(k=>Object.hasOwn(p,k)&&!used.has(k)&&!isTechnical(k)&&!(Array.isArray(p[k])&&!p[k].length)&&!(['MaxHpResource','MaxResource','buckshotBullets'].includes(k)&&p[k]===0)&&!(k==='TracerColor'&&!p.Tracer));if(!keys.length)continue;
    keys.forEach(k=>used.add(k));addFields(host,group.title,Object.fromEntries(keys.map(k=>[k,p[k]])),{open:group.title!=='携带与交易',path:'items'});
  }
  const more=document.createElement('details');more.className='detail-section all-parameters';
  more.innerHTML='<summary>更多属性与查找</summary><div><label class="parameter-search">查找属性<input type="search" placeholder="如：耐久、出血、重量" aria-label="查找物品字段"></label><div data-fields></div></div>';
  let built=false;const target=more.querySelector('[data-fields]');
  more.addEventListener('toggle',()=>{if(more.open&&!built){built=true;renderFields(target,p);}});
  more.querySelector('input').oninput=event=>{const q=event.target.value.trim().toLowerCase();target.replaceChildren();const matches=Object.fromEntries(Object.entries(p).filter(([k])=>!isTechnical(k)&&`${k} ${readerLabel(k,'items',displayNames)} ${readerNote(k)}`.toLowerCase().includes(q)));if(!Object.keys(matches).length)target.innerHTML='<p class="muted">没有匹配的属性。</p>';else renderFields(target,matches,'',{path:'items'});};
  host.append(more);
}
function buffDetails(host,buffs,props={}){
  const medical=Number.isFinite(props.medUseTime)||Number.isFinite(props.foodUseTime);
  const cards=buffs.map(b=>{const v=describeBuff(b,displayNames);return `<li><div><strong>${e(v.label)}</strong><b>${e(v.amount)}</b></div><p>${e(v.timing)}</p>${v.note?`<small>${e(v.note)}</small>`:''}</li>`;});
  host.insertAdjacentHTML('beforeend',`<section class="reader-section"><h3>${medical?'使用效果':'附带效果配置'}</h3>${medical?'':'<p class="entry-notice">该物品附带效果配置，但触发方式与作用对象未在这条物品记录中说明。</p>'}<ul class="effect-list">${cards.join('')}</ul></section>`);
}
function table(host,head,rows){host.insertAdjacentHTML('beforeend',`<div class="reader-table-wrap"><table class="reader-table"><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);}
function craftDetails(host,r,entry){
  if(!r.requirements&&!r.endProducts&&r.areaType==null){host.insertAdjacentHTML('beforeend','<p class="entry-notice">当前仅收录此服务的标识，材料、等待时间和产出规则尚未提供。</p>');return;}
  metricStrip(host,[['制作设施',manifest.areas[r.areaType]||(r.endProducts?'Scav 宝箱':'未收录')],['基础耗时',duration(r.productionTime)],['每次产量',r.endProducts?'随机数量':r.count!=null?r.count+' 件':'未提供']]);
  if(r.endProduct)host.insertAdjacentHTML('beforeend',`<p>产出物品：${valueHtml(r.endProduct)}</p>`);
  const requirements=r.requirements||[];
  for(const [types,title] of [[['Item','Resource'],'消耗材料与资源'],[['Tool'],'需要工具（不按材料扣除）'],[['Area','QuestComplete','Skill','GameVersion'],'解锁要求']]){
    const list=requirements.filter(v=>types.includes(v.type));if(!list.length)continue;
    host.insertAdjacentHTML('beforeend',`<h3>${title}</h3>`);
    table(host,['名称 / 要求','数量 / 等级'],list.map(v=>[
      v.templateId?valueHtml(v.templateId):v.type==='Area'?e(manifest.areas[v.areaType]||'指定设施'):v.type==='QuestComplete'?'完成指定任务':v.type==='GameVersion'?'游戏版本':valueHtml(v.skillName||v.type,'skill'),
      `${v.type==='Resource'?e(v.resource)+' 点资源（不是 '+e(v.resource)+' 件）':v.type==='QuestComplete'?'配方未给出任务标识，无法确定具体前置':v.type==='GameVersion'?(v.gameVersions||[]).map(x=>valueHtml(x,'gameVersions')).join(' / '):v.requiredLevel!=null?e(v.requiredLevel)+' 级':v.count!=null?e(number(v.count))+' '+e(currencies[v.templateId]||'件'):v.type==='Tool'?'需要持有':'未提供'}${requirementExtra(v)?'<small>'+e(requirementExtra(v))+'</small>':''}`]));
  }
  const linked=readerContext.craftTasks?.[entry.id];
  if(linked?.length){host.insertAdjacentHTML('beforeend','<h3>任务奖励关联</h3><p class="muted">以下已收录任务奖励指向相同产物、设施和等级；这是关联线索，不能替代缺失的配方前置条件。</p>');table(host,['任务','奖励适用范围'],linked.map(t=>[e(t.name||'任务名称未收录'),e(scopeText(t.gameMode,t.editions))]));}
  const other=requirements.filter(v=>!['Item','Resource','Tool','Area','QuestComplete','Skill','GameVersion'].includes(v.type));
  if(other.length)addFields(host,'其他要求',other,{open:true});
  if(r.endProducts){host.insertAdjacentHTML('beforeend','<h3>随机产出范围</h3><p class="muted">这里表示各稀有度的物品数量，不是掉落概率，也没有列出具体物品池。</p>');table(host,['稀有度','最少','最多'],Object.entries(r.endProducts).map(([k,v])=>[e(readerLabel(k,'crafts.endProducts')||k),e(v.min)+' 件',e(v.max)+' 件']));}
  host.insertAdjacentHTML('beforeend','<p class="muted">显示基础制作时间，设施、技能和赛季效果可能改变实际耗时。</p>');
  addFields(host,'其他制作规则',Object.fromEntries(Object.entries(r).filter(([k])=>!['requirements','productionTime','count','endProduct','endProducts','areaType'].includes(k))));
}
function mapDetails(host,entry){
  const d=entry.detail;
  metricStrip(host,[['战局时限',duration(d.EscapeTimeLimit*60)],['玩家人数',`${d.MinPlayers}–${d.MaxPlayers} 人`],['Scav 进入',d.DisabledForScav===true?'配置禁止':d.DisabledForScav===false?'配置允许':'未提供'],['撤离记录',`${(d.exits||[]).length} 条`]]);
  host.insertAdjacentHTML('beforeend',`<p class="entry-notice">${d.Enabled===false?'该场景在保存配置中未启用。':''}以下为留存撤离规则；出现概率受场景、模式和开放条件限制，费用还可能受声望影响。</p>`);
  if(entry.mapId)host.insertAdjacentHTML('beforeend',`<p><a class="detail-link" href="${e(atlasMapHref(entry.mapId))}">打开三维地图 ↗</a></p>`);
  if(entry.id==='laboratory_dark')host.insertAdjacentHTML('beforeend','<p class="entry-notice">实验室停电场景留存资料，当前进入条件仍需核验。</p>');
  host.insertAdjacentHTML('beforeend','<h3>撤离地点与要求</h3>');
  for(const [i,x] of (d.exits||[]).entries()){
    const article=document.createElement('article');article.className='extraction-card';
    article.innerHTML=`<h4>${e(displayNames[x.Name]||(/^EXFIL_|_secret_extraction/.test(x.Name)?`撤离点 ${i+1}（名称未收录）`:x.Name)||`撤离点 ${i+1}`)}</h4>`;
    if(x.PassageRequirement==='TransferItem')metricStrip(article,[['交付费用 / 数量',paymentText(x,x.Count,displayNames)],['PvE 交付费用 / 数量',paymentText(x,x.CountPVE,displayNames)]]);
    if(x.Id&&x.PassageRequirement!=='TransferItem'&&itemsById.has(x.Id))article.insertAdjacentHTML('beforeend',`<p>要求物品：${valueHtml(x.Id)}</p>`);
    const tip=displayNames[x.RequirementTip];if(tip)article.insertAdjacentHTML('beforeend',`<p class="requirement-tip">${e(tip)}</p>`);
    if(x.EntryPoints)article.insertAdjacentHTML('beforeend',`<p class="muted">出生区域限制：${e(String(x.EntryPoints).split(',').map(s=>displayNames[s.trim()]||s.trim()).join('、'))}。仅适用于列出的进入区域。</p>`);
    const fields=Object.fromEntries(['ExfiltrationType','PassageRequirement','RequiredSlot','ExfiltrationTime','ExfiltrationTimePVE','PlayersCount','PlayersCountPVE','Chance','ChancePVE','MinTime','MaxTime','MinTimePVE','MaxTimePVE'].filter(k=>x[k]!=null&&x[k]!==''&&!(k.startsWith('PlayersCount')&&x[k]===0)&&!(k==='RequiredSlot'&&x.PassageRequirement!=='Empty')).map(k=>[k,x[k]]));
    renderFields(article,fields,'',{path:'maps.exits'});host.append(article);
  }
  for(const [key,title] of [['secretExits','秘密撤离'],['transits','地图转场']])if(d[key]?.length)addFields(host,title,d[key],{path:'maps.'+key});
  addFields(host,'其他场景规则',Object.fromEntries(Object.entries(d).filter(([k])=>!['exits','secretExits','transits','SpawnPointParams','waves','paths','MinPlayers','MaxPlayers','EscapeTimeLimit','DisabledForScav'].includes(k))),{path:'maps'});
  if(d.waves?.length)addFields(host,'普通 AI 波次',d.waves,{path:'maps.waves'});
}
function conditionText(c){
  const compare=enumText(c.compareMethod||'>=','compareMethod');
  if(c.conditionType==='Level')return `角色等级${compare} ${c.value} 级`;
  if(c.conditionType==='HideoutArea')return `${manifest.areas[c.areaType]||'指定设施'}${compare} ${c.value??c.level??'指定'} 级`;
  if(c.conditionType==='Skill')return `${displayNames[c.target]||enumText(c.target,'skill')||'指定技能'}${compare} ${c.value} 级`;
  if(c.conditionType==='Quest')return `${(c.status||[]).map(v=>({2:'接取',3:'达到交付条件',4:'完成',5:'失败'})[v]||'指定状态').join('或')}任务：${displayNames[c.target]||'名称未收录'}`;
  if(c.conditionType==='HasItem')return `持有 ${(Array.isArray(c.target)?c.target:[c.target]).map(id=>itemsById.get(id)?.name||displayNames[id]||'指定物品').join(' / ')}${c.value!=null?' × '+number(c.value):''}${requirementExtra(c)?'；'+requirementExtra(c):''}`;
  return `${readerLabel(c.conditionType,'',displayNames)||'其他条件'}${c.value!=null?'：'+c.value:''}`;
}
function scopeText(gameMode,editions){
  const mode=Array.isArray(gameMode)?gameMode.length?gameMode.map(x=>enumText(x,'gameMode')).join(' / '):'未列出模式限制':'模式未提供';
  const edition=Array.isArray(editions)?editions.length?'版本：'+editions.map(x=>enumText(x,'availableInGameEditions','',displayNames)).join(' / '):'未列出版本限制':'版本限制未提供';
  return mode+'；'+edition;
}
function prestigeDetails(host,d){
  host.insertAdjacentHTML('beforeend',`<h3>达成条件</h3><ul class="condition-list">${(d.conditions||[]).map(c=>`<li>${e(conditionText(c))}</li>`).join('')}</ul><h3>获得奖励</h3>`);
  table(host,['奖励内容','适用范围与发放'],(d.rewards||[]).map(r=>{
    const item=r.type==='Item'?rewardItem(r):null;
    let content=r.type==='Stub'?'占位记录，未说明可领取内容':r.type==='ExtraDailyQuest'?`额外每日任务 ${e(r.value)} 个`:r.type==='Skill'?`${valueHtml(r.target,'skill')} · ${e(number(r.value))} 经验`:r.type==='CustomizationDirect'?`外观：${valueHtml(r.target)}`:`${valueHtml(r.target)}${r.value!=null?' · '+e(number(r.value)):''}`;
    if(item)content=`${valueHtml(item.templateId)} × ${e(number(item.count))}${item.attachments.length?`<details class="reward-components"><summary>附带 ${item.attachments.length} 项组件</summary>${item.attachments.map(i=>valueHtml(i._tpl)+(i.upd?.StackObjectsCount?' × '+e(number(i.upd.StackObjectsCount)):'')).join('<br>')}</details>`:''}`;
    const flags=[r.findInRaid===true?'带战局中发现标记':r.findInRaid===false?'不带战局中发现标记':'',r.isDeliverByMail===true?'邮件发放':r.isDeliverByMail===false?'不通过邮件发放':'',r.isHidden?'隐藏奖励配置':''].filter(Boolean);
    return [content,`${e(scopeText(r.gameMode,r.availableInGameEditions))}${flags.length?'<small>'+e(flags.join('；'))+'</small>':''}`];
  }));
  const t=d.transferConfigs;
  if(t){host.insertAdjacentHTML('beforeend','<h3>转生后可以转移什么</h3>');metricStrip(host,[['物品转移空间',t.stashConfig?`${t.stashConfig.xCellCount} × ${t.stashConfig.yCellCount} 格`:null],['技能转移系数',t.skillConfig?formatNumber(t.skillConfig.transferMultiplier,'transferMultiplier'):null],['熟练度转移系数',t.masteringConfig?formatNumber(t.masteringConfig.transferMultiplier,'transferMultiplier'):null]]);
    host.insertAdjacentHTML('beforeend','<p class="muted">转移系数参与经验计算，不直接等于技能等级保留比例。物品还必须符合下方筛选范围，不能只看空间大小。</p>');
    if(t.stashConfig?.filters)addFields(host,'可转移的物品与分类',t.stashConfig.filters,{path:'prestige.transferConfigs'});
  }
}
function gymDetails(host,d){
  metricStrip(host,[['设施',manifest.areas[d.area]||'健身房'],['等级',d.areaLevel+' 级'],['训练步骤',d.quickTimeEvents.length+' 步']]);
  host.insertAdjacentHTML('beforeend','<h3>开始训练的条件</h3>');
  table(host,['要求','条件'],(d.requirements||[]).flatMap(v=>v.type==='Health'?Object.entries(v).filter(([k])=>['energy','hydration'].includes(k)).map(([k,n])=>[e(readerLabel(k)),`至少 ${e(n)} 点`]):[[e(enumText(v.bodyPart,'bodyPart')),`${v.excluded?'不得有':'需要有'}${e(enumText(v.effectName,'effectName'))}`]]));
  host.insertAdjacentHTML('beforeend','<h3>训练结果</h3><p class="muted">能量和水分为每次判定的变化量。候选结果的权重不是百分比，技能系数不是直接获得的经验。</p>');
  for(const [key,result] of Object.entries(d.results||{})){
    const part=document.createElement('section');part.className='training-result';part.innerHTML=`<h4>${e(readerLabel(key))}</h4>`;
    metricStrip(part,[['能量变化',formatNumber(result.energy,'energy','hideout.results')],['水分变化',formatNumber(result.hydration,'hydration','hideout.results')]]);
    table(part,['候选结果','持续时间 / 技能系数','权重与流程'],(result.rewardsRange||[]).map(v=>[
      e(v.type==='Skill'?enumText(v.skillId,'skillId'):enumText(v.type,'type')),
      v.levelMultipliers?v.levelMultipliers.map(m=>`${e(m.level)} 级档：${e(m.multiplier)} 倍`).join('<br>'):v.time!=null?e(duration(v.time)):'未设置持续时间',
      `${e(v.weight)}（相对权重）<br>${e(enumText(v.result,'result'))}`]));host.append(part);
  }
  const steps=document.createElement('details');steps.className='detail-section';steps.innerHTML='<summary>每一步如何操作</summary><p class="muted">操作为缩圈判定；速度与判定范围保留配置值，不是成功概率。等待时间以秒计。</p>';
  table(steps,['步骤 / 操作','速度参数','开始 / 结束间隔','判定范围分量'],d.quickTimeEvents.map((v,i)=>[`${i+1} · ${e(enumText(v.key,'key'))}`,e(readableNumber(v.speed)),`${e(duration(v.startDelay))} / ${e(duration(v.endDelay))}`,Object.entries(v.successRange||{}).map(([k,n])=>`${e(k.toUpperCase())}：${e(n)}`).join('；')]));host.append(steps);
}
function generalDetails(host,entry,id){
  const d=entry.detail;
  if(id==='crafts')return craftDetails(host,d,entry);
  if(id==='maps')return mapDetails(host,entry);
  if(id==='presets'){
    host.insertAdjacentHTML('beforeend','<h3>预设包含的物品</h3>');
    const counts=new Map();for(const i of d._items||[])counts.set(i._tpl,(counts.get(i._tpl)||0)+(i.upd?.StackObjectsCount??1));
    host.insertAdjacentHTML('beforeend','<p class="muted">组件合并计数；弹药等堆叠物品按实际堆叠数计入。预设不表示目前可购买或已解锁。</p>');
    table(host,['物品 / 组件','数量'],[...counts].map(([tpl,n])=>[valueHtml(tpl),e(n)+' 件']));return;
  }
  if(id==='prestige'){
    return prestigeDetails(host,d);
  }
  if(id==='media'){
    const segments=d.subtitles||[];metricStrip(host,[['分段数量',segments.length+' 段'],['最后时间点',duration(Math.max(0,...segments.map(s=>s.end)))]]);
    host.insertAdjacentHTML('beforeend','<p class="muted">字幕使用已收录的官方文本，未逐字核对当前版本；暂不提供音频播放。时间为“分:秒”。</p>');
    table(host,['时间段','字幕正文'],segments.map(s=>[`${e(timecode(s.start))}–${e(timecode(s.end))}`,`<p class="subtitle-text">${e(readerContext.subtitles?.[s.id]?.text||'此段字幕正文尚未收录')}</p>`]));return;
  }
  if(id==='hideout'&&d.quickTimeEvents){
    return gymDetails(host,d);
  }
  if(id==='languages'){
    if(languages[entry.id])metricStrip(host,[['语言',languages[entry.id]],['收录状态','支持该语言']]);
    else host.insertAdjacentHTML('beforeend',`<p class="entry-description">${e(d.text||entry.name)}</p>`);return;
  }
  if(id==='story'){
    host.insertAdjacentHTML('beforeend','<p class="entry-notice">这条资料是章节或任务关联索引，尚未在此收录完整正文。</p><p><a class="detail-link" href="tasks.html">前往任务页面查看目标与进度 ↗</a></p>');
    if(entry.subtitle)host.insertAdjacentHTML('beforeend',`<p>${e(entry.subtitle)}</p>`);
    if(d.links){
      const linked=Object.entries(d.links).flatMap(([kind,list])=>list.map(v=>[
        e(enumText(kind,'sourceKind')),
        v.templateId?valueHtml(v.templateId):(v.item||[]).map(i=>valueHtml(i._tpl)+(i.upd?.StackObjectsCount?' × '+e(number(i.upd.StackObjectsCount)):'')).join('<br>')||'对象名称未收录',
        [v.area!=null?'设施：'+e(manifest.areas[v.area]||'未收录'):'',v.traderId?'商人：'+valueHtml(v.traderId):'',(v.quests||[]).map(id=>valueHtml(id)).join(' / ')].filter(Boolean).join('<br>')||'未列出附加条件']));
      if(linked.length)table(host,['关联类型','物品','任务与使用条件'],linked);else host.insertAdjacentHTML('beforeend','<p class="muted">此记录未列出物品、交易或制作关联。</p>');
    }
    if(d.references?.length)table(host,['关联来源','对象'],d.references.map(r=>[valueHtml(r.sourceKind||r.linkKind,'sourceKind'),valueHtml(r.linkId||r.itemId)]));return;
  }
  if(id==='handbook'){
    metricStrip(host,[['所属分类',entry.group],['交易等级',d.RagfairLevelToTrade==null?'未单独设置':d.RagfairLevelToTrade+' 级']]);return;
  }
  if(id==='customization'){
    if(!Object.keys(d).length){host.insertAdjacentHTML('beforeend','<p class="entry-notice">这是外观系统的分类模板，当前没有具体装备、解锁条件或可穿戴属性。</p>');return;}
    const preferred=['BodyPart','Side','AvailableAsDefault','ProfileVersions','IntegratedArmorVest','HiddenByDefault'];
    const shown=preferred.filter(k=>k in d);renderFields(host,Object.fromEntries(shown.map(k=>[k,d[k]])));
    host.insertAdjacentHTML('beforeend','<p class="muted">阵营、游戏版本和默认可用标志只描述这件外观的配置；当前角色是否已解锁还需在游戏内确认。</p>');
    const rest=Object.fromEntries(Object.entries(d).filter(([k])=>!shown.includes(k)&&!isTechnical(k)));if(Object.keys(rest).length)addFields(host,'其他外观条件',rest);return;
  }
  const unwrapped=id==='mechanics'&&d&&typeof d[entry.id]==='object'&&d[entry.id]!==null?d[entry.id]:d;
  if(id==='mechanics')host.insertAdjacentHTML('beforeend','<p class="entry-notice">以下是保存的规则配置。倍率以 1 为基准；权重需要结合候选池；曲线分量与未确认单位的参数保留原值。活动或模式专用配置不代表所有战局均启用。</p>');
  renderFields(host,unwrapped,'',{path:id+'.'+entry.id});
}
function waveSummary(w,{link=true}={}){
  const c=bossContext(w),points=w.points||[];
  return `<div class="wave-heading"><div><h3>${e(w.group||w.mapName)} · ${e(w.variant||w.subtitle||w.location)}</h3><span class="context-badge ${e(c.kind)}">${e(c.label)}</span></div>
    <b class="wave-rate">${Number.isFinite(w.chance)?e(w.chance)+'%':'未提供'}<small>保存的波次配置概率</small></b></div>
    <p class="entry-notice">${e(c.note)}</p>
    ${readableBossFacts(w)}
    ${points.length?`<details class="point-details"><summary>${['history','conditional'].includes(c.kind)?'留存':'已核验'}候选位置 · ${points.length}</summary><p class="muted">坐标关联只说明位置一致，不代表当前模式会在这里生成。</p><div class="point-links">${points.map((p,i)=>`<a href="${e(mapBossLink(w.mapId,w.role,p.id))}">位置 ${i+1} · ${e(p.zone||'')} ↗</a>`).join('')}</div></details>`:'<p class="muted">暂无可核验关联的候选位置。</p>'}
    ${link?`<a class="detail-link" href="?section=bosses&view=waves&entry=${encodeURIComponent(w.id)}" data-wave="${e(w.id)}">单独查看这条波次 →</a>`:''}`;
}
async function loadBossInventory(host,entry,token){
  const current=()=>token===detailToken&&$('entryDialog').open&&host.isConnected;
  try{
    if(!bossCatalogPromise)bossCatalogPromise=loadBossData().then(result=>result.catalog).catch(error=>{bossCatalogPromise=null;throw error;});
    const catalog=await bossCatalogPromise;if(!current())return;
    const {choices,selected}=bossInventoryChoices(catalog,entry);
    const options=related=>choices.filter(r=>r.related===related).map(r=>`<option value="${e(r.id)}">${e(r.label)}</option>`).join('');
    const related=options(true),other=options(false);
    host.innerHTML=`<label class="boss-inventory-role">查看角色或护卫的装备<select aria-label="装备资料角色">${!selected?`<option value="">${e(entry.name)} · 暂无装备资料</option>`:''}${related?`<optgroup label="当前角色与相关成员">${related}</optgroup>`:''}${other?`<optgroup label="其他已收录角色">${other}</optgroup>`:''}</select></label><p class="boss-note">不同角色与活动变体分别保存装备候选，切换后不会合并为同一个物品池。</p><div class="boss-inventory-content"></div>`;
    const select=host.querySelector('select'),inventory=host.querySelector('.boss-inventory-content');select.value=selected;
    const show=()=>renderBossInventory(inventory,{catalog,roleId:select.value});
    select.onchange=show;show();
  }catch(error){
    if(!current())return;
    host.innerHTML='<p class="boss-note" role="status">装备资料暂时无法加载。</p><button type="button">重新加载装备资料</button>';
    host.querySelector('button').onclick=()=>{host.innerHTML='<p class="boss-note" role="status">正在加载装备资料…</p>';loadBossInventory(host,entry,token);};
  }
}
function bossDetails(host,entry,token){
  const briefing=bossBriefing(entry);
  if(briefing.length)host.insertAdjacentHTML('beforeend',`<section class="boss-briefing" aria-label="活动与模式说明">${briefing.map(n=>`<article><h3>${e(n.title)}</h3><p>${e(n.text)}</p>${n.url?`<a href="${e(n.url)}" target="_blank" rel="noopener noreferrer">官方公告 ↗</a>`:''}</article>`).join('')}<small>说明核对：2026-10-23 · 活动公告与下方保存配置分别标注</small></section>`);
  if(entry.waves){
    const waves=entry.waves;
    host.insertAdjacentHTML('beforeend',`<p class="muted">${waves.length} 条波次记录 · ${entry.locations} 个场景。活动记录与当前生成规则分开阅读。</p>`);
    const byLocation=new Map();for(const w of waves){if(!byLocation.has(w.location))byLocation.set(w.location,[]);byLocation.get(w.location).push(w);}
    for(const group of byLocation.values()){
      const details=document.createElement('details');details.className='detail-section wave-location';details.open=byLocation.size<=2&&group.length<=3;
      details.innerHTML=`<summary>${e(group[0].group)} · ${e(group[0].variant)} <span class="muted">${group.length} 条波次</span></summary><div>${group.map(w=>`<article class="wave-record">${waveSummary(w)}</article>`).join('')}</div>`;host.append(details);
    }
  }else{
    host.insertAdjacentHTML('beforeend',waveSummary(entry,{link:false}));
    host.insertAdjacentHTML('beforeend','<p class="muted">模式标记和场景开关是保存的配置字段，不能替代活动状态或分模式验证。</p>');
  }
  const inventory=document.createElement('section');inventory.className='encyclopedia-boss-inventory';
  inventory.innerHTML='<h3>装备与携带物资</h3><div data-encyclopedia-inventory><p class="boss-note" role="status">正在加载装备资料…</p></div>';
  host.append(inventory);loadBossInventory(inventory.querySelector('[data-encyclopedia-inventory]'),entry,token);
}
async function openEntry(original,{item=false}={}){
  const token=++detailToken,entrySection=item?'items':sectionId;
  if(!$('entryDialog').open)$('entryDialog').showModal();
  $('entryDetail').innerHTML='<h2 id="entryTitle">正在加载详情…</h2>';
  try{
    let entry=original;
    if(entrySection==='items'){
      const chunk=manifest.itemChunks[original.id.slice(0,2)];if(!chunk)throw Error('暂未收录此物品');
      entry=(await resource(chunk))[original.id];
      if(entry.detail?.StimulatorBuffs&&!buffGroups[entry.detail.StimulatorBuffs]){
        const mechanics=await resource(manifest.sections.find(s=>s.id==='mechanics').resource);
        buffGroups=mechanics.find(r=>r.id==='Health')?.detail?.Health?.Effects?.Stimulator?.Buffs||{};
      }
    }
    if(token!==detailToken||!$('entryDialog').open)return;
    const host=$('entryDetail');
    host.innerHTML=`<div class="entry-hero">${entry.icon?`<img src="${e(entry.icon)}" alt="">`:''}<div><p class="eyebrow">${e(entry.group||'资料')}</p><h2 id="entryTitle">${e(entry.name)}</h2>${entry.en&&entry.en!==entry.name?`<p class="entry-english">${e(entry.en)}</p>`:''}</div></div>`;
    if(entrySection==='items')itemDetails(host,entry);
    else if(entrySection==='bosses')bossDetails(host,entry,token);
    else generalDetails(host,entry,entrySection);
    if(entry.detail)rawDetails(host,entrySection==='customization'?{originalName:entry.originalName||entry.name,...entry.detail}:entry.detail);
    host.insertAdjacentHTML('beforeend',`<footer class="entry-footer"><span>资料日期 ${e(manifest.date)} · EFT ${e(manifest.eftVersion)}</span><details><summary>查看标识</summary><code>${e(entry.id)}</code></details></footer>`);
    $('entryDialog').scrollTop=0;
    if(!item)setUrl({entry:entry.id});
  }catch(error){
    if(token!==detailToken)return;
    $('entryDetail').innerHTML=`<h2 id="entryTitle">详情加载失败</h2><p>${e(error.message)}</p><button id="retryEntry">重试</button>`;
    $('retryEntry').onclick=()=>openEntry(original,{item});
  }
}
$('encyclopediaFilters').onsubmit=event=>event.preventDefault();
$('encyclopediaSearch').oninput=()=>{page=1;render();setUrl();};
for(const id of ['groupFilter','kindFilter','encyclopediaSort','bossView','bossScope','bossMode'])$(id).onchange=()=>{page=1;render();setUrl();};
for(const [id,delta] of [['previousPage',-1],['nextPage',1]])$(id).onclick=()=>{page+=delta;render();$('sectionTitle').scrollIntoView({block:'start',behavior:'smooth'});};
$('sectionNav').onclick=event=>{const a=event.target.closest('[data-section]');if(a){event.preventDefault();chooseSection(a.dataset.section);}};
$('encyclopediaStats').onclick=event=>{const a=event.target.closest('[data-section]');if(a){event.preventDefault();chooseSection(a.dataset.section,new URL(a.href).searchParams);}};
$('encyclopediaResults').onclick=event=>{const button=event.target.closest('[data-entry]');const entry=shown.find(r=>r.id===button?.dataset.entry);if(entry)openEntry(entry);};
$('entryDetail').onclick=event=>{
  const item=event.target.closest('[data-item]'),wave=event.target.closest('[data-wave]');
  if(item){event.preventDefault();openEntry(itemsById.get(item.dataset.item),{item:true});}
  if(wave){const entry=rows.find(r=>r.id===wave.dataset.wave);if(entry){event.preventDefault();openEntry(entry);}}
};
$('closeEntry').onclick=()=>$('entryDialog').close();
$('entryDialog').addEventListener('close',()=>{detailToken++;setUrl();});
try{
  manifest=await loadEncyclopediaManifest();
  if(manifest.readerNames)displayNames=(await resource(manifest.readerNames)).names;
  if(manifest.readerContext){readerContext=await resource(manifest.readerContext);displayNames={...displayNames,...readerContext.names};}
  $('snapshotDate').innerHTML=`资料日期 ${e(manifest.date)}<br><span>EFT ${e(manifest.eftVersion)}</span>`;
  const c=manifest.counts;
  $('encyclopediaStats').innerHTML=[
    [c.items,'件物品','含武器、装备与消耗品','items',''],
    [c.ammo,'种弹药','伤害、穿透与弹道参数','items','&kind=ammo'],
    [c.bossIdentities,'类敌人',`${c.bossWaves} 条波次，含活动配置`,'bosses',''],
    [c.recipes,'个制作配方','普通制作，可查询材料','crafts',''],
  ].map(([n,label,note,id,query])=>`<a class="stat" data-section="${id}" href="?section=${id}${query}"><strong>${number(n)}</strong><span>${label}</span><small>${e(note)}</small><b aria-hidden="true">↗</b></a>`).join('');
  $('sectionNav').innerHTML=manifest.sections.map(s=>{
    const count=s.id==='bosses'?c.bossIdentities:s.id==='items'?c.items:s.count;
    const unit=s.id==='bosses'?'类':s.id==='items'?'件':'条';
    return `<a href="?section=${e(s.id)}" data-section="${e(s.id)}"><span>${e(s.title)}</span><small>${number(count)} ${unit}</small></a>`;
  }).join('');
  $('bossGuideBody').innerHTML='<div><strong>先看条件，再读百分比</strong><p>波次是一次敌人生成安排。百分比属于这条安排，不是每个候选点的概率；多条波次不能直接相加。配置中的“强制生成”也不能单独证明必刷。</p></div><div><strong>模式标记不等于当前开放模式</strong><p>模式筛选只查保存记录中的标记。未启用的场景、历史活动和带触发条件的波次会另外标注；本页没有逐模式的实时验证结果。</p></div>'+LAB_CONTEXT.map(n=>`<div><strong>${e(n.title)}</strong><p>${e(n.text)}</p></div>`).join('');
  const itemRows=await resource(manifest.sections.find(s=>s.id==='items').resource);itemsById=new Map(itemRows.map(r=>[r.id,r]));
  const params=new URLSearchParams(location.search);await chooseSection(params.get('section')||'items',params);
}catch(error){$('sectionTitle').textContent='百科';$('encyclopediaStatus').innerHTML=`${e(error.message)}。<button id="retryPage">重试</button>`;$('retryPage').onclick=()=>location.reload();}
