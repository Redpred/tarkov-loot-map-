import {performancePresets} from './atlas-performance.js';
import {createCacheSettings} from './atlas-cache-settings.js';
import {createTextureSettings} from './atlas-texture-settings.js';
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
export function createViewSettingsUI({map,settings,onChange,onPick,onFocus,onPause,home=false,onQualityApplied=()=>{}}){
  const dialog=document.createElement('dialog');dialog.className='view-dialog';dialog.id='viewSettings';
  dialog.setAttribute('aria-labelledby','viewSettingsTitle');
  dialog.innerHTML=`<div class="view-dialog-head"><h2 id="viewSettingsTitle">地图设置</h2><button id="closeViewSettings" autofocus>关闭 ×</button></div>
    ${home?'<p class="hint">进入地图前设置画质与加载方式。首页调整应用于所有地图，进入地图后仍可单独调整其他视图设置。</p><p id="homeSettingsNotice" class="hint" role="status"></p>':''}
    <fieldset><legend>性能与画质</legend>
      <label for="geometryQuality">模型精度</label><select id="geometryQuality" aria-describedby="geometryQualityStatus"></select>
      <p id="geometryQualityStatus" class="hint" role="status"></p>
      <label for="textureQuality">贴图精度</label><select id="textureQuality" aria-describedby="textureQualityStatus"></select>
      <p id="textureQualityStatus" class="hint" role="status"></p>
      <label class="check"><input id="loadSceneryDetails" type="checkbox" aria-describedby="sceneryDetailsStatus">加载细小装饰物</label>
      <p id="sceneryDetailsStatus" class="hint" role="status"></p><div class="view-actions"><button id="applyTextureQuality" hidden>应用并重新加载</button></div>
      <label for="performancePreset">快捷预设</label><select id="performancePreset"><option value="custom">自定义</option><option value="light">流畅优先</option><option value="balanced">均衡</option><option value="quality">细节优先</option></select>
      <label class="range-label" for="renderScale">渲染分辨率 <output id="renderScaleValue"></output></label><input id="renderScale" type="range" min="0.5" max="1.25" step="0.05">
      <div class="performance-grid"><label>帧率上限<input id="maxFps" type="number" min="15" max="120" step="5"></label><label>图标刷新频率 / 秒<input id="markerHz" type="number" min="5" max="30" step="5"></label>
      <label>屏幕图标上限<input id="maxMarkers" type="number" min="100" max="5000" step="100"></label><label>纹理过滤<select id="anisotropy"><option value="1">1× · 流畅</option><option value="2">2×</option><option value="4">4×</option><option value="8">8× · 清晰</option></select></label></div>
      <label class="check"><input id="showClusterCounts" type="checkbox">显示聚合点位数量</label><label class="check"><input id="showDecals" type="checkbox">显示贴花细节</label>
      <p class="hint">降低分辨率与图标上限可减轻卡顿。图标上限仅影响地图显示，点位列表仍保留全部结果。</p>
    </fieldset>
    <fieldset ${home?'hidden':''}><legend>旋转中心</legend>
      <label for="rotationCenter">围绕哪里旋转</label><select id="rotationCenter"><option value="view">当前观察位置（自动）</option><option value="selected">选中的物资点</option><option value="manual">手动选定的位置</option><option value="map">地图中心</option></select>
      <div class="view-actions"><button id="pickOrbitPivot">点选中心</button><button id="focusOrbitPivot">定位中心</button></div>
      <p class="hint">自动模式围绕当前观察位置旋转。</p>
      <output id="pivotReadout">尚未设置</output>
      <label class="range-label" for="rotationSpeed">旋转灵敏度 <output id="rotationSpeedValue"></output></label><input id="rotationSpeed" type="range" min="0.1" max="1.5" step="0.05">
    </fieldset>
    <fieldset id="streamSettings"><legend>模型加载</legend>
      <label for="loadMode">加载范围</label><select id="loadMode"><option value="view">动态加载 · 当前视野内</option><option value="radius">动态加载 · 观察位置周围</option><option value="all">全图加载 · 所有分区</option></select>
      <label for="loadDistance">加载半径（米）</label><input id="loadDistance" type="number" min="50" max="1500" step="25">
      <p class="hint" id="loadDistanceHelp">以当前观察位置为中心。</p>
      <label class="check"><input id="retainSectors" type="checkbox">保留附近已加载分区</label>
      <p class="hint">当前视野优先，模型分批显示；停止移动后少量预载视野边缘。附近额外保留最多128 MiB几何数据，也计入预算；较远分区释放运行内存，本地磁盘缓存保留。</p>
      <label for="sectorBudget">分区数据预算（MiB，0 为不限）</label><input id="sectorBudget" type="number" min="0" max="8192" step="128"><p class="hint">预算优先保留附近分区，也约束全图加载与已加载缓存；实际内存、显存占用会更高。第一人称附近分区优先加载。</p>
      <div class="view-actions" ${home?'hidden':''}><button id="pauseStreaming">暂停加载</button></div>
      <output id="loadSettingsStatus" ${home?'hidden':''}>等待读取模型目录…</output><p id="loadFootprint" class="hint"></p>
    </fieldset>
    ${home?'<fieldset><legend>物资与点位图标</legend><label for="markerStyle">标点样式</label><select id="markerStyle"><option value="icons">物品与容器图标</option><option value="dots">简洁色点</option></select><label class="range-label" for="markerSize">图标大小 <output id="markerSizeValue"></output></label><input id="markerSize" type="range" min="18" max="40" step="2"></fieldset>':''}
    <fieldset id="firstPersonSettings" ${home?'':'hidden'}><legend>第一人称探索</legend>
      <label for="flySpeed">飞行速度（米 / 秒）</label><input id="flySpeed" type="number" min="1" max="20" step="1">
      <label for="firstPersonFov">视野角度</label><input id="firstPersonFov" type="number" min="45" max="100" step="5">
      <label for="drawDistance">第一人称可视距离（米）</label><input id="drawDistance" type="number" min="50" max="1500" step="50">
      <label for="markerDistance">物资图标显示距离（米）</label><input id="markerDistance" type="number" min="10" max="300" step="10">
      <p class="hint">左键拖动转向 · WASD 移动 · Shift 加速<br>Q/E 升降</p>
    </fieldset>
    <details class="data-details" ${home?'hidden':''}><summary>数据版本</summary><p id="versionNote" class="hint"></p></details>
    <div class="view-actions"><button id="resetViewPreferences">恢复默认设置</button></div><p class="hint">${home?'模型、贴图精度与装饰物开关需点击“保存资源设置”；其他视图设置自动保存。':'模型、贴图精度与装饰物开关需应用，其他设置自动保存。'}</p>`;
  document.body.append(dialog);
  const cacheSettings=createCacheSettings(dialog,map);
  if(home)dialog.querySelector('.map-cache-list').open=false;
  const textureSettings=createTextureSettings(dialog,{home,onApplied(){cacheSettings.open();onQualityApplied();}});
  const markerControls=document.querySelector('.marker-controls');
  if(markerControls){const field=document.createElement('fieldset');field.id='markerSettings';const legend=document.createElement('legend');legend.textContent='物资与点位图标';field.append(legend,markerControls);dialog.querySelector('.view-dialog-head').after(field);}
  const $=id=>dialog.querySelector('#'+id);
  const controls={rotationCenter:'pivot',rotationSpeed:'rotationSpeed',loadMode:'mode',loadDistance:'distance',retainSectors:'retain',flySpeed:'flySpeed',firstPersonFov:'fov',markerDistance:'markerDistance',drawDistance:'drawDistance',markerSize:'markerSize',markerStyle:'markerStyle',renderScale:'renderScale',maxFps:'maxFps',markerHz:'markerHz',maxMarkers:'maxMarkers',anisotropy:'anisotropy',showClusterCounts:'showClusterCounts',showDecals:'showDecals',sectorBudget:'sectorBudget'};
  function sync(){
    for(const [id,key] of Object.entries(controls)){if($(id).type==='checkbox')$(id).checked=settings[key];else $(id).value=settings[key];}
    $('performancePreset').value=Object.keys(performancePresets).find(name=>Object.entries(performancePresets[name]).every(([k,v])=>settings[k]===v))||'custom';
    $('renderScaleValue').value=Math.round(settings.renderScale*100)+'%';
    $('rotationSpeedValue').value=settings.rotationSpeed.toFixed(2)+' ×';
    $('markerSizeValue').value=settings.markerSize+' px';$('markerSize').disabled=settings.markerStyle!=='icons';
    $('loadDistance').disabled=settings.mode==='all';$('retainSectors').disabled=settings.mode==='all';
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
  $('resetViewPreferences').onclick=()=>{Object.assign(settings,defaultViewSettings());textureSettings.reset();$('pivotReadout').textContent='尚未设置';sync();onChange('reset');};
  $('streamSettings').hidden=!home&&!map?.streamed;sync();
  return {open(){sync();dialog.showModal();cacheSettings.open();},sync,
    textureQuality:result=>textureSettings.loaded(result),
    geometryQuality:result=>textureSettings.geometryLoaded(result),
    sceneryDetails:result=>textureSettings.sceneryLoaded(result),
    pivot(point){$('pivotReadout').textContent=`X ${point.x.toFixed(2)} · Y ${point.y.toFixed(2)} · Z ${(-point.z).toFixed(2)}`;},
    status(message,paused){$('loadSettingsStatus').textContent=message;$('pauseStreaming').textContent=paused?'继续加载':'暂停加载';},
    manifest(manifest){$('loadFootprint').textContent=`全图 ${manifest.sectors.length} 区 · 几何 ${(manifest.stats.sectorBytes/2**30).toFixed(2)} GiB，全图加载占用较多内存。`;},
    enableFirstPerson(){$('firstPersonSettings').hidden=false;}
  };
}
