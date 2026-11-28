import {installPageBridge,replacePageUrl,readPagePreferences,savePagePreferences} from './atlas-page-session.js';
import { ATLAS_MAPS, atlasMapHref } from './atlas-maps.js';
import { createTaskStore } from './task-store.js';
import { layoutTaskGraph, groupTasksByMap, taskGraphRecords } from './task-graph.js';
import { taskVisiblePrerequisites,taskRequirementRows,compareTaskUnlock } from './task-requirements.js';
import {presentTraders,SEASON_CATEGORY,SEASON_CATEGORY_ID,matchesTaskCategory} from './task-presentation.js';
import {createPreparationView} from './task-preparation-ui.js';
import {accessLabels,applyTaskAccess} from './task-preparation.js';
import {taskAssetUrl} from './task-asset-url.js';

const $ = id => document.getElementById(id);
const store = createTaskStore();
const smallScreen = matchMedia('(max-width:1149px)');
const query = new URLSearchParams(location.search);
const returnMap = Object.hasOwn(ATLAS_MAPS, query.get('map')) ? query.get('map') : null;
if (returnMap) { $('mapNavigation').hidden = false; $('mapNavigation').href = atlasMapHref(returnMap); $('taskNavigation').href = `tasks.html?map=${encodeURIComponent(returnMap)}`; }
installPageBridge();
const preferenceKey='atlas-task-interface-v1',saved=readPagePreferences(preferenceKey),views=['overview','mine','preparation'];
const linkedView=query.get('view'),view=views.includes(linkedView)?linkedView:
  !query.has('task')&&views.includes(saved.view)?saved.view:'overview';
const state = { catalogue: null, assets: {}, view, trader: saved.trader, mineTrader: saved.mineTrader,
  search: !query.has('task')&&typeof saved.search==='string'?saved.search.slice(0,200):'', detail: null,
  opened: new Map(Object.entries(saved.opened||{}).filter(([,open])=>typeof open==='boolean')) };
