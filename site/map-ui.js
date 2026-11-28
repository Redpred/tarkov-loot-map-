import {icon} from './ui-icons.js';
import {mapInterfaceKey,readPagePreferences,savePagePreferences} from './atlas-page-session.js';
import {createFilterMode} from './atlas-point-selection.js';
import {COMPACT_LAYOUT_QUERY,bindVisualViewport,bindCompactHeader} from './atlas-layout.js';
import {createFullscreenButton} from './atlas-fullscreen.js';
import {bindMapInteractionGuards} from './atlas-interaction.js';
import {createMapSkinUI} from './atlas-map-skin.js';

// Pure UI composition: the existing data filters and renderer keep their IDs.
export function installMapUI({map,layout,isFirstPerson,onSkinChange,onFilterMode=()=>{}}){
  const $=id=>document.getElementById(id);
  document.body.classList.add('map-app');
  bindVisualViewport();
  bindMapInteractionGuards();
  const header=document.querySelector('body>header'),headerToggle=document.createElement('button');
  header.id='mapHeader';headerToggle.id='toggleMapHeader';headerToggle.type='button';
  headerToggle.setAttribute('aria-controls',header.id);
  headerToggle.innerHTML='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 15 7-7 7 7"/></svg>';
  document.body.append(headerToggle);bindCompactHeader({header,button:headerToggle});
  $('leaveFirstPerson').textContent='退出';$('leaveFirstPerson').setAttribute('aria-label','退出第一人称');
  const mapSelect=$('mapSwitch'),switchLabel=document.createElement('label');
  switchLabel.className='map-switch-label';switchLabel.htmlFor='mapSwitch';switchLabel.textContent='切换区域';mapSelect.before(switchLabel);

  const preferenceKey=mapInterfaceKey(map.id),saved=readPagePreferences(preferenceKey);
  const mode=createFilterMode(),search=$('search'),searchWrap=document.createElement('div');searchWrap.className='map-search-field';
  search.before(searchWrap);searchWrap.innerHTML=icon('search');searchWrap.append(search);searchWrap.insertAdjacentHTML('beforeend','<kbd aria-hidden="true">/</kbd>');
  search.placeholder='查找物品、类型或任务…';search.setAttribute('aria-keyshortcuts','/');
  const searchLabel=document.querySelector('label[for="search"]');searchLabel.textContent='查找物品、类型或任务，勾选后显示';
  $('clearSearch').textContent='清除搜索';$('clearSearch').title='清除查找文字，保留勾选';$('searchAmmo')?.remove();
  const filters=$('filterBody'),quick=document.querySelector('.quick');filters.querySelector('.eyebrow')?.remove();
  const tabs=document.createElement('div');tabs.className='filter-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','点位面板');
  tabs.innerHTML='<button id="filterTab" role="tab" aria-controls="filterPane">点位筛选</button><button id="valueTab" role="tab" aria-controls="valuePane">价值筛选</button><button id="listTab" role="tab" aria-controls="resultsSection">点位列表 <span id="listCount">—</span></button>';
  filters.prepend(tabs);
  const pane=document.createElement('div');pane.id='filterPane';pane.className='filter-pane';pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','filterTab');
  const valuesPane=document.createElement('div');valuesPane.id='valuePane';valuesPane.className='filter-pane';valuesPane.setAttribute('role','tabpanel');valuesPane.setAttribute('aria-labelledby','valueTab');
  const values=document.createElement('details');values.id='valueFilterSection';values.className='filter-section';values.open=true;
  const status=document.createElement('div');status.id='valueFilterStatus';status.setAttribute('role','status');valuesPane.append(values,status);
  const resetValue=document.createElement('button');resetValue.id='clearValueFilters';resetValue.className='clear-filter-button';resetValue.textContent='清除价值条件';valuesPane.append(resetValue);
  const clear=document.createElement('button');clear.id='clearPointFilters';clear.type='button';clear.className='clear-filter-button';clear.textContent='清空点位选择';
  filters.append(pane,valuesPane);
  pane.append(searchLabel,searchWrap,quick,$('targetItemSection'),$('typeSection'),clear);
  $('pointTypes').classList.add('point-type-tree');$('pointTypes').after($('myTaskSection'),$('poiCoverage'));
  $('targetItemSection').open=false;$('typeSection').open=true;$('myTaskSection').open=false;
  for(const section of [$('targetItemSection'),$('typeSection'),$('myTaskSection'),values])layout.rememberSection(section);
  $('typeSection').querySelector('summary').innerHTML='点位类型 <small>多选显示</small>';
  $('selectAllTypes').textContent='全选';$('clearAllTypes').textContent='取消全选';
  const results=$('resultsSection');results.open=true;results.setAttribute('role','tabpanel');results.setAttribute('aria-labelledby','listTab');
  const resultMode=document.createElement('p');resultMode.id='resultFilterMode';resultMode.className='hint';results.querySelector('.results-title').before(resultMode);
  filters.append(pane,valuesPane,results);
  function showTab(name,remember=true){
    if(name==='filter')name='point';const old=mode.mode;mode.select(name);
    pane.hidden=name!=='point';valuesPane.hidden=name!=='value';results.hidden=name!=='list';
    for(const [id,value] of [['filterTab','point'],['valueTab','value'],['listTab','list']]){$(id).setAttribute('aria-selected',String(value===name));$(id).tabIndex=value===name?0:-1;}
    document.body.dataset.filterMode=mode.mode;resultMode.textContent='当前结果：'+(mode.mode==='value'?'价值筛选':'点位筛选');
    if(remember)savePagePreferences(preferenceKey,{filterTab:mode.tab,filterMode:mode.mode});
    if(name!=='point')search.dispatchEvent(new Event('blur'));if(old!==mode.mode)onFilterMode(mode.mode);
  }
  $('filterTab').onclick=()=>showTab('point');$('valueTab').onclick=()=>showTab('value');$('listTab').onclick=()=>showTab('list');
  tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const names=['point','value','list'],ids=['filterTab','valueTab','listTab'],at=ids.indexOf(event.target.id),next=event.key==='Home'?0:event.key==='End'?2:(at+(event.key==='ArrowRight'?1:-1)+3)%3;showTab(names[next]);$(ids[next]).focus();};
  mode.select(saved.filterMode==='value'?'value':'point');
  showTab(saved.filterTab==='list'?'list':mode.mode,false);
  const countObserver=new MutationObserver(()=>{$('listCount').textContent=$('resultCount').textContent;});countObserver.observe($('resultCount'),{childList:true,characterData:true,subtree:true});
  const regions=document.createElement('fieldset');regions.innerHTML='<legend>区域名称</legend>';regions.append(document.querySelector('.region-controls'));$('settings-markers').append(regions);
  const arrival=$('showRegionArrival').closest('label'),arrivalRow=document.createElement('div');
  arrivalRow.className='settings-inline';
  arrival.removeAttribute('title');
  arrival.before(arrivalRow);arrivalRow.append(arrival);
  arrivalRow.insertAdjacentHTML('beforeend','<button type="button" class="settings-info" data-settings-tip="regionArrivalHelp" aria-label="区域提示说明" aria-describedby="regionArrivalHelp">?</button><p id="regionArrivalHelp" hidden>靠近已命名的区域时会显示提示，触发范围以区域名称的位置为中心。</p>');
  const heightDialog=document.createElement('dialog');heightDialog.id='heightDialog';heightDialog.className='height-dialog';heightDialog.setAttribute('aria-labelledby','heightTitle');
  heightDialog.innerHTML='<div class="height-dialog-head"><h2 id="heightTitle">高度分层</h2><button id="closeHeight" type="button" aria-label="关闭高度分层">×</button></div><p class="hint">楼层预设按区域分别剖切。拖动滑条可改为全图统一剖切，保留剖切面以下的内容。</p>';
  $('heightSection').open=true;heightDialog.append($('heightSection'));document.body.append(heightDialog);
  $('heightSection').querySelector('label[for="cutHeight"]').firstChild.textContent='全图剖切上限 ';
  const heightButton=document.createElement('button');heightButton.id='openHeight';heightButton.type='button';heightButton.innerHTML=icon('layers')+'<span>高度</span>';heightButton.setAttribute('aria-controls','heightDialog');heightButton.setAttribute('aria-expanded','false');heightButton.setAttribute('aria-label','高度分层');
  function closeHeight(){heightDialog.close();heightButton.setAttribute('aria-expanded','false');}
  heightButton.onclick=()=>{if(heightDialog.open)closeHeight();else{heightDialog.show();heightButton.setAttribute('aria-expanded','true');}};
  $('closeHeight').onclick=()=>{closeHeight();heightButton.focus();};heightDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHeight();heightButton.focus();}});
  document.addEventListener('pointerdown',event=>{if(heightDialog.open&&!heightDialog.contains(event.target)&&!heightButton.contains(event.target))closeHeight();});

  const tools=document.querySelector('.map-tools');tools.setAttribute('aria-label','地图视图工具');
  const measureButton=document.createElement('button');measureButton.id='measureDistance';measureButton.type='button';tools.append(measureButton);
  const toolInfo=[['topView','grid','俯视','1'],['orbitView','cube','三维','2'],['flyView','fly','自由飞行',''],['resetView','reset','复位','R'],['toggleGeometry','layers','场景',''],['measureDistance','ruler','测距','']];
  for(const [id,glyph,label,key] of toolInfo){const button=$(id);button.innerHTML=icon(glyph)+`<span>${label}</span>`;button.title=label+(key?`（${key}）`:'');button.setAttribute('aria-label',label);if(key)button.setAttribute('aria-keyshortcuts',key);tools.append(button);}
  tools.append(heightButton);
  tools.insertAdjacentHTML('beforeend',`<button id="focusMap" aria-label="专注地图" aria-pressed="false" title="收起所有面板（H）">${icon('focus')}<span>专注</span></button><button id="openMapHelp" aria-label="操作指南" title="操作指南（?）">${icon('help')}</button>`);
  $('openMapHelp').insertAdjacentHTML('beforeend','<span>操作指南</span>');
  const settings=$('viewSettings');
  const headerTools=document.createElement('div');headerTools.className='header-map-tools';
  const settingsButton=$('openViewSettings');settingsButton.innerHTML=icon('settings')+'<span>设置</span>';settingsButton.setAttribute('aria-label','地图设置');
  headerTools.append(settingsButton,createMapSkinUI({settings,onChange:onSkinChange}).button);header.append(headerTools);
  tools.append(createFullscreenButton());
  const compact=window.matchMedia(COMPACT_LAYOUT_QUERY),narrowTools=window.matchMedia('(max-width:400px)'),extraTools=document.createElement('div');
  extraTools.id='extraMapTools';extraTools.setAttribute('aria-label','更多地图工具');
  const moreButton=document.createElement('button');moreButton.id='moreMapTools';moreButton.setAttribute('aria-label','更多工具');moreButton.setAttribute('aria-controls',extraTools.id);moreButton.setAttribute('aria-expanded','false');
  moreButton.innerHTML='<span class="more-dots" aria-hidden="true">•••</span><span>更多</span>';tools.append(extraTools,moreButton);
  function closeMore(){if(compact.matches)extraTools.hidden=true;moreButton.setAttribute('aria-expanded','false');}
  function arrangeTools(){
    closeMore();extraTools.hidden=compact.matches;moreButton.hidden=!compact.matches;
    for(const id of ['flyView','resetView','toggleGeometry','focusMap','openMapHelp'])extraTools.append($(id));
    if(compact.matches&&narrowTools.matches)extraTools.append($('fullscreenMap'));
    else tools.insertBefore($('fullscreenMap'),extraTools);
    if(!compact.matches){for(const [id] of toolInfo)tools.insertBefore($(id),extraTools);for(const id of ['focusMap','fullscreenMap','openMapHelp'])tools.insertBefore($(id),extraTools);}
  }
  moreButton.onclick=()=>{extraTools.hidden=!extraTools.hidden;moreButton.setAttribute('aria-expanded',String(!extraTools.hidden));};
  extraTools.addEventListener('click',event=>{if(event.target.closest('button'))closeMore();});
  tools.addEventListener('click',event=>{if(event.target.closest('button')!==moreButton&&!extraTools.contains(event.target))closeMore();});
  document.addEventListener('pointerdown',event=>{if(!tools.contains(event.target))closeMore();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&compact.matches&&!extraTools.hidden){closeMore();moreButton.focus();}});
  compact.addEventListener('change',arrangeTools);narrowTools.addEventListener('change',arrangeTools);arrangeTools();
  function updateFocusButton(){
    const active=document.body.classList.contains('focus-map'),button=$('focusMap');
    button.setAttribute('aria-pressed',String(active));
    button.title=active?'恢复面板（H）':'收起所有面板（H）';
  }
  $('focusMap').onclick=()=>layout.focus();
  const bodyObserver=new MutationObserver(updateFocusButton);
  bodyObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  updateFocusButton();
  // Mirror visual toggle state for keyboard and screen-reader users.
  const activeObserver=new MutationObserver(()=>{for(const [id] of toolInfo)if(!['resetView','openViewSettings'].includes(id))$(id).setAttribute('aria-pressed',String($(id).classList.contains('active')));});
  for(const [id] of toolInfo)activeObserver.observe($(id),{attributes:true,attributeFilter:['class']});
  for(const [id] of toolInfo)if(!['resetView','openViewSettings'].includes(id))$(id).setAttribute('aria-pressed',String($(id).classList.contains('active')));
  const guide=document.createElement('dialog');guide.className='map-guide';guide.setAttribute('aria-labelledby','guideTitle');
  guide.innerHTML=`<div class="guide-head"><h2 id="guideTitle">操作指南</h2><button id="closeMapHelp" aria-label="关闭操作指南">${icon('close')}</button></div><div class="guide-section"><h3>观察地图</h3><p><span>平移 / 旋转 / 缩放</span><span>左键拖动 / 右键拖动 / 滚轮</span></p><p><span>俯视 / 三维</span><span><kbd>1</kbd> <kbd>2</kbd></span></p><p><span>复位视角</span><kbd>R</kbd></p><p><span>查看详情 / 定位</span><span>单击 / 双击点位</span></p><p><span>搜索物资</span><kbd>/</kbd></p><p><span>收起 / 恢复面板</span><kbd>H</kbd></p></div><div class="guide-section"><h3>第一人称探索</h3><p><span>移动 / 加速</span><span><kbd>W A S D</kbd> <kbd>Shift</kbd></span></p><p><span>上升</span><span><kbd>E</kbd> <kbd>空格</kbd></span></p><p><span>下降</span><span><kbd>Q</kbd> <kbd>左 Ctrl</kbd></span></p><p><span>转向 / 翻阅详情</span><span>左键拖动 / 滚轮</span></p></div><p class="guide-note">定位点位后，切换第一人称从目标位置进入；复位视角可取消定位。</p>`;
  document.body.append(guide);$('openMapHelp').onclick=()=>guide.showModal();$('closeMapHelp').onclick=()=>guide.close();
  guide.querySelector('.guide-section').insertAdjacentHTML('beforeend','<p><span>测距</span><span>左键标点，右键空白另起一条线，右键标点删除</span></p>');
  for(const section of guide.querySelectorAll('.guide-section'))section.classList.add('desktop-guide');
  guide.querySelector('.guide-head').insertAdjacentHTML('afterend','<div class="guide-section touch-guide"><h3>触屏操作</h3><p><span>平移地图</span><span>单指拖动</span></p><p><span>缩放 / 旋转</span><span>双指捏合 / 双指拖动</span></p><p><span>查看详情 / 定位</span><span>轻点 / 连续轻点两次</span></p><p><span>第一人称</span><span>方向键移动，拖动画面转向</span></p></div>');
  guide.addEventListener('click',event=>{if(event.target!==guide)return;const r=guide.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)guide.close();});
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.repeat||document.querySelector('dialog[open]')||document.pointerLockElement)return;
    const editing=event.target.closest('input,textarea,select,[contenteditable=true]');
    if(editing){if(event.key==='Escape'&&event.target===search){event.preventDefault();search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));search.blur();}return;}
    if(event.key==='/'){event.preventDefault();layout.openFilters(true);showTab('filter');search.focus();return;}
    if(event.key==='?'){event.preventDefault();guide.showModal();return;}
    if(event.code==='KeyH'){event.preventDefault();layout.focus();return;}
    if(isFirstPerson())return;
    const command={Digit1:'topView',Digit2:'orbitView',KeyR:'resetView'}[event.code];if(command){event.preventDefault();$(command).click();}
  });
  return {showTab,get mode(){return mode.mode;}};
}
