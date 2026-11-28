import {performancePresets} from './atlas-performance.js';
import {createCacheSettings} from './atlas-cache-settings.js';
import {createScenerySettings} from './atlas-texture-settings.js';
import {createDesktopUpdateSettings,desktopUpdateBridge} from './desktop-updates.js';
import {readPagePreferences,savePagePreferences,mapInterfaceKey} from './atlas-page-session.js';
export const defaultViewSettings=()=>({pivot:'view',manualPivot:null,rotationSpeed:.55,mode:'view',distance:300,retain:true,flySpeed:3,fov:75,markerDistance:60,drawDistance:100,markerSize:26,markerStyle:'icons',...performancePresets.balanced});
export function validateViewSettings(value={}){
  const out=defaultViewSettings();value=value&&typeof value==='object'?value:{};
  // Keep previously saved movement speed when migrating the fly-only controls.
  value={...value,flySpeed:value.flySpeed??value.walkSpeed};
  if(['view','selected','manual','map'].includes(value.pivot))out.pivot=value.pivot;
  if(['view','radius','all'].includes(value.mode))out.mode=value.mode;
  if(['icons','dots'].includes(value.markerStyle))out.markerStyle=value.markerStyle;
  if(Array.isArray(value.manualPivot)&&value.manualPivot.length===3&&value.manualPivot.every(n=>Number.isFinite(n)&&Math.abs(n)<100000))out.manualPivot=[...value.manualPivot];
  for(const [key,min,max] of [['rotationSpeed',.1,1.5],['distance',50,1500],['flySpeed',1,20],['fov',45,100],['markerDistance',10,300],['drawDistance',50,1500],['markerSize',18,40],['renderScale',.5,1.25],['maxFps',15,120],['markerHz',5,30],['maxMarkers',100,5000],['anisotropy',1,8],['sectorBudget',0,8192]]){
    if(typeof value[key]==='number'&&Number.isFinite(value[key]))out[key]=Math.max(min,Math.min(max,value[key]));
  }
  for(const key of ['showClusterCounts','showDecals','retain'])if(typeof value[key]==='boolean')out[key]=value[key];
  return out;
}
const baseSettingsTabs=[
  ['quality','画质与性能'],
  ['markers','图标与名称'],
  ['navigation','视角与移动'],
  ['resources','加载与缓存']
];
const loadModeHelp={
  view:'随视角按需加载，适合日常查看。',
  radius:'加载观察位置周围的区域。',
  all:'尽量加载全图，受分区预算限制。'
};

function bindSettingsTips(dialog){
  const tip=document.createElement('div');
  tip.className='settings-tip';
  tip.setAttribute('popover','manual');
  tip.setAttribute('role','tooltip');
  tip.hidden=true;
  dialog.append(tip);
  let anchor,pinned=false,leaveTimer;
  const trigger=element=>element?.closest?.('[data-settings-tip]:not(:disabled)');
  function hide(){
    clearTimeout(leaveTimer);
    if(!anchor)return;
    tip.hidePopover?.();
    tip.hidden=true;
    anchor=null;
    pinned=false;
  }
  function show(button,keepOpen=false){
    clearTimeout(leaveTimer);
    const source=dialog.querySelector('#'+button.dataset.settingsTip);
    if(!source)return;
    const lines=source.querySelectorAll('p,li');
    const content=[...(lines.length?lines:[source])].map(node=>node.textContent.trim()).filter(Boolean).join('\n');
    if(!content)return;
    anchor=button;
    pinned=keepOpen;
    tip.textContent=content;
    const bounds=dialog.getBoundingClientRect(),target=button.getBoundingClientRect();
    tip.style.maxWidth=Math.min(360,bounds.width-16)+'px';
    tip.style.maxHeight=Math.min(320,bounds.height-16)+'px';
    tip.hidden=false;
    if(tip.showPopover&&!tip.matches(':popover-open'))tip.showPopover();
    const {width,height}=tip.getBoundingClientRect();
    const left=Math.max(bounds.left+8,Math.min(target.left,bounds.right-width-8));
    const below=target.bottom+6;
    const top=below+height<=bounds.bottom-8?below:Math.max(bounds.top+8,target.top-height-6);
    tip.style.left=left+'px';
    tip.style.top=top+'px';
  }
  dialog.addEventListener('pointerover',event=>{
    if(tip.contains(event.target))clearTimeout(leaveTimer);
    const button=trigger(event.target);
    if(button&&!pinned&&event.pointerType!=='touch')show(button);
  });
  dialog.addEventListener('pointerout',event=>{
    if(anchor&&!pinned&&(trigger(event.target)===anchor||tip.contains(event.target))){
      clearTimeout(leaveTimer);
      leaveTimer=setTimeout(hide,150);
    }
  });
  dialog.addEventListener('click',event=>{
    const button=trigger(event.target);
    if(button&&!(pinned&&anchor===button))show(button,true);
    else if(!tip.contains(event.target))hide();
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&anchor){event.preventDefault();hide();}
  });
  dialog.querySelector('.settings-body').addEventListener('scroll',hide);
  dialog.addEventListener('close',hide);
  window.addEventListener('resize',hide);
  return hide;
}