const preparation=createPreparationView({store,openDetail,setView,opened:state.opened,rememberGroup});
$('taskSearch').maxLength=200;$('taskSearch').value=state.search;
let taskById = new Map(), traderById = new Map(), mapById = new Map(), lastFocus = null, toastTimer = 0;
let lastSelection = JSON.stringify(store.getState().selected);
const groupLabels = { '1': '信任度等级 1', '2': '信任度等级 2', '3': '信任度等级 3', '4': '信任度等级 4', core: '核心任务' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function cleanText(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:b|i|color|size)(?:=[^>]*)?>/gi, '').trim();
}
function assetPath(value) {
  return taskAssetUrl(value);
}
function picture(path, className, { width, height } = {}) {
  const src = assetPath(path);
  if (!src) return null;
  const image = element('img', className);
  image.src = src; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
  if (width) image.width = width;
  if (height) image.height = height;
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  return image;
}
function questPicture(task, className) {
  const entry = state.assets.quests?.[task.imageKey || task.id];
  if(className==='detail-hero'&&task.seasonFlowId&&!entry?.file)return null;
  const fallback = state.assets.fallback?.quest;
  return picture(entry?.file || (typeof fallback === 'string' ? fallback : fallback?.file), className);
}
function traderPortrait(trader) {
  if(trader.category){const icon=element('span','trader-portrait season-category-icon','季');icon.setAttribute('aria-hidden','true');return icon;}
  const wrapper = element('span', 'trader-portrait', trader.name?.slice(0, 1) || '人');
  const photo = picture(state.assets.traders?.[trader.imageKey||trader.id]?.file, 'trader-portrait', { width: 51, height: 51 });
  if (photo) { wrapper.textContent = ''; wrapper.append(photo); photo.addEventListener('error', () => { wrapper.textContent = trader.name?.slice(0, 1) || '人'; }); }
  return wrapper;
}
function mapLink(id, taskId) {
  const base = atlasMapHref(id);
  return `${base}${base.includes('?') ? '&' : '?'}myTasks=1${taskId ? `&task=${encodeURIComponent(taskId)}` : ''}`;
}
function objectiveProgress(task) {
  const objectives = task.objectives || [];
  return { done: objectives.filter(objective => store.isCompleted(task.id, objective.id)).length, total: objectives.length };
}
function announce(text) {
  clearTimeout(toastTimer); $('taskToast').textContent = text; $('taskToast').hidden = false;
  toastTimer = setTimeout(() => { $('taskToast').hidden = true; }, 2300);
}
function selectedTasks() { return state.catalogue.tasks.filter(task => store.isSelected(task.id)); }
function rememberGroup(key,open){
  if(state.opened.get(key)===open)return;
  state.opened.set(key,open);
  savePagePreferences(preferenceKey,{opened:{...readPagePreferences(preferenceKey).opened,[key]:open}});
}
function setView(view) {
  state.view = view;
  savePagePreferences(preferenceKey,{view});
  const url = new URL(location.href);
  if (view !== 'overview') url.searchParams.set('view', view); else url.searchParams.delete('view');
  replacePageUrl(url);
  render();
}
function renderTraders() {
  const bar = $('traderBar'), scrollLeft = bar.scrollLeft; bar.replaceChildren();
  const tasks = state.view !== 'overview' ? selectedTasks() : state.catalogue.tasks;
  const traders = [...(state.view !== 'overview' ? [{ id: '', name: '全部商人' }] : []),...state.catalogue.traders,SEASON_CATEGORY];
  const current = state.view !== 'overview' ? state.mineTrader : state.trader;
  for (const trader of traders) {
    const count = tasks.filter(task => matchesTaskCategory(task,trader.id,{overview:state.view==='overview'})).length;
    const button = element('button', 'trader-button'); button.type = 'button';
    button.setAttribute('aria-pressed', String(current === trader.id));
    const unavailable=trader.id===SEASON_CATEGORY_ID&&!state.catalogue.tasks.some(task=>task.seasonId);
    button.setAttribute('aria-label', `${trader.name}，${unavailable?'资料待补齐':count+' 个任务'}`);
    button.append(traderPortrait(trader), element('span', '', trader.name), element('span', 'trader-count', unavailable?'待补齐':count));
    button.addEventListener('click', () => {
      const field=state.view==='overview'?'trader':'mineTrader';
      state[field]=trader.id;savePagePreferences(preferenceKey,{[field]:trader.id});
      render();
      $('traderBar').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    });
    bar.append(button);
  }
  bar.scrollLeft = current===SEASON_CATEGORY_ID ? bar.scrollWidth : scrollLeft;
}
function filterTasks(tasks) {
  const text = state.search.toLocaleLowerCase().trim();
  if (!text) return tasks;
  const tokens = text.split(/\s+/).filter(Boolean);
  return tasks.filter(task => {
    const haystack = [task.name, task.en, ...(task.objectives || []).map(objective => objective.text), ...(task.mapIds || []).map(id => mapById.get(id)?.name)].join(' ').toLocaleLowerCase();
    return tokens.every(token => haystack.includes(token));
  });
}
function createSelection(task, className = 'task-select-label') {
  const label = element('label', className);
  const input = element('input'); input.type = 'checkbox'; input.checked = store.isSelected(task.id);
  input.dataset.selectTask = task.id;
  input.setAttribute('aria-label', `加入我的任务：${task.name}`);
  input.addEventListener('change', () => {
    store.toggleTask(task.id, input.checked);
    if (store.getStatus?.().persistent === false) announce('进度暂仅在本页保存');
  });
  label.append(input, element('span', '', className === 'detail-select' ? '加入我的任务' : '我的任务'));
  return label;
}
function createCompletion(task){
  const label=element('label','task-complete-label'),input=element('input');input.type='checkbox';input.dataset.completeTask=task.id;
  input.checked=store.isTaskCompleted(task.id);input.setAttribute('aria-label',`任务已完成：${task.name}`);
  input.addEventListener('change',()=>{store.setTaskCompleted(task.id,input.checked);if(!store.getStatus().persistent)announce('进度暂仅在本页保存');});
  label.append(input,element('span','','已完成'));return label;
}
function createAcceptance(task){
  const label=element('label','task-complete-label'),input=element('input');input.type='checkbox';input.dataset.acceptTask=task.id;
  input.setAttribute('aria-label',`任务已接取：${task.name}`);
  input.addEventListener('change',()=>{store.setTaskAccepted(task.id,input.checked);if(!store.getStatus().persistent)announce('进度暂仅在本页保存');});
  label.append(input,element('span','','已接取'));return label;
}
function renderCardRequirements(host,task,progress){
  const rows=taskRequirementRows(task,progress);host.hidden=!rows.length;
  host.replaceChildren(...rows.map(row=>{const line=element('span',`requirement-${row.status}`,`${row.status==='met'?'✓ ':''}${row.text}`);line.dataset.prerequisite=row.prerequisite.id;return line;}));
}
function renderLoyalty(){
  let host=$('traderLoyalty');
  if(!host){host=element('label','trader-loyalty');host.id='traderLoyalty';$('listTitle').parentElement.append(host);}
  const traderId=state.view==='overview'?state.trader:state.mineTrader;
  const applicable=traderId&&state.catalogue.tasks.some(task=>task.prerequisites.some(p=>p.type==='TraderLoyalty'&&p.raw.target===traderId));
  host.hidden=!applicable||state.view==='preparation';host.replaceChildren();if(host.hidden)return;
  const select=element('select');select.setAttribute('aria-label','当前商人信任度');
  for(const [value,label] of [['','未设置'],['1','等级 1'],['2','等级 2'],['3','等级 3'],['4','等级 4']]){const option=element('option','',label);option.value=value;select.append(option);}
  select.value=String(store.getState().loyaltyLevels[traderId]||'');select.dataset.loyaltyTrader=traderId;
  select.addEventListener('change',()=>store.setLoyaltyLevel(traderId,select.value?Number(select.value):null));host.append(element('span','','当前信任度'),select);
}
function createCard(task, geometry = null) {
  const card = element('article', 'task-card'); card.dataset.taskCard = task.id;
  if (Number.isFinite(geometry?.x)) Object.assign(card.style, { left: `${geometry.x}px`, top: `${geometry.y}px`, width: `${geometry.width}px` });
  const open = element('button', 'task-card-open'); open.type = 'button'; open.setAttribute('aria-label', `查看任务：${task.name}`);
  const head = element('span', 'task-card-head'); const photo = questPicture(task, 'task-card-image');
  if (photo) head.append(photo);
  head.append(element('span', 'task-card-title', task.name)); open.append(head);
  const meta = element('span', 'task-card-meta');
  if(task.seasonId||task.seasonFlowId)meta.append(element('span','card-trader',traderById.get(task.traderId)?.name||'所属商人待核验'));
  if (task.level) meta.append(element('span', '', `Lv. ${task.level}`));
  meta.append(element('span', 'card-maps', (task.mapIds || []).map(id => mapById.get(id)?.name).filter(Boolean).join(' / ') || '其他'));
  open.append(meta);
  if (task.groupUnspecified) open.append(element('span', 'unassigned-label', '未标注分组'));
  const requirements=element('span','task-card-requirements');renderCardRequirements(requirements,task,store.getState());open.append(requirements);
  open.addEventListener('click', () => openDetail(task.id));
  const bottom = element('div', 'task-card-bottom');
  const progress = element('span', 'task-progress'); progress.dataset.taskProgress = task.id;
  bottom.append(createSelection(task),createCompletion(task),progress); card.append(open, bottom);
  return card;
}
function graphContents(tasks) {
  const grid=element('div','task-graph-grid'),scrollbar=element('div','task-graph-scrollbar'),track=element('div'),viewport=element('div','task-graph-viewport');
  scrollbar.append(track);viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','任务关系图，可横向滚动');
  scrollbar.addEventListener('scroll',()=>{viewport.scrollLeft=scrollbar.scrollLeft;});
  viewport.addEventListener('scroll',()=>{scrollbar.scrollLeft=viewport.scrollLeft;});
  const records=taskGraphRecords(tasks,state.catalogue.tasks),initial=layoutTaskGraph(records)[0],cards=new Map();
  const canvas=element('div','task-component');canvas.style.width=initial.width+'px';canvas.style.height=initial.height+'px';
  const initialNodes=new Map(initial.nodes.map(node=>[node.id,node]));
  for(const task of records){const card=createCard(task,initialNodes.get(task.id));cards.set(task.id,card);canvas.append(card);}
  viewport.append(canvas);grid.append(scrollbar,viewport);
  const namespace='http://www.w3.org/2000/svg',svg=document.createElementNS(namespace,'svg');svg.setAttribute('aria-hidden','true');canvas.prepend(svg);
  function arrange(){
    if(!canvas.isConnected||!canvas.getBoundingClientRect().width)return;
    const heights=new Map([...cards].map(([id,card])=>[id,Math.ceil(card.getBoundingClientRect().height)]));
    const component=layoutTaskGraph(records,{cardHeights:heights})[0];
    const width=component.width;
    canvas.style.width=track.style.width=width+'px';canvas.style.height=component.height+'px';
    scrollbar.hidden=width<=viewport.clientWidth;
    svg.setAttribute('viewBox',`0 0 ${width} ${component.height}`);svg.replaceChildren();
    let previous=svg;
    for(const node of [...component.nodes].sort((a,b)=>a.y-b.y||a.x-b.x)){
      const card=cards.get(node.id);Object.assign(card.style,{left:node.x+'px',top:node.y+'px'});
      if(card.previousElementSibling!==previous)canvas.insertBefore(card,previous.nextElementSibling);previous=card;
    }
    for(const edge of component.edges){
      if(edge.cycle)continue;
      const [x2,y2]=edge.points.at(-1);
      const path=document.createElementNS(namespace,'path');path.setAttribute('class','dependency-line');
      path.setAttribute('d',edge.points.map(([x,y],i)=>`${i?'L':'M'} ${x} ${y}`).join(' '));
      const arrow=document.createElementNS(namespace,'path');arrow.setAttribute('class','dependency-arrow');arrow.setAttribute('d',`M ${x2-4} ${y2-3} L ${x2} ${y2+4} L ${x2+4} ${y2-3} Z`);svg.append(path,arrow);
    }
  }
  grid.addEventListener('task-graph-layout',()=>requestAnimationFrame(arrange));
  requestAnimationFrame(arrange);
  return grid;
}
function revealTask(id){
  const task=taskById.get(id);if(!task)return;
  state.view='overview';state.trader=task.seasonFlowId||task.seasonId?SEASON_CATEGORY_ID:task.traderId;state.search='';$('taskSearch').value='';
  state.opened.set(`overview:${state.trader}:${task.seasonStage?`season-${task.seasonStage}`:task.seasonId?'season':task.group}`,true);
  const url=new URL(location.href);url.searchParams.delete('view');replacePageUrl(url);
  render();openDetail(id);
  requestAnimationFrame(()=>document.querySelector(`[data-task-card="${CSS.escape(id)}"]`)?.scrollIntoView({block:'center',inline:'center'}));
}
function arrangeGraphs(){document.querySelectorAll('.task-graph-grid').forEach(grid=>grid.dispatchEvent(new Event('task-graph-layout')));}
window.addEventListener('resize',arrangeGraphs);
function createGroup({ id, title, tasks, graph, mapId }) {
  const details = element('details', 'task-group');
  const key = `${state.view}:${state.view === 'overview' ? state.trader : state.mineTrader}:${id}`;
  let open=state.opened.get(key)??tasks.length>0;
  details.open=open;
  details.dataset.groupKey = key;
  const summary = element('summary', '', title); summary.append(element('span', '', tasks.length));
  if (mapId && ATLAS_MAPS[mapId]) {
    const link = element('a', '', '进入地图 ↗'); link.href = mapLink(mapId); link.addEventListener('click', event => event.stopPropagation()); summary.append(link);
  }
  const content = element('div', 'task-group-body');
  if (!tasks.length) content.append(element('p', 'task-group-empty', state.search ? '没有匹配任务' : '暂无任务'));
  else {
    if (graph && id === 'core' && tasks.some(task => task.groupUnspecified)) content.append(element('p', 'detail-hint', '含未标注分组的任务'));
    if (graph) content.append(graphContents(tasks));
    else {
      const grid=element('div','task-list-grid');
      const list=state.view==='overview'?taskGraphRecords(tasks,state.catalogue.tasks).sort(compareTaskUnlock):tasks;
      list.forEach(task=>grid.append(createCard(task,{external:task.dependencies||[]})));content.append(grid);
    }
  }
  details.append(summary, content);
  details.addEventListener('toggle', () => {
    if(details.isConnected&&details.open!==open){open=details.open;rememberGroup(key,open);}
    if(details.open)content.querySelector('.task-graph-grid')?.dispatchEvent(new Event('task-graph-layout'));
  });
  return details;
}
function emptyState(text, actionText, action) {
  const box = element('div', 'empty-state'); box.append(element('div', 'task-empty-icon', '◇'), element('p', '', text));
  if (actionText) { const button = element('button', 'primary', actionText); button.type = 'button'; button.addEventListener('click', action); box.append(button); }
  return box;
}
function render() {
  if (!state.catalogue) return;
  for(const view of ['overview','mine','preparation']){const tab=$(view+'Tab');tab.setAttribute('aria-selected',String(state.view===view));tab.tabIndex=state.view===view?0:-1;}
  $('taskResults').setAttribute('aria-labelledby', state.view+'Tab');
  $('taskSearch').placeholder = state.view === 'preparation' ? '搜索准备物品、任务或地图' : state.view === 'mine' ? '搜索我的任务或目标' : '搜索当前商人的任务或目标';
  renderTraders();
  renderLoyalty();
  const results = $('taskResults'); results.replaceChildren();
  if(state.view==='preparation'){
    $('listTitle').textContent='战前准备';
    const count=preparation.render({target:results,catalog:state.catalogue,assetManifest:state.assets,traderId:state.mineTrader,search:state.search});
    $('resultCount').textContent=`${count} 项准备`;
    refreshProgress();return;
  }
  preparation.deactivate();
  if (state.view === 'overview') {
    const trader = state.trader===SEASON_CATEGORY_ID?SEASON_CATEGORY:traderById.get(state.trader);
    const tasks = filterTasks(state.catalogue.tasks.filter(task => matchesTaskCategory(task,state.trader,{overview:true})));
    $('listTitle').textContent = trader?.name || '任务总览'; $('resultCount').textContent = `${tasks.length} 个任务`;
    if(state.trader===SEASON_CATEGORY_ID){
      if(!state.catalogue.tasks.some(task=>task.seasonId)){results.append(emptyState('当前数据缺少赛季任务的完整条件，资料待补齐。'));$('resultCount').textContent='待补齐';}
      else if(tasks.some(task=>task.seasonStage)){
        results.append(element('p','season-flow-summary','不速之客 → 数字拼图 → 解锁灯塔商人 → 到灯塔当面接取情报的代价 → 以人类之名 → 历史展望。'));
        results.append(element('p','detail-hint','包含交付分支和并行任务。“逐光而行”与商人列表共用进度；阶段顺序不代替任务卡片中的接取条件。'));
        for(const [stage,title] of [['A','赛季起始'],['B','解锁灯塔商人'],['C','灯塔商人收尾'],['P','并行赛季任务']]){
          const members=tasks.filter(task=>task.seasonStage===stage);
          if(members.length)results.append(createGroup({id:`season-${stage}`,title,tasks:members,graph:stage!=='P'}));
        }
      }else if(!tasks.length)results.append(emptyState('没有匹配任务'));
      else results.append(createGroup({id:'season',title:'赛季任务',tasks,graph:true}));
    }else for (const group of ['1', '2', '3', '4', 'core']) results.append(createGroup({ id: group, title: groupLabels[group], tasks: tasks.filter(task => String(task.group) === group), graph: group==='core' }));
  } else {
    const tasks = filterTasks(selectedTasks().filter(task => matchesTaskCategory(task,state.mineTrader)));
    $('listTitle').textContent = '我的任务'; $('resultCount').textContent = `${tasks.length} 个任务`;
    if (!tasks.length) results.append(emptyState(selectedTasks().length ? '没有匹配任务' : '在任务总览中勾选要完成的任务', selectedTasks().length ? '清除筛选' : '前往任务总览', () => {
      if (selectedTasks().length) { state.search = ''; $('taskSearch').value = ''; state.mineTrader = ''; render(); } else setView('overview');
    }));
    else for (const group of groupTasksByMap(tasks, state.catalogue.maps)) results.append(createGroup({ id: group.id, title: group.name, tasks: group.tasks, graph: false, mapId: group.id }));
  }
  refreshProgress();
}
function refreshProgress() {
  if (!state.catalogue) return;
  const progress=store.getState();
  $('selectedCount').textContent = selectedTasks().length;
  for (const input of document.querySelectorAll('[data-select-task]')) input.checked = store.isSelected(input.dataset.selectTask);
  for(const input of document.querySelectorAll('[data-complete-task]'))input.checked=store.isTaskCompleted(input.dataset.completeTask);
  for(const input of document.querySelectorAll('[data-accept-task]')){input.checked=store.isTaskAccepted(input.dataset.acceptTask)||store.isTaskCompleted(input.dataset.acceptTask);input.disabled=store.isTaskCompleted(input.dataset.acceptTask);}
  for(const select of document.querySelectorAll('[data-loyalty-trader]'))select.value=String(progress.loyaltyLevels[select.dataset.loyaltyTrader]||'');
  for (const node of document.querySelectorAll('[data-task-progress]')) {
    const task = taskById.get(node.dataset.taskProgress), { done, total } = objectiveProgress(task);
    node.textContent = `${done} / ${total}`; node.classList.toggle('done', total > 0 && done === total);
  }
  for (const card of document.querySelectorAll('[data-task-card]')) {
    const task = taskById.get(card.dataset.taskCard), { done, total } = objectiveProgress(task);
    card.classList.toggle('is-selected', store.isSelected(task.id)); card.classList.toggle('is-active', state.detail === task.id); card.classList.toggle('is-complete', store.isTaskCompleted(task.id));
    renderCardRequirements(card.querySelector('.task-card-requirements'),task,progress);
  }
  for (const input of document.querySelectorAll('[data-objective-id]')) {
    const done = store.isCompleted(input.dataset.taskId, input.dataset.objectiveId);
    input.checked = done;input.disabled=store.isTaskCompleted(input.dataset.taskId);input.title=input.disabled?'取消任务“已完成”后可修改单项目标':''; input.closest('.objective-row').classList.toggle('is-complete', done);
  }
  if (state.detail) {
    const task = taskById.get(state.detail), { done, total } = objectiveProgress(task);
    const count = $('detailProgress'); if (count) count.textContent = `${done} / ${total}`;
    const hint = $('detailMapHint'); if (hint) hint.hidden = store.isSelected(task.id);
    for(const row of taskRequirementRows(task,progress)){
      const li=$('detailContent').querySelector(`[data-prerequisite="${CSS.escape(row.prerequisite.id)}"]`);if(!li)continue;
      li.className=`requirement-${row.status}`;li.querySelector('.prerequisite-text').textContent=`${row.status==='met'?'✓ ':''}${row.text}`;
    }
    for(const link of $('detailContent').querySelectorAll('[data-related-task]'))link.classList.toggle('is-complete',store.isTaskCompleted(link.dataset.relatedTask));
  }
  arrangeGraphs();
}
function detailSection(title, content) {
  const section = element('section', 'detail-section'); section.append(element('h3', '', title), content); return section;
}
function requirements(details) {
  const list = element('ul', 'objective-requirements');
  for (const detail of details || []) {
    const text = typeof detail === 'string' ? detail : [detail.label, detail.text].filter(Boolean).join('：');
    if (text) list.append(element('li', '', cleanText(text)));
  }
  return list;
}
function objectiveItems(ids) {
  const itemIds = [...new Set(ids || [])].filter(id => state.catalogue.items?.[id]);
  const wrapper = element('div', 'objective-items');
  let shown = 0;
  const more = element('button', 'objective-items-more'); more.type = 'button';
  function add(count) {
    for (const id of itemIds.slice(shown, shown + count)) {
      const item = state.catalogue.items[id], node = element('div', 'objective-item');
      const image = picture(item.icon || state.assets.items?.[id]?.file, '', { width: 31, height: 31 });
      if (image) node.append(image);
      node.append(element('span', '', item.name || item.en || '物品')); wrapper.append(node);
    }
    shown = Math.min(shown + count, itemIds.length);
    more.textContent = `更多物品（${itemIds.length - shown}）`;
    if (shown < itemIds.length) wrapper.append(more); else more.remove();
  }
  more.addEventListener('click', () => add(24));
  add(12);
  return wrapper;
}
function objectiveAccess(access) {
  const list = element('ul', 'objective-access');
  for (const entry of access) {
    const row = element('li');
    const map = mapById.get(entry.mapId);
    const badge = accessLabels[entry.bring || 'required'];
    const names = entry.options.map(group => group.map(id => {
      const item = state.catalogue.items[id];
      return item.name || item.en;
    }).join(' ＋ ')).join(' 或 ');
    const heading = element('div', 'objective-access-heading');
    heading.append(element('span', 'prep-tag', badge), element('strong', '', `${map.name} · ${entry.location}`));
    row.append(heading, element('p', 'objective-access-keys', names));
    if (entry.note) row.append(element('p', 'objective-access-note', entry.note));
    list.append(row);
  }
  return list;
}
function renderDetail(task) {
  const host = $('detailContent'); host.replaceChildren();
  const hero = questPicture(task, 'detail-hero'); if (hero) { hero.loading = 'eager'; host.append(hero); }
  const trader = traderById.get(task.traderId);
  const traderLine = element('div', 'detail-trader');
  const traderPhoto = picture(state.assets.traders?.[traderById.get(task.traderId)?.imageKey||task.traderId]?.file, '', { width: 28, height: 28 }); if (traderPhoto) traderLine.append(traderPhoto);
  traderLine.append(element('span', '', trader?.name || '任务')); host.append(traderLine);
  const title = element('h2', '', task.name); title.id = 'detailTitle'; title.tabIndex = -1; host.append(title);
  const labels = element('div', 'detail-labels');
  labels.append(element('span', '', task.seasonId ? '赛季任务' : task.seasonFlowId ? '灯塔商人解锁' : task.groupUnspecified ? '未标注分组' : groupLabels[task.group] || '任务'));
  if (task.level) labels.append(element('span', '', `角色等级 ${task.level}`));
  if (task.side && task.side !== 'Pmc' && task.side !== 'Any') labels.append(element('span', '', task.side === 'Savage' ? 'Scav' : task.side));
  const actions=element('div','detail-task-actions');actions.append(createSelection(task,'detail-select'),createAcceptance(task),createCompletion(task));host.append(labels,actions);
  const prerequisites = element('ul', 'prerequisite-list');
  for (const prerequisite of taskVisiblePrerequisites(task)) {
    const li = element('li');li.dataset.prerequisite=prerequisite.id;li.append(element('span','prerequisite-text',cleanText(prerequisite.text)||'查看关联任务'));
    const ids = [...new Set([prerequisite.taskId, ...(prerequisite.taskIds || [])].filter(Boolean))];
    const links = element('div', 'prerequisite-links');
    for (const id of ids) if (taskById.has(id)) {
      const target = taskById.get(id); const button = element('button', 'prerequisite-link', target.name); button.type = 'button';button.dataset.relatedTask=id; button.addEventListener('click', () => revealTask(id)); links.append(button);
    }
    if (links.childElementCount) li.append(links);
    if(prerequisite.progressRequirement){
      const progress=prerequisite.progressRequirement;
      const addTasks=(ids,title)=>{
        const available=[...new Set(ids)].filter(id=>taskById.has(id));if(!available.length)return;
        const details=element('details','progress-contributors');details.append(element('summary','',`${title}（${available.length}）`));
        const list=element('div','prerequisite-links');
        for(const id of available){const related=taskById.get(id),button=element('button','prerequisite-link',`${related.name} · ${groupLabels[related.group]||'任务'}`);button.type='button';button.dataset.relatedTask=id;button.addEventListener('click',()=>revealTask(id));list.append(button);}
        details.append(list);li.append(details);
      };
      addTasks(progress.contributors.map(p=>p.taskId),'完成每项推进 1 点');
      for(const alternative of progress.alternatives)addTasks(alternative.taskIds,`可替代来源 · 每项 ${alternative.contribution} 点，合计最多 ${alternative.capacity} 点`);
      if(progress.alternatives.length)li.append(element('p','detail-hint','可替代来源的具体对应尚未完全确认。'));
      if(progress.contributors.some(p=>!p.visible))li.append(element('p','detail-hint','另有未收录名称的剧情阶段可推进进度。'));
    }
    if (prerequisite.details?.length) li.append(requirements(prerequisite.details));
    prerequisites.append(li);
  }
  if (prerequisites.childElementCount) host.append(detailSection('前置要求', prerequisites));
  else host.append(detailSection('前置要求', element('p', 'detail-description', '无')));
  if(task.notes?.length)host.append(detailSection('任务提示',requirements(task.notes)));
  const objectives = element('div', 'objective-list');
  for (const objective of task.objectives || []) {
    const row = element('div', 'objective-row');
    const label = element('label', 'objective-label'); const input = element('input'); input.type = 'checkbox';
    input.dataset.taskId = task.id; input.dataset.objectiveId = objective.id;
    const text = cleanText(objective.text) || '任务目标'; input.setAttribute('aria-label', `已完成：${text}`);
    input.addEventListener('change', () => { store.setCompleted(task.id, objective.id, input.checked); if (store.getStatus?.().persistent === false) announce('进度暂仅在本页保存'); });
    label.append(input, element('span', 'objective-text', text)); row.append(label);
    const notes = element('div', 'objective-notes');
    if (objective.optional) notes.append(element('span', '', '可选'));
    if (objective.foundInRaid) notes.append(element('span', '', '战局中找到'));
    if (Number(objective.count) > 1 && objective.showCount !== false && ['CounterCreator', 'HandoverItem', 'FindItem', 'LeaveItemAtLocation', 'PlaceBeacon', 'WeaponAssembly', 'SellItemToTrader'].includes(objective.type)) notes.append(element('span', '', `数量 ${objective.count}`));
    const mapNames = (objective.mapIds || []).map(id => mapById.get(id)?.name).filter(Boolean); if (mapNames.length) notes.append(element('span', '', mapNames.join(' / ')));
    if (notes.childElementCount) row.append(notes);
    if (objective.access?.length) row.append(objectiveAccess(objective.access));
    if(objective.acquisition?.text)row.append(element('p','objective-acquisition',objective.acquisition.text));
    if (objective.details?.length) row.append(requirements(objective.details));
    if(objective.relatedTaskIds?.length){
      const links=element('div','prerequisite-links');
      for(const id of objective.relatedTaskIds){const related=taskById.get(id);if(!related)continue;const button=element('button','prerequisite-link',`完成“${related.name}”后回来交付`);button.type='button';button.addEventListener('click',()=>revealTask(id));links.append(button);}row.append(links);
    }
    const items = objectiveItems(objective.itemIds);
    if (items.childElementCount) row.append(items);
    objectives.append(row);
  }
  if (!objectives.childElementCount) objectives.append(element('p', 'detail-description', '暂无目标记录'));
  const objectivesSection = detailSection('任务目标', objectives); const counter = element('span'); counter.id = 'detailProgress'; objectivesSection.querySelector('h3').append(counter); host.append(objectivesSection);
  const mapLinks = element('div', 'detail-map-links');
  for (const id of task.mapIds || []) if (ATLAS_MAPS[id]) { const link = element('a', '', `${ATLAS_MAPS[id].name} ↗`); link.href = mapLink(id, task.id); mapLinks.append(link); }
  if (mapLinks.childElementCount) {
    const section = detailSection('任务地图', mapLinks); const hint = element('p', 'detail-hint', '加入“我的任务”后，可在地图筛选对应目标。'); hint.id = 'detailMapHint'; section.append(hint); host.append(section);
  }
  if (task.description) {
    const story = element('details', 'detail-story'); story.append(element('summary', '', '任务描述'), element('p', 'detail-description', cleanText(task.description))); host.append(story);
  }
}
function openDetail(id, { updateUrl = true, focus = true } = {}) {
  const task = taskById.get(id); if (!task) return;
  if (!state.detail) lastFocus = document.activeElement;
  state.detail = id; renderDetail(task);
  $('taskDetail').hidden = false; $('detailBackdrop').hidden = !smallScreen.matches;
  $('taskDetail').setAttribute('aria-modal', String(smallScreen.matches)); document.body.classList.add('task-detail-open');
  if(state.trader===SEASON_CATEGORY_ID)$('traderBar').scrollLeft=$('traderBar').scrollWidth;
  arrangeGraphs();
  $('detailContent').scrollTop = 0;
  if (updateUrl) { const url = new URL(location.href); url.searchParams.set('task', id); replacePageUrl(url); }
  refreshProgress(); if (focus) $('detailTitle').focus({ preventScroll: true });
}
function closeDetail() {
  state.detail = null; $('taskDetail').hidden = true; $('detailBackdrop').hidden = true; document.body.classList.remove('task-detail-open');
  arrangeGraphs();
  const url = new URL(location.href); url.searchParams.delete('task'); replacePageUrl(url);
  refreshProgress(); if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); lastFocus = null;
}
async function load() {
  $('loadingMessage').hidden = false; $('loadError').hidden = true; $('taskResults').setAttribute('aria-busy', 'true');
  try {
    const [catalogueResponse, assetsResponse, preparationResponse] = await Promise.all([fetch('data/tasks/catalog.json'), fetch('data/tasks/assets/manifest.json').catch(() => null),fetch('data/tasks/preparation-items.json').catch(()=>null)]);
    if (!catalogueResponse.ok) throw new Error('Task catalogue unavailable');
    const data = await catalogueResponse.json();
    if (!Array.isArray(data.tasks) || !Array.isArray(data.traders) || !Array.isArray(data.maps)) throw new Error('Invalid task catalogue');
    const extra=preparationResponse?.ok?await preparationResponse.json().catch(()=>null):null;
    if(extra?.schemaVersion===1&&extra.source?.sptCommit===data.source?.sptCommit)data.items={...extra.items,...data.items};
    const catalogue = applyTaskAccess(data);
    catalogue.traders=presentTraders(catalogue.traders);
    state.catalogue = catalogue; state.assets = assetsResponse?.ok ? await assetsResponse.json().catch(() => ({})) : {};
    taskById = new Map(catalogue.tasks.map(task => [task.id, task])); traderById = new Map(catalogue.traders.map(trader => [trader.id, trader])); mapById = new Map(catalogue.maps.map(map => [map.id, map]));
    if(state.trader!==SEASON_CATEGORY_ID&&!traderById.has(state.trader))state.trader=catalogue.traders[0]?.id;
    if(state.mineTrader!==SEASON_CATEGORY_ID&&!traderById.has(state.mineTrader))state.mineTrader='';
    const linkedTask = taskById.get(query.get('task'));
    if (linkedTask) state.trader = linkedTask.seasonFlowId||linkedTask.seasonId?SEASON_CATEGORY_ID:linkedTask.traderId;
    render(); if (linkedTask) openDetail(linkedTask.id, { updateUrl: false, focus: false });
    if (store.getStatus?.().persistent === false) announce('进度暂仅在本页保存');
  } catch (error) { console.warn('Task page load failed', error); $('loadError').hidden = false; }
  finally { $('loadingMessage').hidden = true; $('taskResults').setAttribute('aria-busy', 'false'); }
}
$('overviewTab').addEventListener('click', () => setView('overview'));
$('mineTab').addEventListener('click', () => setView('mine'));
$('preparationTab').addEventListener('click', () => setView('preparation'));
for (const id of ['overviewTab', 'mineTab','preparationTab']) $(id).addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const view=views[event.key==='Home'?0:event.key==='End'?2:(views.indexOf(state.view)+(event.key==='ArrowRight'?1:2))%3];
  setView(view); $(view+'Tab').focus();
});
let searchTimer = 0;
$('taskSearch').addEventListener('input', () => {
  state.search=$('taskSearch').value.slice(0,200);savePagePreferences(preferenceKey,{search:state.search});
  clearTimeout(searchTimer);searchTimer=setTimeout(render,120);
});
$('expandGroups').addEventListener('click', () => document.querySelectorAll('.task-group').forEach(group => { group.open = true; rememberGroup(group.dataset.groupKey, true); }));
$('collapseGroups').addEventListener('click', () => document.querySelectorAll('.task-group').forEach(group => { group.open = false; rememberGroup(group.dataset.groupKey, false); }));
$('closeDetail').addEventListener('click', closeDetail); $('detailBackdrop').addEventListener('click', closeDetail); $('retryLoad').addEventListener('click', load);
smallScreen.addEventListener('change', () => { if (state.detail) { $('detailBackdrop').hidden = !smallScreen.matches; $('taskDetail').setAttribute('aria-modal', String(smallScreen.matches)); } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.detail) { event.preventDefault(); closeDetail(); }
  if (event.key === '/' && !state.detail && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('taskSearch').focus(); }
  if (event.key === 'Tab' && state.detail && smallScreen.matches) {
    const focusable = [...$('taskDetail').querySelectorAll('button,a[href],input,summary')].filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === $('detailTitle'))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
store.subscribe(() => {
  if(state.view==='preparation'){lastSelection=JSON.stringify(store.getState().selected);render();return;}
  const selection = JSON.stringify(store.getState().selected);
  if (selection !== lastSelection) {
    lastSelection = selection;
    if (state.view === 'mine') render(); else { renderTraders(); refreshProgress(); }
  } else refreshProgress();
});
load();