export function createViewSettingsUI({map,settings,onChange,onPick,onFocus,onPause,home=false,onSceneryApplied=()=>{}}){
  const updateBridge=desktopUpdateBridge();
  const settingsTabs=updateBridge?[...baseSettingsTabs,['updates','客户端更新']]:baseSettingsTabs;
  const dialog=document.createElement('dialog');
  dialog.className='view-dialog';
  dialog.id='viewSettings';
  dialog.setAttribute('aria-labelledby','viewSettingsTitle');
  dialog.innerHTML=`<div class="view-dialog-head"><h2 id="viewSettingsTitle">地图设置</h2><button id="closeViewSettings" type="button" aria-label="关闭设置" autofocus>关闭</button></div>
    <div class="settings-tabs${updateBridge?' settings-tabs-desktop':''}" role="tablist" aria-label="设置分类">
      ${settingsTabs.map(([id,label])=>`<button id="settings-tab-${id}" type="button" role="tab" aria-controls="settings-${id}">${home&&id==='markers'?'地图图标':label}</button>`).join('')}
    </div>
    <div class="settings-body">
      <div id="settings-quality" class="settings-pane" role="tabpanel" aria-labelledby="settings-tab-quality">
        <fieldset><legend>画面</legend>
          <div class="setting-row"><label for="performancePreset">画质预设</label><select id="performancePreset"><option value="custom">自定义</option><option value="light">流畅优先</option><option value="balanced">均衡</option><option value="quality">细节优先</option></select></div>
          <div class="settings-inline">
            <label class="check"><input id="loadSceneryDetails" type="checkbox" aria-describedby="sceneryDetailsHelp sceneryDetailsStatus">加载细小装饰物</label>
            <button type="button" class="settings-info" data-settings-tip="sceneryDetailsHelp" aria-label="场景装饰说明" aria-describedby="sceneryDetailsHelp">?</button>
          </div>
          <p id="sceneryDetailsHelp" hidden></p>
          <p id="sceneryDetailsStatus" class="hint" role="status"></p>
          <div class="view-actions"><button id="applySceneryDetails" class="primary" type="button" hidden>应用并重新加载</button></div>
        </fieldset>
        <fieldset><legend>渲染与图标 <button type="button" class="settings-info" data-settings-tip="renderSettingsHelp" aria-label="渲染与图标设置说明" aria-describedby="renderSettingsHelp">?</button></legend>
            <p id="renderSettingsHelp" hidden>提高渲染分辨率和纹理过滤可让画面更清晰。降低帧率、图标刷新频率和图标上限可减轻设备负担。</p>
            <label class="range-label" for="renderScale">渲染分辨率 <output id="renderScaleValue"></output></label><input id="renderScale" type="range" min="0.5" max="1.25" step="0.05">
            <div class="performance-grid">
              <label>帧率上限<input id="maxFps" type="number" min="15" max="120" step="5"></label>
              <label>图标刷新频率 / 秒<input id="markerHz" type="number" min="5" max="30" step="5"></label>
              <label>屏幕图标上限<input id="maxMarkers" type="number" min="100" max="5000" step="100"></label>
              <label>纹理过滤<select id="anisotropy"><option value="1">1× · 流畅</option><option value="2">2×</option><option value="4">4×</option><option value="8">8× · 清晰</option></select></label>
            </div>
            <label class="check"><input id="showClusterCounts" type="checkbox">显示聚合点位数量</label>
            <label class="check"><input id="showDecals" type="checkbox">显示贴花细节</label>
        </fieldset>
      </div>
      <div id="settings-markers" class="settings-pane" role="tabpanel" aria-labelledby="settings-tab-markers" hidden>
        ${home?`<fieldset><legend>地图点位</legend>
          <div class="setting-row"><label for="markerStyle">标点样式</label><select id="markerStyle"><option value="icons">物品与容器图标</option><option value="dots">简洁色点</option></select></div>
          <label class="range-label" for="markerSize">图标大小 <output id="markerSizeValue"></output></label><input id="markerSize" type="range" min="18" max="40" step="2">
        </fieldset>`:''}
      </div>
      <div id="settings-navigation" class="settings-pane" role="tabpanel" aria-labelledby="settings-tab-navigation" hidden>
        <fieldset ${home?'hidden':''}><legend>旋转中心</legend>
          <div class="setting-row"><label for="rotationCenter">围绕哪里旋转</label><select id="rotationCenter"><option value="view">当前观察位置（自动）</option><option value="selected">选中的物资点</option><option value="manual">手动选定的位置</option><option value="map">地图中心</option></select></div>
          <div class="view-actions"><button id="pickOrbitPivot" type="button">点选中心</button><button id="focusOrbitPivot" type="button">定位中心</button></div>
          <output id="pivotReadout">尚未设置</output>
          <label class="range-label" for="rotationSpeed">旋转灵敏度 <output id="rotationSpeedValue"></output></label><input id="rotationSpeed" type="range" min="0.1" max="1.5" step="0.05">
        </fieldset>
        <fieldset id="firstPersonSettings" ${home?'':'hidden'}><legend>自由飞行</legend>
          <div class="performance-grid">
            <label>飞行速度（米 / 秒）<input id="flySpeed" type="number" min="1" max="20" step="1"></label>
            <label>视野角度<input id="firstPersonFov" type="number" min="45" max="100" step="5"></label>
            <label>可视距离（米）<input id="drawDistance" type="number" min="50" max="1500" step="50"></label>
            <label>物资图标距离（米）<input id="markerDistance" type="number" min="10" max="300" step="10"></label>
          </div>
        </fieldset>
      </div>
      <div id="settings-resources" class="settings-pane" role="tabpanel" aria-labelledby="settings-tab-resources" hidden>
        <fieldset id="streamSettings" ${!home&&!map?.streamed?'hidden':''}><legend>模型加载</legend>
          <div class="setting-row"><div class="settings-inline"><label for="loadMode">加载范围</label><button type="button" class="settings-info" data-settings-tip="loadModeHelp" aria-label="加载范围说明" aria-describedby="loadModeHelp">?</button></div><select id="loadMode" aria-describedby="loadModeHelp"><option value="view">当前视野（推荐）</option><option value="radius">附近范围</option><option value="all">全图加载</option></select></div>
          <p id="loadModeHelp" hidden></p>
          <div class="setting-row" id="loadRadius"><label for="loadDistance">加载半径（米）</label><input id="loadDistance" type="number" min="50" max="1500" step="25"></div>
          <label class="check"><input id="retainSectors" type="checkbox">保留附近已加载分区</label>
          <div class="setting-row"><div class="settings-inline"><label for="sectorBudget">分区预算（MiB）</label><button type="button" class="settings-info" data-settings-tip="sectorBudgetHelp" aria-label="分区预算说明" aria-describedby="sectorBudgetHelp">?</button></div><input id="sectorBudget" aria-describedby="sectorBudgetHelp" type="number" min="0" max="8192" step="128"></div>
          <p id="sectorBudgetHelp" hidden>限制同时保留的模型数据量，0 表示不限。</p>
          <div class="view-actions" ${home?'hidden':''}>
            <button id="pauseStreaming" type="button">暂停加载</button>
            <button type="button" data-settings-tip="streamInfo" aria-describedby="streamInfo">加载详情</button>
          </div>
          <div id="streamInfo" hidden><p id="loadSettingsStatus">等待读取模型目录…</p><p id="loadFootprint"></p></div>
        </fieldset>
        <div class="view-actions" ${home?'hidden':''}><button type="button" data-settings-tip="versionNote" aria-describedby="versionNote">数据版本</button><p id="versionNote" hidden></p></div>
      </div>
      ${updateBridge?'<div id="settings-updates" class="settings-pane" role="tabpanel" aria-labelledby="settings-tab-updates" hidden></div>':''}
    </div>
    <div class="settings-footer"><p id="homeSettingsNotice" class="hint" ${home?'role="status"':''}>${home?'首页视图设置适用于所有地图。':'视图设置自动保存。'}</p><button id="resetViewPreferences" type="button">恢复默认视图设置</button></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const body=dialog.querySelector('.settings-body');
  const tabs=dialog.querySelector('.settings-tabs');
  const footer=dialog.querySelector('.settings-footer');
  if(updateBridge)createDesktopUpdateSettings($('settings-updates'),updateBridge);
  const cacheSettings=createCacheSettings(dialog,map);
  const scenerySettings=createScenerySettings(dialog,{home,onApplied(){cacheSettings.invalidate();onSceneryApplied();}});
  const hideTip=bindSettingsTips(dialog);
  const preferenceKey=home?'atlas-home-interface-v1':mapInterfaceKey(map?.id);
  const markerControls=document.querySelector('.marker-controls');
  if(markerControls){
    const field=document.createElement('fieldset');
    field.id='markerSettings';
    field.innerHTML='<legend>地图点位</legend>';
    field.append(markerControls);
    $('settings-markers').append(field);
  }
  function selectTab(index,remember=true){
    hideTip();
    for(const [i,[id]] of settingsTabs.entries()){
      const selected=i===index,tab=$('settings-tab-'+id);
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex=selected?0:-1;
      $('settings-'+id).hidden=!selected;
    }
    body.scrollTop=0;
    footer.hidden=settingsTabs[index][0]==='updates';
    cacheSettings.updateVisibility();
    if(remember)savePagePreferences(preferenceKey,{settingsTab:settingsTabs[index][0]});
  }
  for(const [i,[id]] of settingsTabs.entries())$('settings-tab-'+id).onclick=()=>selectTab(i);
  tabs.onkeydown=event=>{
    const at=[...tabs.children].indexOf(event.target);
    if(at<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const length=settingsTabs.length;
    const next=event.key==='Home'?0:event.key==='End'?length-1:(at+(event.key==='ArrowRight'?1:-1)+length)%length;
    selectTab(next);
    tabs.children[next].focus();
  };
  const savedTab=readPagePreferences(preferenceKey).settingsTab;
  selectTab(Math.max(0,settingsTabs.findIndex(([id])=>id===savedTab)),false);
  const controls={rotationCenter:'pivot',rotationSpeed:'rotationSpeed',loadMode:'mode',loadDistance:'distance',retainSectors:'retain',flySpeed:'flySpeed',firstPersonFov:'fov',markerDistance:'markerDistance',drawDistance:'drawDistance',markerSize:'markerSize',markerStyle:'markerStyle',renderScale:'renderScale',maxFps:'maxFps',markerHz:'markerHz',maxMarkers:'maxMarkers',anisotropy:'anisotropy',showClusterCounts:'showClusterCounts',showDecals:'showDecals',sectorBudget:'sectorBudget'};
  function sync(){
    for(const [id,key] of Object.entries(controls)){if($(id).type==='checkbox')$(id).checked=settings[key];else $(id).value=settings[key];}
    $('performancePreset').value=Object.keys(performancePresets).find(name=>Object.entries(performancePresets[name]).every(([k,v])=>settings[k]===v))||'custom';
    $('renderScaleValue').value=Math.round(settings.renderScale*100)+'%';
    $('rotationSpeedValue').value=settings.rotationSpeed.toFixed(2)+' ×';
    $('markerSizeValue').value=settings.markerSize+' px';$('markerSize').disabled=settings.markerStyle!=='icons';
    $('loadModeHelp').textContent=loadModeHelp[settings.mode];
    $('loadDistance').disabled=settings.mode==='all';
    $('retainSectors').disabled=settings.mode==='all';
  }
  for(const [id,key] of Object.entries(controls))$(id).addEventListener('change',()=>{
    const value=$(id).type==='checkbox'?$(id).checked:$(id).type==='number'||$(id).type==='range'||id==='anisotropy'?Number($(id).value):$(id).value;
    Object.assign(settings,validateViewSettings({...settings,[key]:value}));sync();onChange(key);
  });
  for(const [id,key] of Object.entries(controls))if(['number','range'].includes($(id).type))$(id).addEventListener('input',()=>{
    const el=$(id),value=Number(el.value);
    // Commit valid edits immediately without replacing a partially typed
    // number. Blur/change performs final clamping and synchronizes controls.
    if(el.value===''||!Number.isFinite(value)||value<Number(el.min)||value>Number(el.max))return;
    Object.assign(settings,validateViewSettings({...settings,[key]:value}));
    if(id==='rotationSpeed')$('rotationSpeedValue').value=settings.rotationSpeed.toFixed(2)+' ×';
    if(id==='renderScale')$('renderScaleValue').value=Math.round(settings.renderScale*100)+'%';
    $('performancePreset').value='custom';
    onChange(key);
  });
  $('closeViewSettings').onclick=()=>dialog.close();
  $('performancePreset').onchange=()=>{const preset=performancePresets[$('performancePreset').value];if(preset){Object.assign(settings,preset);sync();onChange('preset');}};
  $('pickOrbitPivot').onclick=()=>{dialog.close();onPick();};
  $('focusOrbitPivot').onclick=()=>{dialog.close();onFocus();};
  $('pauseStreaming').onclick=onPause;
  $('resetViewPreferences').onclick=()=>{Object.assign(settings,defaultViewSettings());scenerySettings.reset();$('pivotReadout').textContent='尚未设置';sync();onChange('reset');};
  sync();
  return {open(){sync();dialog.showModal();cacheSettings.updateVisibility();},sync,
    sceneryDetails:result=>scenerySettings.loaded(result),
    pivot(point){$('pivotReadout').textContent=`X ${point.x.toFixed(2)} · Y ${point.y.toFixed(2)} · Z ${(-point.z).toFixed(2)}`;},
    status(message,paused){$('loadSettingsStatus').textContent=message;$('pauseStreaming').textContent=paused?'继续加载':'暂停加载';},
    manifest(manifest){$('loadFootprint').textContent=`全图 ${manifest.sectors.length} 区 · 几何 ${(manifest.stats.sectorBytes/2**30).toFixed(2)} GiB，全图加载占用较多内存。`;},
    enableFirstPerson(){$('firstPersonSettings').hidden=false;}
  };
}
