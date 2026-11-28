import {installMapSession,mapInterfaceKey,readPagePreferences,savePagePreferences} from './atlas-page-session.js';
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { candidatesFor } from './factory-data.js';
import { createMaterialLibrary } from './factory-materials.js';
import {loadTextureQuality} from './atlas-texture-quality.js';
import {loadGeometryQuality} from './atlas-geometry-quality.js';
import {readSceneryMode,loadSceneryDetails} from './atlas-scenery-details.js';
import { UNITY_TO_VIEW_SCALE, unityToView } from './factory-coordinates.js';
import { loadFactoryGeometry,geometryProgressText } from './factory-geometry.js';
import {readMapJson} from './atlas-resource-request.js';
import {createMapDiagnosticCopy,formatMapDiagnostic,mapErrorMessage,mapLoadError} from './atlas-map-diagnostics.js';
import {managedResources} from './atlas-managed-resources.js';
import {makeMapCachePlan,selectedCacheQuality} from './atlas-map-cache.js';
import {prepareResourceLocation} from './atlas-resource-location-ui.js';
import { loadMarkerIcons, createMarkerCloud } from './factory-markers.js';
import { classifyPointMarker } from './factory-marker-rules.js';
import { emptySettings, validateSettings, resolveMarker,saveMapIconSettings,readMapIconSettings } from './factory-icon-settings.js';
import { createIconEditor } from './factory-icon-editor.js';
import { ATLAS_MAPS,atlasMapHref } from './atlas-maps.js';
import { createSectorStreamer,texturedGroupBatches } from './atlas-sectors.js';
import { clusterScreenPoints } from './atlas-clusters.js';
import { rebaseOrbitPivot,pickSceneSurface,planePivot,firstPersonEntryPosition,createSceneOverview } from './atlas-navigation.js';
import { createViewSettingsUI } from './atlas-view-settings.js';
import {readMapViewSettings,saveMapViewSettings} from './atlas-view-preferences.js';
import { mapSkinPalette } from './atlas-map-skin.js';
import { SceneCollision } from './atlas-collision.js';
import { createFirstPerson } from './atlas-first-person.js';
import { createFloatingLayout,bindFirstPersonDetailsWheel,COMPACT_LAYOUT_QUERY } from './atlas-layout.js';
import { createPointTypesUI,POI_TYPES } from './atlas-point-types.js';
import { createRegionLabels } from './atlas-region-labels.js';
import {previewMinimapTransform} from './atlas-minimap.js';
import {renderPixelRatio,limitMarkers} from './atlas-performance.js';
import {installMapUI} from './map-ui.js';
import {createMeasurementLayer,formatMeasurement} from './atlas-measurement.js';
import {createMapTapTracker,createPointDoubleTapTracker,markerHitRadius,createTouchNavigation} from './atlas-touch.js';
import {createItemSearch} from './atlas-item-search.js';
import {createMyTasks} from './atlas-my-tasks.js';
import {createMapKeys,keyDoorView} from './atlas-map-keys.js';
import {loadRuntimeDescriptor,loadPreparedMap,loadPreparedSpatial,mergeMapData} from './atlas-runtime.js';
import {createItemIndex} from './atlas-item-index.js';
import {createMapFilters} from './atlas-map-filters.js';
import {createLootMatcher,filterModePoints} from './atlas-map-filter-data.js';
import {attachPointPrices} from './atlas-point-prices.js';
import {attachPointValueSummary} from './atlas-point-value-ui.js';
import {shortValue} from './atlas-point-values.js';
import {createPointSelection,createPointUnionMatcher} from './atlas-point-selection.js';
import {createAmmoTree} from './atlas-ammo-tree.js';
import {createHeightRange} from './atlas-height-range.js';
import {presetForCutPoint} from './atlas-building-cuts.js';
import {volumesFor} from './atlas-volumes.js';
import {createVolumeLayer} from './atlas-volume-layer.js';
import {attachMapVolumes} from './atlas-volume-data.js';
import {createBuildingCutUniforms} from './atlas-building-cut-shader.js';
import {createBuildingCutView} from './atlas-building-cut-view.js';
import {createBuildingCutEditor} from './atlas-building-cut-editor.js';
import {loadBossData,attachBossPoints} from './boss-data.js';
import {createMapBosses} from './atlas-bosses.js';
import {createScreenshotLocationUI} from './atlas-screenshot-location-ui.js';
import {screenshotWithinBounds} from './atlas-screenshot-location.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS={loose:'#e7c087',container:'#72b5d9',forced:'#c1a1d7',unknown:'#f09e7c'};
const requestedMap=new URLSearchParams(location.search).get('map')||document.documentElement.dataset.map||'factory';
const MAP=Object.hasOwn(ATLAS_MAPS,requestedMap)?ATLAS_MAPS[requestedMap]:null;
if(!MAP)throw mapLoadError('MAP-NOT-FOUND', '未收录此地图');
document.documentElement.dataset.map=MAP.id;document.title=`${MAP.name} · 塔科夫物资地图`;
document.querySelector('.heading h1').innerHTML=`${MAP.name} <span>${MAP.en}</span>`;
document.querySelector('.map-panel').setAttribute('aria-label',`${MAP.name}原始场景与物资点位`);
document.querySelector('#loading strong').textContent=`正在构建${MAP.name}视图`;
$('mapSwitch').innerHTML=Object.values(ATLAS_MAPS).map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
$('mapSwitch').value=MAP.id;
document.querySelector('[data-task-nav]').href=`tasks.html?map=${MAP.id}`;
$('mapSwitch').onchange=()=>{location.href=atlasMapHref($('mapSwitch').value);};
fetch('data/atlas-catalog.json').then(r=>r.ok?r.json():null).then(catalog=>{
  for(const map of catalog?.maps||[]){
    const option=[...$('mapSwitch').options].find(o=>o.value===map.id);
    if(option&&map.id!==MAP.id){option.disabled=!map.ready;option.textContent=map.name+(map.ready?'':'（准备中）');}
  }
}).catch(()=>{});
const DEFAULT_HEADING=Math.PI;
const layout=createFloatingLayout(MAP.id);
const interfaceKey=mapInterfaceKey(MAP.id),savedInterface=readPagePreferences(interfaceKey);
let cameraScene,cameraSaveTimer;
let pointTypes,itemSearch,myTasks,mapKeys,mapFilters,mapItemIndex,ammoTree,heightRange,bossUI,bossData;
let buildingCuts=null,cutProfile=null,previousHeight=null;
const buildingCutView=createBuildingCutView(),buildingCutGPU=createBuildingCutUniforms();
const pointSelection=createPointSelection(MAP.id);
const poiOutlines=new THREE.Group();
const pointVolumes=createVolumeLayer(),regionVolumes=createVolumeLayer({region:true});
const bossRanges=createVolumeLayer();
const state={data:null,visible:[],selected:null,entryPoint:null,band:'all',cut:MAP.maxHeight,mode:savedInterface.camera?.mode==='orbit'?'orbit':'top',groups:[],geometry:savedInterface.geometry!==false,heading:DEFAULT_HEADING,markerStyle:'icons',markerSize:26};
$('cutHeight').min=MAP.minHeight;$('cutHeight').max=MAP.maxHeight;$('cutHeight').value=state.cut;
const requestedQuality=selectedCacheQuality();
let pageSuspended=false;
let viewSettings=readMapViewSettings(MAP.id);
state.markerSize=viewSettings.markerSize;state.markerStyle=viewSettings.markerStyle;
let manualPivot=viewSettings.manualPivot?new THREE.Vector3(...viewSettings.manualPivot):null,pickingPivot=false,mapCenter=new THREE.Vector3(),previousMode='orbit';
let markerIcons=null;
const markerDescriptors=new Map();
const baseMarkerDescriptors=new Map();
let iconSettings=emptySettings(),iconEditor;
let sectorStreamer=null,navigatorDraw=null;
window.addEventListener('pagehide',event=>{flushCamera();if(!event.persisted)sectorStreamer?.dispose();});
const displayClusters=new Map();
const displayPositions=new Map();
const viewport=$('viewport'), scene=new THREE.Scene();
const regionLabels=createRegionLabels({map:MAP.id,viewport,onChange:()=>{refreshRegionVolumes();invalidate();}});
scene.background=new THREE.Color('#101820');
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
}catch(cause){
  throw mapLoadError('GPU-WEBGL2-INIT', '无法启动 WebGL 2，请检查浏览器的硬件加速或显卡支持后重试。', {cause});
}
const reloadMap=()=>location.reload();
const sceneCopy=createMapDiagnosticCopy();
$('sceneLoadStatus').append(sceneCopy.button);
let graphicsIssue=null,sceneStatus={message:'',action:null,failure:null};
renderer.domElement.addEventListener('webglcontextlost',()=>{
  graphicsIssue=mapLoadError('GPU-CONTEXT-LOST', '图形渲染已中断，正在等待恢复');syncSceneStatus();
});
renderer.domElement.addEventListener('webglcontextrestored',()=>{
  graphicsIssue=null;syncSceneStatus();invalidate();
});
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
  console.error('GPU-SHADER',gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment));
  graphicsIssue=mapLoadError('GPU-SHADER', '地图图形程序编译失败');syncSceneStatus();
};
renderer.setPixelRatio(renderPixelRatio(devicePixelRatio,viewSettings.renderScale)); viewport.appendChild(renderer.domElement);
viewport.addEventListener('contextmenu',event=>event.preventDefault(),{capture:true});
renderer.domElement.setAttribute('aria-label',`${MAP.name}地图：拖动平移，滚轮缩放，点击物资点位`);
const orbitCamera=new THREE.OrthographicCamera(-80,80,80,-80,.1,2000);
let camera=orbitCamera;
camera.up.set(0,1,0);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=false;controls.screenSpacePanning=true;controls.enableRotate=true;
controls.zoomToCursor=true;controls.rotateSpeed=viewSettings.rotationSpeed;
controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};
controls.minZoom=.35;controls.maxZoom=35;
controls.minPolarAngle=controls.maxPolarAngle=.00001;
const gameWorld=new THREE.Group();gameWorld.scale.set(...UNITY_TO_VIEW_SCALE);scene.add(gameWorld);
const geometryGroup=new THREE.Group();geometryGroup.visible=state.geometry;gameWorld.add(geometryGroup);
$('toggleGeometry').classList.toggle('active',state.geometry);
const uniforms={low:{value:MAP.minHeight},high:{value:state.cut},...buildingCutGPU.uniforms};
let markerObject=null, selectedObject=null, grid=null, requested=false, initialSpan=160,sceneOverview=null;
let currentMapPalette=mapSkinPalette('night');
let lastRender=-Infinity,lastOverlay=-Infinity,overlayTimer=null,markerSignature='',selectedSignature='',iconRevision=0;
const collisionWorld=new SceneCollision();
const firstPerson=createFirstPerson({canvas:renderer.domElement,settings:viewSettings,
  onChange:()=>{if(firstPerson.mode){camera=firstPerson.camera;const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');updateHeading(e.y);sectorStreamer?.update();invalidate();}},onNotice:notice});
bindFirstPersonDetailsWheel({surface:viewport,details:$('details'),isActive:()=>Boolean(firstPerson.mode)&&!document.querySelector('dialog[open]')});
document.querySelector('.map-tools').insertAdjacentHTML('beforeend','<button id="flyView">自由飞行</button><button id="openViewSettings">设置</button>');
document.querySelector('.map-panel').insertAdjacentHTML('beforeend','<div id="navigationStatus" role="status"></div><div id="firstPersonHud" hidden><span id="playerPosition"></span><button id="lockLook">锁定鼠标</button><button id="leaveFirstPerson">退出第一人称</button></div><span id="firstPersonCrosshair" hidden>+</span>');
const tapTracker=createMapTapTracker(),measurementRightTap=createMapTapTracker(2),doubleTapTracker=createPointDoubleTapTracker();
const measurements=createMeasurementLayer({scene,viewport});
let measuring=false;
let pointTapTimer=null;
function cancelPointTap(){clearTimeout(pointTapTimer);pointTapTimer=null;}
function resetPointGestures(){tapTracker.reset();measurementRightTap.reset();doubleTapTracker.reset();cancelPointTap();}
const touchNavigation=createTouchNavigation({parent:document.querySelector('.map-panel'),canvas:renderer.domElement,onMove:input=>{firstPerson.setTouchMovement(input);if(firstPerson.touchMoving)resetPointGestures();}});
window.addEventListener('blur',resetPointGestures);
document.addEventListener('visibilitychange',()=>{if(document.hidden){resetPointGestures();flushCamera();}});
document.addEventListener('pointerdown',e=>{cancelPointTap();if(e.target!==renderer.domElement)doubleTapTracker.reset();},true);
renderer.domElement.addEventListener('wheel',()=>{doubleTapTracker.reset();cancelPointTap();},{passive:true});
const viewUI=createViewSettingsUI({map:MAP,settings:viewSettings,onChange:key=>{
  if(key==='reset')manualPivot=null;
  state.markerSize=viewSettings.markerSize;state.markerStyle=viewSettings.markerStyle;$('markerSizeValue').value=state.markerSize+' px';$('markerLegend').hidden=state.markerStyle==='icons';
  if(['renderScale','anisotropy','showDecals','preset','reset'].includes(key))applySceneQuality();lastOverlay=-Infinity;
  if(state.data&&pointTypes&&markerIcons&&['markerSize','markerStyle','maxMarkers','showClusterCounts','markerDistance','renderScale','preset','reset'].includes(key))refresh();
  saveViewSettings(key);controls.rotateSpeed=viewSettings.rotationSpeed;
  firstPerson.camera.fov=viewSettings.fov;firstPerson.camera.far=viewSettings.drawDistance;firstPerson.camera.updateProjectionMatrix();sectorStreamer?.update();invalidate();
},onPick:()=>{if(measuring)setMeasuring(false);if(firstPerson.mode)leaveFirstPerson('orbit');pickingPivot=true;notice('点击场景表面设为旋转中心；Esc 取消。');renderer.domElement.style.cursor='crosshair';},onFocus:()=>{if(firstPerson.mode)leaveFirstPerson('orbit');preparePivot(true);},onPause:()=>sectorStreamer?.togglePause()});
viewUI.enableFirstPerson();
const mapUI=installMapUI({map:MAP,layout,isFirstPerson:()=>Boolean(firstPerson.mode),onSkinChange:applyMapSkin,onFilterMode:mode=>{itemSearch?.close();if(mode==='value')mapFilters?.activate();refreshFilter();}});
$('measureDistance').onclick=()=>setMeasuring(!measuring);
syncGeometryButton();
let screenshotBounds=null,screenshotPosition=null;
const screenshotUI=createScreenshotLocationUI({map:MAP,tools:document.querySelector('.map-tools'),viewport,onNotice:notice,
  onLocate:locateScreenshot,onClear:()=>{screenshotPosition=null;lastOverlay=-Infinity;invalidate();}});
const screenshotProjection=new THREE.Vector3();
const coarsePointer=matchMedia('(pointer: coarse)');
coarsePointer.addEventListener('change',()=>{updateInteractionHelp();touchNavigation.reset();});
updateInteractionHelp();
gameWorld.add(poiOutlines,pointVolumes.group,regionVolumes.group,bossRanges.group);
if(manualPivot)viewUI.pivot(manualPivot);
function saveViewSettings(change){if(!saveMapViewSettings(MAP.id,viewSettings,change))notice('当前浏览器无法保存视图设置。');}
function atSceneOverview(){return Boolean(sceneOverview)&&orbitCamera.zoom<=controls.minZoom;}
function syncOverviewZoom(keepOverview=atSceneOverview()){
  if(!sceneOverview)return;
  controls.minZoom=sceneOverview.zoom(orbitCamera);
  if(!keepOverview&&orbitCamera.zoom>controls.minZoom)return;
  orbitCamera.zoom=controls.minZoom;
  controls.target.copy(sceneOverview.center);
  orbitCamera.position.set(0,0,sceneOverview.distance).applyQuaternion(orbitCamera.quaternion).add(controls.target);
  orbitCamera.updateProjectionMatrix();orbitCamera.updateMatrixWorld();
}
function updateOrbitFrustum(aspect){
  orbitCamera.right=initialSpan*aspect/2;orbitCamera.left=-orbitCamera.right;
  orbitCamera.top=initialSpan/2;orbitCamera.bottom=-orbitCamera.top;
  orbitCamera.updateProjectionMatrix();
}
function rememberCamera(){
  clearTimeout(cameraSaveTimer);cameraSaveTimer=null;
  if(!cameraScene||firstPerson.mode)return;
  const view={scene:cameraScene,mode:state.mode,position:orbitCamera.position.toArray(),target:controls.target.toArray(),zoom:orbitCamera.zoom};
  if(atSceneOverview())view.overview=true;
  savePagePreferences(interfaceKey,{camera:view});
}
function queueCameraSave(){
  if(!cameraScene||firstPerson.mode)return;
  clearTimeout(cameraSaveTimer);cameraSaveTimer=setTimeout(rememberCamera,240);
}
function flushCamera(){if(cameraSaveTimer)rememberCamera();}
function restoreCamera(sceneVersion){
  const view=savedInterface.camera;
  const vector=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<100000);
  if(sceneVersion&&view?.scene===sceneVersion&&vector(view.position)&&vector(view.target)&&Number.isFinite(view.zoom)&&view.zoom>0){
    const offset=view.position.map((value,i)=>value-view.target[i]);
    if(Math.hypot(...offset)>.01){
      orbitCamera.position.fromArray(view.position);controls.target.fromArray(view.target);
      orbitCamera.zoom=THREE.MathUtils.clamp(view.zoom,controls.minZoom,controls.maxZoom);
      orbitCamera.updateProjectionMatrix();controls.update();
      if(view.overview===true)syncOverviewZoom(true);
    }
  }
  cameraScene=sceneVersion;
}
function notice(message){const el=$('navigationStatus');if(el&&el.textContent!==message)el.textContent=message;}
function syncSceneStatus(){
  const button=$('streamStatus');
  let status=sceneStatus;
  if(graphicsIssue)status={message:`${mapErrorMessage(graphicsIssue)} · 点击重新加载地图`,action:reloadMap,failure:graphicsIssue};
  else if(!state.geometry&&!status.failure)status={message:'场景已隐藏 · 点击显示',action:()=>setGeometryVisible(true)};
  button.hidden=!status.message;
  if(button.textContent!==status.message)button.textContent=status.message;
  button.classList.toggle('error',Boolean(status.failure));
  $('sceneLoadStatus').classList.toggle('graphics-error',Boolean(graphicsIssue));
  button.setAttribute('aria-disabled',String(!status.action));
  button.tabIndex=status.action?0:-1;
  button.onclick=status.action;
  sceneCopy.update(status.failure?formatMapDiagnostic(status.failure,{
    mapId:MAP.id,sectorId:status.sectorId,mode:managedResources.mode(),scenery:requestedQuality.scenery
  }):'');
}
function setSceneStatus(message='',action=null,failure=null,sectorId){
  sceneStatus={message,action,failure,sectorId};syncSceneStatus();
}
function syncGeometryButton(){
  const button=$('toggleGeometry');
  button.classList.toggle('active',state.geometry);
  button.setAttribute('aria-pressed',String(state.geometry));
  button.title=state.geometry?'隐藏场景':'显示场景';
}
function setGeometryVisible(visible){
  state.geometry=visible;geometryGroup.visible=visible;
  savePagePreferences(interfaceKey,{geometry:visible});
  if(atSceneOverview())sectorStreamer?.update();
  syncGeometryButton();syncSceneStatus();invalidate();
}
function updateHeading(radians){state.heading=radians;const degrees=((THREE.MathUtils.radToDeg(radians)%360)+360)%360;$('headingValue').textContent=`${Math.round(degrees)%360}°`;$('compassNeedle').style.transform=`rotate(${degrees}deg)`;}
function applySceneQuality(groups=state.groups){
  const ratio=renderPixelRatio(devicePixelRatio,viewSettings.renderScale);if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
  const textures=new Set();
  for(const group of groups){
    group.mesh.visible=group.mesh.count>0&&(viewSettings.showDecals||group.mesh.material.userData.atlasRole!=='decal');
    for(const uniform of Object.values(group.mesh.material.uniforms||{}))if(uniform.value?.isTexture)textures.add(uniform.value);
  }
  const anisotropy=Math.min(viewSettings.anisotropy,renderer.capabilities.getMaxAnisotropy());
  for(const texture of textures)if(texture.anisotropy!==anisotropy){texture.anisotropy=anisotropy;texture.needsUpdate=true;}
}
function render(now){
  if(document.hidden||pageSuspended){requested=false;return;}
  if(now-lastRender<1000/viewSettings.maxFps-1){requestAnimationFrame(render);return;}
  requested=false;lastRender=now;
  if(now-lastOverlay>=1000/viewSettings.markerHz){
    lastOverlay=now;clearTimeout(overlayTimer);overlayTimer=null;
    if(state.data&&markerIcons)refreshMarkers();navigatorDraw?.();
    if(state.data)regionLabels.render({camera,band:'all',...floorBounds(),heightAt:buildingCutView.highAt,firstPerson:Boolean(firstPerson.mode),distance:Math.min(viewSettings.drawDistance,160)});
  }else if(!overlayTimer){overlayTimer=setTimeout(()=>{overlayTimer=null;invalidate();},1000/viewSettings.markerHz-(now-lastOverlay)+1);}
  updateScreenshotMarker();
  measurements.render(camera);
  try{renderer.render(scene,camera);}catch(error){
    if(!graphicsIssue){console.error('GPU-RENDER',error);graphicsIssue=mapLoadError('GPU-RENDER', '地图图形渲染失败');syncSceneStatus();}
    return;
  }
  if(firstPerson.mode){const p=camera.position;$('playerPosition').textContent=`飞行 · X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)} / Z ${(-p.z).toFixed(1)}`;$('scaleLabel').textContent='';}
  else{const width=viewport.clientWidth;const span=(camera.right-camera.left)/camera.zoom;$('scaleLabel').textContent=`${(span*100/width).toFixed(1)} m / 100 px`;}}
function invalidate(){if(!pageSuspended&&!requested){requested=true;requestAnimationFrame(render);}}
function applyMapSkin(palette){
  currentMapPalette=palette;scene.background.set(palette.background);
  if(grid){grid.material.opacity=palette.gridOpacity;grid.material.transparent=palette.gridOpacity<1;grid.material.needsUpdate=true;}
  if(state.data&&heightRange&&pointTypes&&markerIcons)refreshPoiOutlines();
  invalidate();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)invalidate();});
controls.addEventListener('change',()=>{if(!firstPerson.mode){syncOverviewZoom();updateHeading(controls.getAzimuthalAngle());queueCameraSave();invalidate();}sectorStreamer?.update();});
function resizeViewport(){
  const w=viewport.clientWidth,h=viewport.clientHeight;
  if(pageSuspended||!w||!h)return;
  renderer.setSize(w,h);
  updateOrbitFrustum(w/h);syncOverviewZoom();
  firstPerson.camera.aspect=w/h;firstPerson.camera.updateProjectionMatrix();
  sectorStreamer?.update();invalidate();
}
new ResizeObserver(resizeViewport).observe(viewport);
const pointColor=p=>(mapUI.mode==='value'&&state.lootIds?.has(p.id)&&mapFilters?.color(p))||(p.kind==='poi'?(p.poiTypes.some(t=>['mine','sniper_zone'].includes(t))?'#f3a887':'#b1ddba'):p.joinStatus==='client-only'?COLORS.unknown:p.forced?COLORS.forced:COLORS[p.kind]);
const itemName=tpl=>state.data.items[tpl]?.zh||tpl;
function title(p){
  if(p.quest)return [...new Set((pointTypes?.taskReferences(p)||p.questObjectives).map(ref=>ref.name))].join(' / ');
  if(p.kind==='poi')return p.label;
  if(p.kind==='container')return itemName(p.containerTpl);
  const root=p.candidates?.filter(c=>c.weight==null||c.weight>0)||[];
  return root.length===1?itemName(root[0].tpl):`散落物资 · ${new Set(root.map(c=>c.tpl)).size} 种候选`;
}
function cutPreset(){return state.band.startsWith('cut:')?state.band.slice(4):null;}
function renderFloorButtons(){if(!cutProfile)return;$('floors').innerHTML=[{id:'all',name:'全部'},...cutProfile.presets.map(p=>({id:'cut:'+p.id,name:p.name}))].map(b=>`<button data-band="${escape(b.id)}" class="${b.id===state.band?'active':''}">${escape(b.name)}</button>`).join('');}
function floorBounds(){return heightRange.bounds(state.cut,Boolean(firstPerson.mode)&&state.band==='all');}
function syncBuildingCuts(){const plan=buildingCutView.set(cutProfile,cutPreset());buildingCutGPU.set(plan,Boolean(plan));}
function selectBuildingPreset(id){setHeightCut(heightRange.max,'cut:'+id,true);updateGeometry();refreshFilter();}
function buildingCutOptions(){return {clipVolume:buildingCutView.clip,cutRevision:buildingCutView.revision};}
function setHeightCut(cut,band='custom',remember=false){
  state.cut=heightRange.clamp(cut);state.band=band;$('cutHeight').value=state.cut;
  if(remember&&!firstPerson.mode)savePagePreferences(interfaceKey,{height:{band,cut:state.cut}});
  syncBuildingCuts();buildingCuts?.sync();
  document.querySelectorAll('[data-band]').forEach(el=>el.classList.toggle('active',el.dataset.band===band));
}
function scenePivot(ndc=new THREE.Vector2(),accept=()=>true){
  geometryGroup.updateWorldMatrix(true,true);const {low,high}=floorBounds();
  return pickSceneSurface(camera,ndc,geometryGroup.children,low,high,p=>p.y<=buildingCutView.highAt({x:p.x,z:-p.z},high)&&accept(p));
}
function mapPointer(event){
  const {left,top,width,height}=viewport.getBoundingClientRect();
  const locked=document.pointerLockElement===renderer.domElement;
  return {x:locked?width/2:event.clientX-left,y:locked?height/2:event.clientY-top,width,height};
}
function preparePivot(explicit=false){
  if(firstPerson.mode||atSceneOverview())return;
  let point;
  if(viewSettings.pivot==='selected'){const p=state.selected&&unityToView(state.selected.position);point=p?new THREE.Vector3(p.x,p.y,p.z):null;}
  else if(viewSettings.pivot==='manual')point=manualPivot;
  else if(viewSettings.pivot==='map')point=mapCenter;
  else point=scenePivot()||planePivot(camera,new THREE.Vector2(),controls.target.y)||controls.target.clone();
  if(!point){notice(viewSettings.pivot==='selected'?'先选择一个物资点，或改用当前观察位置。':'请先在地图上点选旋转中心。');return;}
  rebaseOrbitPivot(camera,controls,point);viewUI.pivot(point);
  if(explicit)notice(`旋转中心已定位：X ${point.x.toFixed(1)} / Y ${point.y.toFixed(1)} / Z ${(-point.z).toFixed(1)}`);
}
renderer.domElement.addEventListener('pointerdown',e=>{
  if(pickingPivot&&e.button===0){e.stopImmediatePropagation();e.preventDefault();const r=viewport.getBoundingClientRect(),point=scenePivot(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2));
    if(!point){notice('此处没有可选的已加载表面，请在道路、地板或建筑上点选。');return;}
    manualPivot=point;pickingPivot=false;renderer.domElement.style.cursor='';viewSettings.pivot='manual';viewSettings.manualPivot=point.toArray();saveViewSettings('manualPivot');viewUI.sync();preparePivot(true);return;}
  if(measuring&&!firstPerson.mode&&!controls.enabled)return;
  tapTracker.down(e);if(measuring)measurementRightTap.down(e);
  if(e.button!==0||tapTracker.pointerCount>1)doubleTapTracker.reset();
  if((!measuring&&e.button===2||e.pointerType==='touch'&&tapTracker.pointerCount===2)&&state.mode==='orbit'&&state.data)preparePivot();
},true);
window.addEventListener('keydown',e=>{
  if(e.code!=='Escape'||e.defaultPrevented||document.querySelector('dialog[open]'))return;
  if(pickingPivot){pickingPivot=false;renderer.domElement.style.cursor='';notice('已取消选择旋转中心。');}
  if(measuring&&!document.pointerLockElement)setMeasuring(false);
});
function firstPersonUI(){
  const active=Boolean(firstPerson.mode);$('firstPersonHud').hidden=$('firstPersonCrosshair').hidden=!active;
  buildingCuts?.firstPerson(active);
  touchNavigation.setMode(firstPerson.mode);resetPointGestures();
  $('flyView').classList.toggle('active',firstPerson.mode==='fly');
  $('topView').classList.toggle('active',!active&&state.mode==='top');$('orbitView').classList.toggle('active',!active&&state.mode==='orbit');
  document.querySelector('.rotation-tools').hidden=active;document.querySelector('.map-panel').classList.toggle('first-person',active);
  updateInteractionHelp();
  if(grid)grid.visible=!active;
}
function updateInteractionHelp(){
  const active=Boolean(firstPerson.mode);
  $('interactionHelp').textContent=coarsePointer.matches?(active?'拖动画面转向 · 按住方向键移动':'单指平移 · 双指缩放 · 连点两次定位'):active?`左键转向 · WASD 移动 · E / 空格上升 · Q / 左 Ctrl 下降 · 滚轮翻阅详情`:'左键平移 · 右键旋转 · 滚轮缩放 · 双击定位';
  renderer.domElement.setAttribute('aria-label',`${MAP.name}地图：${coarsePointer.matches?'单指平移，双指缩放与旋转，轻点查看详情，连续轻点两次定位':'拖动平移，滚轮缩放，单击查看详情，双击定位点位'}`);
}
function enterFirstPerson(){
  if(!state.data||!state.groups.length){notice('请等待当前位置的模型加载完成。');return;}
  let position=null;
  if(!firstPerson.mode){
    previousHeight={band:state.band,cut:state.cut};
    previousMode=state.mode;const entry=state.entryPoint&&displayPositions.has(state.entryPoint.id)?{...state.entryPoint,position:displayPositions.get(state.entryPoint.id),volumes:[]}:state.entryPoint;position=firstPersonEntryPosition({point:entry,...floorBounds(),surface:scenePivot,target:controls.target,camera:orbitCamera});
    setHeightCut(heightRange.max,'all');
  }
  flushCamera();controls.enabled=false;firstPerson.enter(position,state.heading);camera=firstPerson.camera;
  state.entryPoint=null;
  firstPersonUI();updateGeometry();refresh();sectorStreamer?.update();
  notice('');
}
function leaveFirstPerson(mode=previousMode){
  if(!firstPerson.mode)return;
  const foot=firstPerson.camera.position.clone();foot.y-=1.65;firstPerson.exit();camera=orbitCamera;controls.enabled=true;state.mode=mode;
  setHeightCut(previousHeight?.cut??heightRange.max,previousHeight?.band||'all');
  controls.target.copy(foot);camera.position.copy(foot).add(new THREE.Vector3().setFromSphericalCoords(250,mode==='top'?.00001:.85,state.heading));
  controls.minPolarAngle=mode==='top'?.00001:.05;controls.maxPolarAngle=mode==='top'?.00001:Math.PI/2-.02;camera.zoom=Math.max(camera.zoom,4);camera.updateProjectionMatrix();controls.update();
  firstPersonUI();updateGeometry();refresh();notice('');
}
function fit(){
  if(firstPerson.mode)leaveFirstPerson(previousMode);
  let ps=state.data.points.filter(p=>p.kind!=='poi'&&p.position && !p.outsideClientEnvelope).map(p=>unityToView(p.position));
  if(!ps.length)ps=state.data.points.filter(p=>p.position&&!p.outsideClientEnvelope).map(p=>unityToView(p.position));
  if(!ps.length)ps=(state.data.coordinateAudit?.levelBorder||[]).map(unityToView);
  if(!ps.length)ps=[new THREE.Vector3(-50,0,-50),new THREE.Vector3(50,0,50)];
  const xs=ps.map(p=>p.x),zs=ps.map(p=>p.z);
  const elevations=ps.map(p=>p.y).sort((a,b)=>a-b);
  const center=new THREE.Vector3((Math.min(...xs)+Math.max(...xs))/2,elevations[Math.floor(elevations.length/2)]||0,(Math.min(...zs)+Math.max(...zs))/2);
  mapCenter.copy(center);
  initialSpan=Math.max(Math.max(...zs)-Math.min(...zs)+18,(Math.max(...xs)-Math.min(...xs)+18)*viewport.clientHeight/viewport.clientWidth);
  if(MAP.streamed){initialSpan=MAP.initialSpan;if(!sceneOverview)controls.minZoom=initialSpan/MAP.maxViewSpan;}
  camera.zoom=1;
  const theta=state.heading,phi=state.mode==='top'?.00001:.85;
  camera.position.copy(center).add(new THREE.Vector3().setFromSphericalCoords(250,phi,theta));
  controls.target.copy(center);controls.minPolarAngle=state.mode==='top'?.00001:.05;controls.maxPolarAngle=state.mode==='top'?.00001:Math.PI/2-.02;
  updateOrbitFrustum(viewport.clientWidth/viewport.clientHeight);
  controls.update();syncOverviewZoom(false);invalidate();
}
function setMode(mode){
  if(firstPerson.mode){leaveFirstPerson(mode);return;}
  const target=controls.target.clone(),zoom=camera.zoom,showOverview=atSceneOverview();
  state.mode=mode;$('topView').classList.toggle('active',mode==='top');$('orbitView').classList.toggle('active',mode==='orbit');fit();
  const delta=target.sub(controls.target);camera.position.add(delta);controls.target.add(delta);camera.zoom=showOverview?controls.minZoom:zoom;
  camera.updateProjectionMatrix();controls.update();syncOverviewZoom(showOverview);invalidate();
}
function rotateView(delta){preparePivot();const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),delta);camera.position.copy(controls.target).add(offset);controls.update();invalidate();}
function updateGeometry(groups=state.groups){
  const {low,high}=floorBounds();uniforms.low.value=low;uniforms.high.value=high;
  const mat=new THREE.Matrix4();
  for(const group of groups){let count=0;const {mesh,matrices,boxes}=group;
    for(let i=0;i<group.instances;i++){
      if(boxes[i*6+4]<low||boxes[i*6+1]>high)continue;
      const m=matrices.subarray(i*12,i*12+12);mat.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],0,0,0,1);
      mesh.setMatrixAt(count++,mat);
    }
    mesh.count=count;mesh.visible=count>0&&(viewSettings.showDecals||mesh.material.userData.atlasRole!=='decal');
    if(count){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
  }
  if(grid)grid.position.y=low-.02;
  sectorStreamer?.update();
  invalidate();
}
function markerCloud(points,selected=false){
  const size=state.markerStyle==='icons'?state.markerSize+(selected?8:0):selected?18:11;
  const cloud=createMarkerCloud(points.map(p=>displayPositions.has(p.id)?{...p,position:displayPositions.get(p.id)}:p),{icons:markerIcons,descriptors:markerDescriptors,colorFor:pointColor,
    size,pixelRatio:renderer.getPixelRatio(),style:state.markerStyle,selected,valueRings:p=>Boolean(mapUI.mode==='value'&&mapFilters?.pointEnabled&&mapFilters.ready&&state.lootIds?.has(p.id))});
  cloud.material.depthTest=Boolean(firstPerson.mode);return cloud;
}
function iconHtml(p,className='point-icon'){
  const descriptor=markerDescriptors.get(p.id),entry=markerIcons.manifest.entries[descriptor.key]||markerIcons.manifest.entries.other;
  return `<img class="${className}" src="${escape(entry.file)}" alt="" aria-hidden="true" title="${escape(descriptor.label)}" style="--point-color:${pointColor(p)}">`;
}
function markerLabel(p){const m=markerDescriptors.get(p.id);return m.mode==='item'?'单一候选物品':m.mode==='container'?'可搜索容器':m.label;}
function itemIconHtml(tpl){
  const entry=markerIcons.manifest.entries[markerIcons.manifest.items[tpl]];
  return entry?`<img class="pool-item-icon" src="${escape(entry.file)}" alt="" loading="lazy" title="${escape(itemName(tpl))}">`:'<span class="pool-item-icon missing-icon" title="此物品暂无对应图标" aria-label="暂无图标">?</span>';
}
async function applyIconSettings(batch,persist=true){
  const next=batch[MAP.id];
  if(!next){if(persist)saveMapIconSettings(localStorage,batch,ATLAS_MAPS,markerIcons.manifest.entries);return;}
  const resolved=new Map(state.data.points.map(p=>[p.id,resolveMarker(p,baseMarkerDescriptors.get(p.id),next,markerIcons.manifest.entries)]));
  try{await markerIcons.prepare([...resolved.values()].map(d=>d.key));if(persist)saveMapIconSettings(localStorage,batch,ATLAS_MAPS,markerIcons.manifest.entries);}
  catch(error){await markerIcons.prepare([...markerDescriptors.values()].map(d=>d.key));throw error;}
  iconSettings=next;markerDescriptors.clear();for(const [id,d] of resolved)markerDescriptors.set(id,d);iconRevision++;
  refresh();if(state.selected)choose(state.selected);
}
let storageRefresh=Promise.resolve();
window.addEventListener('storage',event=>{if(event.key===MAP.settingsKey&&markerIcons&&state.data)storageRefresh=storageRefresh.then(()=>applyIconSettings({[MAP.id]:readMapIconSettings(localStorage,MAP,markerIcons.manifest.entries)},false)).catch(error=>notice(error.message));});
function removeCloud(cloud){if(cloud){cloud.removeFromParent();cloud.geometry.dispose();cloud.material.dispose();}}
function refreshMarkers(){
  displayClusters.clear();let points=state.visible;
  {
    camera.updateMatrixWorld();const v=new THREE.Vector3(),w=viewport.clientWidth,h=viewport.clientHeight,projected=[];
    for(const point of points){const p=unityToView(displayPositions.get(point.id)||point.position);v.set(p.x,p.y+.07,p.z);if(firstPerson.mode&&v.distanceTo(camera.position)>viewSettings.markerDistance)continue;v.project(camera);const x=(v.x+1)*w/2,y=(1-v.y)*h/2;
      if(v.z>=-1&&v.z<=1&&x>=-30&&x<=w+30&&y>=-30&&y<=h+30)projected.push({point,x,y});}
    const clusters=limitMarkers(firstPerson.mode?projected.map(p=>({...p,members:[p.point]})):clusterScreenPoints(projected,state.markerStyle==='icons'?state.markerSize:14),viewSettings.maxMarkers,w,h,state.selected?.id);
    for(const c of clusters)displayClusters.set(c.point.id,c);
    points=clusters.map(c=>c.point);
    $('clusterCounts').innerHTML=viewSettings.showClusterCounts?clusters.filter(c=>c.members.length>1).map(c=>`<span style="left:${c.x+8}px;top:${c.y+7}px">${c.members.length}</span>`).join(''):'';
  }
  state.displayPoints=points;
  const styleKey=`${iconRevision}:${state.markerStyle}:${state.markerSize}:${renderer.getPixelRatio()}:${Boolean(firstPerson.mode)}:${state.cut}:${buildingCutView.revision}`;
  const signature=styleKey+'|'+points.map(p=>p.id).join('|');
  if(signature!==markerSignature){removeCloud(markerObject);markerObject=markerCloud(points);gameWorld.add(markerObject);markerSignature=signature;}
  const selected=state.selected&&state.visible.includes(state.selected)&&(!firstPerson.mode||points.includes(state.selected))?state.selected:null;
  const nextSelected=styleKey+'|'+(selected?.id||'');
  if(nextSelected!==selectedSignature){removeCloud(selectedObject);selectedObject=selected?markerCloud([selected],true):null;if(selectedObject)gameWorld.add(selectedObject);selectedSignature=nextSelected;}
}
function refreshPoiOutlines(){
  for(const child of [...poiOutlines.children]){poiOutlines.remove(child);child.geometry.dispose();child.material.dispose();}
  for(const p of state.visible)if(p.kind==='poi'&&!volumesFor(p).length&&p.outline?.length>=3){
    const geometry=new THREE.BufferGeometry().setFromPoints(p.outline.map(v=>new THREE.Vector3(v.x,v.y+.1,v.z)));
    poiOutlines.add(new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:pointColor(p),transparent:true,opacity:.7,depthTest:false,depthWrite:false})));
  }
  pointVolumes.update(state.visible,{...floorBounds(),...buildingCutOptions(),selected:state.selected,colorFor:pointColor,firstPerson:Boolean(firstPerson.mode),background:currentMapPalette.background});
  bossRanges.update(bossUI?.rangeEntries(state.visible,state.selected)||[],{...floorBounds(),...buildingCutOptions(),selected:bossUI?.rangeEntry(state.selected),colorFor:()=> '#d1aa62',firstPerson:Boolean(firstPerson.mode),background:currentMapPalette.background});
  refreshRegionVolumes();
}
function refreshRegionVolumes(){
  if(!heightRange)return;
  const options={...floorBounds(),...buildingCutOptions(),band:'all',firstPerson:Boolean(firstPerson.mode),background:currentMapPalette.background};
  regionVolumes.update(regionLabels.volumeLabels(options),options);
}
function refresh(){
  if(!state.data||!pointTypes||!markerIcons)return;
  const {low,high}=floorBounds(),valueMode=mapUI.mode==='value';
  const base={data:state.data,index:mapItemIndex,types:mapFilters?.matchesKind||(()=>true),priceIds:mapFilters?.priceIds??null,pointMatches:mapFilters?.matches};
  const selectedUnion=createPointUnionMatcher({types:p=>pointTypes.matches(p)||bossUI?.matches(p),items:p=>itemSearch?.matches(p),ammo:p=>ammoTree?.matches(p),tasks:p=>myTasks?.matches(p),keys:p=>mapKeys?.matches(p)});
  const union=p=>(!p.bossPoint||bossUI?.eligible(p))&&selectedUnion(p);
  const valueMatcher=createLootMatcher(base);
  const result=filterModePoints(state.data.points,{mode:mapUI.mode,low,high,heightTest:buildingCutView.visible,pointMatch:union,valueMatch:valueMatcher});
  state.visible=result.visible;state.lootIds=result.lootIds;
  displayPositions.clear();for(const point of state.visible){const position=buildingCutView.position(point,low,high);if(position!==point.position)displayPositions.set(point.id,position);}
  if(valueMode&&mapFilters?.pointEnabled){state.visible.sort((a,b)=>mapFilters.compare(a,b));const beforeValue=createLootMatcher({...base,pointMatches:()=>true});mapFilters.counts(state.data.points.filter(p=>p.position&&!p.outsideClientEnvelope&&buildingCutView.visible(p,low,high)&&beforeValue(p)));}
  $('valueFilterStatus').textContent=valueMode?(mapFilters?.blocked?'价格或估值尚未就绪，请稍候或刷新。':result.visible.length?'匹配 '+result.visible.length+' 个物资点位':'没有符合当前价值条件的点位。'):'';
  refreshPoiOutlines();refreshMarkers();
  $('resultCount').textContent=state.visible.length;
  $('resultList').innerHTML=state.visible.slice(0,100).map(p=>{
    const row=`<button type="button" class="result-row ${p===state.selected?'selected':''}" data-id="${escape(p.id)}"><strong>${iconHtml(p)}<span>${escape(title(p))}</span></strong><small>${result.lootIds.has(p.id)?'物资':'辅助'} · ${valueMode&&mapFilters?.pointEnabled&&result.lootIds.has(p.id)?`<b style="color:${pointColor(p)}">${shortValue(mapFilters.value(p)?.[mapFilters.metric])}</b> · `:''}${p.quest?escape([...new Set(pointTypes.taskReferences(p).map(ref=>ref.text))].join('；'))+' · ':''}高度 ${p.position.y.toFixed(1)} m</small></button>`;
    return p.poiTypes?.includes('spawn_pmc')?`<div class="result-with-locate">${row}<button type="button" class="result-locate" data-id="${escape(p.id)}" aria-label="定位：${escape(title(p))}" title="定位到此出生点">定位</button></div>`:row;
  }).join('') || '<p class="hint">暂无点位。请勾选点位或调整价值与高度范围。</p>';
  $('resultMore').textContent=state.visible.length>100?`列表前 100 项 · 地图共 ${state.visible.length} 点`:'';
  const presetName=cutProfile?.presets.find(p=>p.id===cutPreset())?.name;
  const heightSummary=presetName?`${presetName} · 分区剖切`:state.band==='all'?'全部':`≤ ${high.toFixed(2)} m`;
  $('heightSummary').textContent=heightSummary;
  $('heightValue').textContent=presetName?'未启用':`${state.cut.toFixed(2)} m`;
  $('viewLabel').textContent=firstPerson.mode?'':heightSummary;
  invalidate();
}
function refreshFilter(){
  iconRevision++;
  refresh();
}
function resetFilterHeight(){setHeightCut(heightRange.max,'all',true);updateGeometry();refreshFilter();}
function clearPointFilters(){pointSelection.clear();itemSearch.reset();notice('');refreshFilter();}
function locateScreenshot(screenshot){
  if(!screenshotWithinBounds(screenshot.position,screenshotBounds))throw Error(`截图坐标超出${MAP.name}范围，请切换到游戏中的地图后重试。`);
  if(firstPerson.mode)leaveFirstPerson('top');
  screenshotPosition={...screenshot.position};state.entryPoint=null;
  const p=unityToView(screenshotPosition),next=new THREE.Vector3(p.x,p.y,p.z);
  setHeightCut(screenshotPosition.y+1,'custom');updateGeometry();
  rebaseOrbitPivot(camera,controls,next);
  camera.zoom=Math.min(controls.maxZoom,Math.max(camera.zoom,initialSpan/70));camera.updateProjectionMatrix();controls.update();
  $('tooltip').hidden=true;lastOverlay=-Infinity;refresh();sectorStreamer?.update();invalidate();
}
function updateScreenshotMarker(){
  const marker=screenshotUI.marker;
  if(!screenshotPosition||firstPerson.mode){marker.hidden=true;return;}
  const p=unityToView(screenshotPosition);camera.updateMatrixWorld();screenshotProjection.set(p.x,p.y,p.z).project(camera);
  const {x,y,z}=screenshotProjection;marker.hidden=z< -1||z>1||Math.abs(x)>1||Math.abs(y)>1;
  if(!marker.hidden){marker.style.left=`${(x+1)*viewport.clientWidth/2}px`;marker.style.top=`${(1-y)*viewport.clientHeight/2}px`;}
}
function choose(p,focus=false){
  if(!p)return;
  layout.openDetails();state.selected=p;
  if(focus){
    $('tooltip').hidden=true;
    const v=unityToView(displayPositions.get(p.id)||p.position),next=new THREE.Vector3(v.x,v.y,v.z);
    if(firstPerson.mode)firstPerson.teleport(next);
    else{state.entryPoint=p;rebaseOrbitPivot(camera,controls,next);camera.zoom=Math.max(camera.zoom,MAP.streamed?4:2.5);camera.updateProjectionMatrix();controls.update();}
    notice(firstPerson.mode?'已到达目标位置。':'已定位；切换第一人称将从此处进入。');
  }
  if(p.kind==='poi'){showPoiDetails(p);$('details').insertAdjacentHTML('beforeend',myTasks?.links(p)||'');refresh();return;}
  const raw=candidatesFor(p,state.data).filter(c=>c.weight==null||c.weight>0);
  const grouped=new Map();
  for(const c of raw){const entry=grouped.get(c.tpl)||{tpl:c.tpl,weight:0,unknown:false,forced:false,included:new Map(),variants:0};entry.weight+=c.weight||0;entry.unknown ||= c.weight==null;entry.forced ||= c.forced;entry.variants++;for(const i of c.included||[])entry.included.set(`${i.tpl}:${i.count}`,i);grouped.set(c.tpl,entry);}
  const candidates=[...grouped.values()].sort((a,b)=>b.weight-a.weight);
  $('details').scrollTop=0;
  $('details').innerHTML=`<div class="point-type">${p.kind==='container'?'容器':'散落物资'}</div><h2>${iconHtml(p,'detail-point-icon')}${escape(title(p))}</h2><div class="coordinate">X ${p.position.x.toFixed(1)} · Y ${p.position.y.toFixed(1)} · Z ${p.position.z.toFixed(1)}</div><button id="editPointIcon">更换图标</button><div class="detail-divider"></div><h3 class="pool-title">候选物品 <span>${candidates.length} 种</span></h3><div class="pool-note">权重不代表实际刷新率。</div>${p.joinStatus==='client-only'?'<p>物资池未收录。</p>':''}${candidates.map(it=>`<div class="item-row"><div class="name"><span title="${escape(state.data.items[it.tpl]?.en)}">${escape(itemName(it.tpl))}</span><b title="候选权重">${it.forced?'强制项':it.unknown?'—':it.weight.toLocaleString('en-US',{maximumFractionDigits:4})}</b></div>${it.included.size?`<details class="included"><summary>附带物品</summary>${[...it.included.values()].map(c=>`<div>${escape(itemName(c.tpl))} × ${c.count}</div>`).join('')}</details>`:''}</div>`).join('')}`;
  $('editPointIcon').onclick=()=>iconEditor.open(p);
  // Match each row to its own template, independently of the marker override.
  $('details').querySelectorAll('.item-row').forEach((row,i)=>{
    row.insertAdjacentHTML('afterbegin',itemIconHtml(candidates[i].tpl));
    const prices=document.createElement('div');prices.className='point-item-prices';prices.dataset.priceItem=candidates[i].tpl;row.querySelector('.name').after(prices);
    row.querySelectorAll('.included>div').forEach((child,j)=>{const tpl=[...candidates[i].included.values()][j].tpl;child.insertAdjacentHTML('afterbegin',itemIconHtml(tpl));const prices=document.createElement('div');prices.className='point-item-prices';prices.dataset.priceItem=tpl;child.append(prices);});
  });
  const pointSummary=attachPointValueSummary($('details'),p,{id:MAP.id,items:state.data.items,sources:state.data.sources});
  attachPointPrices($('details'),{summary:pointSummary,session:mapFilters.session});
  $('details').insertAdjacentHTML('beforeend',myTasks?.links(p)||'');
  refresh();
}
function showPoiDetails(p){
  if(p.quest){showQuestDetails(p);return;}
  if(p.bossPoint&&bossUI){bossUI.openPoint(p);return;}
  $('details').scrollTop=0;
  const item=p.keyId||p.weaponId,types=p.poiTypes;
  const note=types.includes('boss')?'候选区域，非固定出生点。':types.includes('sniper_zone')?'越界狙击区，不是狙击 Scav。':types.includes('mine')?'危险范围仅供参考。':types.some(t=>t.startsWith('extract_')||t==='transit')?'开放条件以对局为准。':'';
  $('details').innerHTML=`<h2>${iconHtml(p,'detail-point-icon')}${escape(types.includes('locked_door')?'上锁的门':title(p))}</h2>${p.originalLabel&&p.originalLabel!==p.label?`<p class="poi-original-name" lang="en">${escape(p.originalLabel)}</p>`:''}<div class="coordinate">X ${p.position.x.toFixed(1)} · Y ${p.position.y.toFixed(1)} · Z ${p.position.z.toFixed(1)}</div>${note?`<p>${escape(note)}</p>`:''}<button id="editPointIcon">更换图标</button>${item?`<h3>${p.keyId?'对应钥匙':'固定武器'}</h3><div class="poi-key">${itemIconHtml(item)}<span>${escape(itemName(item))}</span></div>`:''}${types.includes('locked_door')&&!p.keyId?'<p>钥匙或开启方式未收录。</p>':''}`;
  mapKeys?.appendDoorLinks(p,$('details'));
  $('editPointIcon').onclick=()=>iconEditor.open(p);
}
function locateBossPoint(id){
  const p=state.data.points.find(p=>p.id===id);
  if(!p||!bossUI?.eligible(p)){notice('当前模式或场景没有这条点位记录，请切换后查看。');return;}
  mapUI.showTab('point',false);bossUI.enable(p.bossRefs[0].role);
  if(firstPerson.mode)leaveFirstPerson('top');
  setHeightCut(heightRange.max,'all');updateGeometry();refreshFilter();choose(p,true);
}
function locateKeyDoor(point){
  mapUI.showTab('point',false);
  if(firstPerson.mode)leaveFirstPerson('top');
  const view=keyDoorView(point,state.data.heightBands,MAP);
  const localPreset=presetForCutPoint(cutProfile,point.position,cutPreset());
  setHeightCut(localPreset?heightRange.max:view.cut,localPreset?'cut:'+localPreset:'custom');
  updateGeometry();
  camera.zoom=Math.min(controls.maxZoom,Math.max(camera.zoom,initialSpan/45));
  choose(point,true);
  if(matchMedia(COMPACT_LAYOUT_QUERY).matches)layout.closeDetails();
  renderer.domElement.focus({preventScroll:true});
  sectorStreamer?.update();invalidate();
  notice(`已定位：${itemName(point.keyId)}`);
}
function selectQuest(questId=''){
  mapUI.showTab('point',false);pointTypes.selectTask(questId);layout.openFilters();refreshFilter();
}
function showQuestDetails(p){
  $('details').scrollTop=0;
  const active=pointTypes.taskReferences(p),references=[...active,...p.questObjectives.filter(ref=>!active.includes(ref))];
  const related=state.data.points.filter(other=>other.quest&&other.id!==p.id&&other.questObjectives.some(r=>references.some(ref=>ref.questId===r.questId)));
  $('details').innerHTML=`<div class="point-type">${escape(POI_TYPES[p.poiTypes[0]][0])}</div><h2>${iconHtml(p,'detail-point-icon')}${escape(p.itemId?itemName(p.itemId):references[0].name)}</h2><div class="coordinate">X ${p.position.x.toFixed(1)} · Y ${p.position.y.toFixed(1)} · Z ${p.position.z.toFixed(1)}</div><p class="quest-source">${escape(p.note)}${p.sceneVariants.length===1?' · '+escape(p.sceneVariants[0]):''}</p><button id="editPointIcon">更换图标</button>${references.map(ref=>`<section class="quest-objective"><h3 title="${escape(ref.en)}">${escape(ref.name)}</h3><div class="quest-meta">${escape(ref.trader)}${ref.count>1?' · 目标数量 '+ref.count:''}${ref.plantTime?' · 放置 '+ref.plantTime+' 秒':''}${ref.locations.length===1&&ref.locations[0].toLowerCase()==='factory4_night'?' · 夜间工厂':''}</div><p>${escape(ref.text)}</p>${ref.items.length?`<div class="quest-items">${ref.items.map(tpl=>`<div class="poi-key">${itemIconHtml(tpl)}<span>${escape(itemName(tpl))}</span></div>`).join('')}</div>`:''}<button data-quest-filter="${escape(ref.questId)}">显示此任务地点</button></section>`).join('')}${p.itemId?'<p class="quest-source">任务物品候选点，是否出现取决于任务状态和对局。</p>':''}${related.length?`<details class="quest-related"><summary>同任务其他点位（${related.length}）</summary>${related.map(other=>`<button class="result-row" data-quest-point="${escape(other.id)}"><strong>${iconHtml(other)}<span>${escape(other.questObjectives[0].text)}</span></strong><small>${escape(POI_TYPES[other.poiTypes[0]][0])} · 高度 ${other.position.y.toFixed(1)} m</small></button>`).join('')}</details>`:''}`;
  $('editPointIcon').onclick=()=>iconEditor.open(p);
  $('details').querySelectorAll('[data-quest-filter]').forEach(b=>b.onclick=()=>selectQuest(b.dataset.questFilter));
  $('details').querySelectorAll('[data-quest-point]').forEach(b=>b.onclick=()=>{
    const next=state.data.points.find(p=>p.id===b.dataset.questPoint);
    selectQuest(next.questObjectives.find(r=>references.some(ref=>ref.questId===r.questId)).questId);choose(next,true);
  });
}
function expandCluster(cluster){
  $('tooltip').hidden=true;
  if(firstPerson.mode)leaveFirstPerson(previousMode);
  const p=unityToView(displayPositions.get(cluster.point.id)||cluster.point.position),target=new THREE.Vector3(p.x,controls.target.y,p.z);
  state.entryPoint=null;
  rebaseOrbitPivot(camera,controls,target);camera.zoom=Math.min(controls.maxZoom,camera.zoom*2);camera.updateProjectionMatrix();controls.update();invalidate();
  notice('已放大此区域，选择具体点位即可定位。');
}
function chooseCluster(cluster){
  layout.openDetails();
  $('details').scrollTop=0;
  $('details').innerHTML=`<div class="point-type">密集点位</div><h2>${cluster.members.length} 个相邻点位</h2><button id="expandCluster">放大此区域</button><div class="cluster-list">${cluster.members.map(p=>`<button class="result-row" data-cluster-point="${escape(p.id)}"><strong>${iconHtml(p)}<span>${escape(title(p))}</span></strong><small>Y ${p.position.y.toFixed(2)} m · ${escape(markerLabel(p))}</small></button>`).join('')}</div>`;
  $('expandCluster').onclick=()=>expandCluster(cluster);
  $('details').querySelector('.cluster-list').onclick=e=>{const id=e.target.closest('[data-cluster-point]')?.dataset.clusterPoint;if(id)choose(state.data.points.find(p=>p.id===id),true);};
}
function setupNavigator(manifest){
  const host=$('mapNavigator');host.hidden=false;
  $('toggleNavigator').addEventListener('click',()=>{lastOverlay=-Infinity;invalidate();});
  const canvas=$('navigatorCanvas'),ctx=canvas.getContext('2d'),w=180,h=160;
  canvas.width=w*2;canvas.height=h*2;ctx.scale(2,2);
  let preview=null,image=null,transform=null,cachedHeading=null,loading=false,loadError='';
  const background=document.createElement('canvas');background.width=canvas.width;background.height=canvas.height;const bg=background.getContext('2d');bg.scale(2,2);
  const caption=host.querySelector('.navigator-caption small');
  async function loadPreview(){
    if(loading)return;loading=true;loadError='';caption.textContent='加载预览…';canvas.setAttribute('aria-busy','true');
    try{
      const response=await fetch('data/atlas-catalog.json');if(!response.ok)throw Error();
      const catalog=await response.json();preview=catalog.maps.find(map=>map.id===MAP.id)?.preview;
      if(!preview||preview.geometrySha256!==(manifest.sourceGeometrySha256||manifest.sha256))throw Error('预览图待更新');
      transform=previewMinimapTransform(manifest.bounds,preview,state.heading,w,h);
      const next=new Image();next.src=`${preview.file}?v=${preview.sha256}`;await next.decode();
      if(next.naturalWidth!==preview.width||next.naturalHeight!==preview.height)throw Error();
      image=next;cachedHeading=null;caption.textContent='跟随朝向';
    }catch(error){loadError=error.message==='预览图待更新'?error.message:'预览图加载失败';caption.textContent='点击重试';}
    finally{loading=false;canvas.setAttribute('aria-busy','false');lastOverlay=-Infinity;invalidate();}
  }
  loadPreview();
  const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),v=new THREE.Vector3();
  canvas.onclick=e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*w/r.width,z=(e.clientY-r.top)*h/r.height;
    if(!image){loadPreview();return;}transform=previewMinimapTransform(manifest.bounds,preview,state.heading,w,h);
    if(!transform.contains(x,z))return;const position=transform.world(x,z);
    if(firstPerson.mode){firstPerson.teleport(new THREE.Vector3(position.x,camera.position.y-1.65,-position.z));return;}
    const next=new THREE.Vector3(position.x,controls.target.y,-position.z),delta=next.clone().sub(controls.target);
    camera.position.add(delta);controls.target.copy(next);controls.update();invalidate();};
  return ()=>{
    if(host.classList.contains('collapsed'))return;
    if(!image){ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.fillStyle='#c7b985';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(loadError||'加载预览…',w/2,h/2);ctx.textAlign='start';return;}
    if(cachedHeading!==state.heading){
      cachedHeading=state.heading;transform=previewMinimapTransform(manifest.bounds,preview,state.heading,w,h);
      bg.fillStyle='#101820';bg.fillRect(0,0,w,h);bg.save();bg.transform(...transform.imageMatrix);bg.drawImage(image,0,0);bg.restore();
    }
    const pixel=transform.pixel;ctx.clearRect(0,0,w,h);ctx.drawImage(background,0,0,w,h);
    ctx.beginPath();let count=0;
    const center=firstPerson.mode?camera.position:controls.target;plane.constant=-(firstPerson.mode?center.y-1.65:center.y);
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){ray.setFromCamera(new THREE.Vector2(x,y),camera);if(ray.ray.intersectPlane(plane,v)){const p=pixel(v.x,-v.z);if(!count++)ctx.moveTo(...p);else ctx.lineTo(...p);}}
    if(count===4){ctx.closePath();ctx.fillStyle='#b5a16a25';ctx.fill();ctx.strokeStyle='#c7b985';ctx.lineWidth=1.2;ctx.stroke();}
    const p=pixel(center.x,-center.z);ctx.fillStyle='#e7c087';ctx.beginPath();ctx.arc(...p,2.5,0,Math.PI*2);ctx.fill();
    if(screenshotPosition){const mark=pixel(screenshotPosition.x,screenshotPosition.z);ctx.beginPath();ctx.arc(...mark,4,0,Math.PI*2);ctx.fillStyle='#53e5b3';ctx.fill();ctx.strokeStyle='#e5fff3';ctx.lineWidth=1.5;ctx.stroke();}
    const [zx,zy]=transform.axisZ;ctx.strokeStyle='#c7b985';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(w-20,20);ctx.lineTo(w-20+zx*12,20+zy*12);ctx.stroke();ctx.font='9px monospace';ctx.fillStyle='#c7b985';ctx.fillText('+Z',w-27+zx*16,23+zy*16);
  };
}
const projected=new THREE.Vector3();
function setMeasuring(active){
  measuring=active;
  if(active&&pickingPivot){pickingPivot=false;renderer.domElement.style.cursor='';}
  if(!active)measurements.end();
  $('measureDistance').classList.toggle('active',active);
  viewport.classList.toggle('is-measuring',active);
  $('tooltip').hidden=true;resetPointGestures();
  notice(active?'左键标点 · 右键空白另起一条线 · 右键标点删除':'');
}
function measureTap(event,right){
  const position=mapPointer(event),{x,y,width,height}=position;
  if(right){
    if(measurements.removeAt(camera,position)){notice('');invalidate();}
    else{measurements.end();notice('下次标点将另起一条线。');}
    return;
  }
  if(!state.geometry||!heightRange||!width||!height){notice('请点击已加载的地图表面。');return;}
  const ndc=new THREE.Vector2(x/width*2-1,1-y/height*2);
  const point=scenePivot(ndc,p=>Math.abs(projected.copy(p).project(camera).z)<=1);
  if(!point){notice('请点击已加载的地图表面。');return;}
  const distance=measurements.add(point);
  notice(distance===null?'已标记起点，左键点击下一点。':`本段 ${formatMeasurement(distance)}`);
  invalidate();
}
function hit(event){const {x,y,width,height}=mapPointer(event);let nearest=null,distance=markerHitRadius(state.markerStyle,state.markerSize,event.pointerType);
  for(const p of state.displayPoints||state.visible){const v=unityToView(displayPositions.get(p.id)||p.position);projected.set(v.x,v.y+.07,v.z).project(camera);if(projected.z < -1 || projected.z>1)continue;const dx=(projected.x+1)*width/2-x,dy=(1-projected.y)*height/2-y,d=Math.hypot(dx,dy);if(d<distance){distance=d;nearest=p;}}
  if(nearest&&firstPerson.mode){
    const p=unityToView(displayPositions.get(nearest.id)||nearest.position),target=new THREE.Vector3(p.x,p.y+.07,p.z),dir=target.clone().sub(camera.position),length=dir.length();
    const {low,high}=floorBounds();
    const obstruction=collisionWorld.cast(camera.position,dir.normalize(),Math.max(0,length-.15),({point})=>
      point.y>=low&&point.y<=high&&point.y<=buildingCutView.highAt({x:point.x,z:-point.z},high));
    if(obstruction)return null;
  }
  return nearest;}
renderer.domElement.addEventListener('pointerup',e=>{
  const tap=tapTracker.up(e),flyGesture=firstPerson.mode&&(firstPerson.lookDragged||firstPerson.touchMoving);
  if(measuring){
    const right=measurementRightTap.up(e);
    if(right||tap&&!flyGesture)measureTap(e,right);
    return;
  }
  if(!tap||flyGesture){doubleTapTracker.reset();return;}
  const p=hit(e);if(!p){doubleTapTracker.reset();return;}
  const twice=doubleTapTracker.tap(p.id,e),c=displayClusters.get(p.id);
  const select=()=>{
    pointTapTimer=null;
    if(c?.members.length>1){chooseCluster(c);if(twice)expandCluster(c);}
    else choose(p,twice);
    if(twice&&matchMedia(COMPACT_LAYOUT_QUERY).matches)layout.closeDetails();
  };
  // Opening a drawer on the first tap can cover the point before the second.
  if(twice)select();else pointTapTimer=setTimeout(select,450);
},true);
renderer.domElement.addEventListener('pointercancel',e=>{tapTracker.cancel(e);measurementRightTap.cancel(e);doubleTapTracker.reset();cancelPointTap();});
// Read a completed tap before controls release capture; an unexpected loss cancels it.
renderer.domElement.addEventListener('lostpointercapture',e=>{if(tapTracker.pointerCount)doubleTapTracker.reset();tapTracker.cancel(e);measurementRightTap.cancel(e);});
renderer.domElement.addEventListener('pointermove',e=>{
  const relative=measuring&&document.pointerLockElement===renderer.domElement;
  tapTracker.move(e,relative);
  if(measuring)measurementRightTap.move(e,relative);
  if(measuring||!state.data||e.buttons||e.pointerType==='touch'){$('tooltip').hidden=true;return;}
  const p=hit(e);$('tooltip').hidden=!p;
  if(p){const r=viewport.getBoundingClientRect();$('tooltip').style.left=`${Math.min(e.clientX-r.left+14,r.width-245)}px`;$('tooltip').style.top=`${Math.min(e.clientY-r.top+14,r.height-80)}px`;
    $('tooltip').innerHTML=`${escape(title(p))}<small>${displayClusters.get(p.id)?.members.length>1?`${displayClusters.get(p.id).members.length} 个相邻点位 · `:''}高度 ${p.position.y.toFixed(2)} m</small>`;}
});
renderer.domElement.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});

function addSceneGroups(groups){
  for(const group of groups)geometryGroup.add(group.mesh);
  state.groups.push(...groups);collisionWorld.add(groups);updateGeometry(groups);applySceneQuality(groups);invalidate();
}

export async function startMap(){
  performance.mark('atlas-start');
  $('loadMessage').textContent='读取地图场景清单…';
  const manifestPromise=readMapJson(MAP.geometry,'地图场景清单读取',{code:'SCENE-MANIFEST',readError:true});
  const iconsPromise=loadMarkerIcons();
  // Early parallel requests still have handlers if an unrelated data load fails.
  manifestPromise.catch(()=>{});iconsPromise.catch(()=>{});
  const [runtime,manifest]=await Promise.all([loadRuntimeDescriptor(MAP.id),manifestPromise]);
  if(!manifest?.bounds||!Array.isArray(manifest.materials)||!manifest.textures){
    throw mapLoadError('SCENE-MANIFEST-FORMAT', '地图场景清单不完整', {url:MAP.geometry});
  }
  $('loadMessage').textContent='核对模型与贴图目录…';
  const [textureResult,geometrySelection]=await Promise.all([
    loadTextureQuality(manifest,MAP.id,requestedQuality.texture),
    loadGeometryQuality(manifest,MAP,requestedQuality.geometry)
  ]);
  if(geometrySelection.quality!==requestedQuality.geometry||textureResult.quality!==requestedQuality.texture){
    const cause=geometrySelection.error||textureResult.error;
    throw cause?.diagnosticCode?cause:mapLoadError('SCENE-CATALOG-INVALID', '地图模型或贴图目录暂不可用', {cause});
  }
  const geometryResult=await loadSceneryDetails(geometrySelection,MAP,requestedQuality.scenery);
  const textureManifest=textureResult.manifest,renderManifest=geometryResult.manifest,geometryRuntime=geometryResult.runtime||runtime;
  const resourcePlan=makeMapCachePlan(MAP,renderManifest,textureManifest,{geometry:geometryResult.quality,texture:textureResult.quality,scenery:geometryResult.scenery});
  await mapSession.waitUntilActive();
  try{await prepareResourceLocation(MAP,resourcePlan,renderManifest);}
  catch(cause){throw cause?.diagnosticCode?cause:mapLoadError('STORAGE-PREPARE', '无法准备地图资源保存位置', {cause});}
  $('loadMessage').textContent='读取物资数据库…';
  heightRange=createHeightRange(manifest.bounds);
  $('cutHeight').min=heightRange.min;$('cutHeight').max=heightRange.max;$('cutHeight').step='any';
  setHeightCut(heightRange.max,'all');
  const prepared=await loadPreparedMap(MAP.id,runtime);
  let poiWarning='',regionData;
  if(prepared){state.data=prepared.data;regionData=prepared.regions;}
  else{
    const read=url=>readMapJson(url,'地图数据读取',{code:'MAP-DATA'});
    const [loot,poi,quests,regions]=await Promise.allSettled([read(MAP.data),read(`data/${MAP.id}-pois.json`),read(`data/tasks/maps/${MAP.id}.json`),read(`data/${MAP.id}-regions.json`)]);
    if(loot.status!=='fulfilled')throw loot.reason;
    state.data=mergeMapData(loot.value,poi.value,quests.value);
    if(poi.status!=='fulfilled')poiWarning='特殊点位数据加载失败，请刷新重试。';
    if(quests.status!=='fulfilled')poiWarning+=' 任务地点加载失败，请刷新重试。';
    if(regions.status==='fulfilled')regionData=regions.value;else regionLabels.fail();
  }
  await attachMapVolumes({mapId:MAP.id,data:state.data,regions:regionData,geometrySha256:manifest.sourceGeometrySha256||manifest.sha256}).catch(error=>console.warn('区域范围校验失败，保留原有轮廓。',error));
  try{
    bossData=await loadBossData({mapId:MAP.id,geometrySha256:manifest.sourceGeometrySha256||manifest.sha256,source:state.data.sources});
    attachBossPoints(state.data,bossData.map);
  }catch(error){poiWarning+=' BOSS 资料暂不可用，保留原有区域参考点。';console.warn(error.message);}
  buildingCuts=await createBuildingCutEditor({map:MAP,geometrySha256:manifest.sourceGeometrySha256||manifest.sha256,bounds:manifest.bounds,viewport,canvas:renderer.domElement,controls,getCamera:()=>camera,getPreset:cutPreset,setPreset:selectBuildingPreset,setMode,onChange:profile=>{cutProfile=profile;syncBuildingCuts();renderFloorButtons();updateGeometry();refreshFilter();},invalidate,notice});
  cutProfile=buildingCuts.profile;
  const height=savedInterface.height;
  if(height?.band==='custom'&&Number.isFinite(height.cut))setHeightCut(height.cut);
  else if(cutProfile.presets.some(preset=>height?.band==='cut:'+preset.id))setHeightCut(heightRange.max,height.band);
  if(regionData)regionLabels.setData(regionData);
  const d=state.data,sharedItemIndex=prepared?.itemIndex||createItemIndex(d);mapItemIndex=sharedItemIndex;
  performance.mark('atlas-data-ready');performance.measure('atlas-data-load','atlas-start','atlas-data-ready');
  $('loadMessage').textContent='加载游戏物品图标…';
  markerIcons=await iconsPromise;
  let settingsWarning='';
  try{const stored=localStorage.getItem(MAP.settingsKey);if(stored)iconSettings=validateSettings(JSON.parse(stored),markerIcons.manifest.entries);}catch{settingsWarning='保存的图标配置不可用，已显示默认图标。';}
  for(const p of d.points){
    const base=p.kind==='poi'?{mode:'poi',key:p.icon,label:p.poiTypes.map(t=>POI_TYPES[t][0]).join(' / '),description:p.note}:classifyPointMarker(p,d,markerIcons.manifest);baseMarkerDescriptors.set(p.id,base);
    markerDescriptors.set(p.id,resolveMarker(p,base,iconSettings,markerIcons.manifest.entries));
  }
  const markerFailure=await markerIcons.prepare([...markerDescriptors.values()].map(d=>d.key),{allowMissing:true});
  if(markerFailure){
    settingsWarning+=` 部分点位图标暂不可用，已使用通用图标 · ${markerFailure.diagnosticCode}`;
  }
  pointTypes=createPointTypesUI(d,$('pointTypes'),refreshFilter,{foldout:layout.foldout,selection:pointSelection});
  if(bossData)bossUI=createMapBosses({catalog:bossData.catalog,map:bossData.map,selection:pointSelection,host:$('pointTypes'),foldout:layout.foldout,details:$('details'),onChange:refreshFilter,
    onOpen:point=>{layout.openDetails();if(!point){state.selected=null;refresh();}},onLocate:locateBossPoint});
  itemSearch=createItemSearch({data:d,mapId:MAP.id,input:$('search'),sectionHost:$('targetItemSection'),iconHtml:itemIconHtml,onChange:refreshFilter,index:sharedItemIndex,taskPoints:pointTypes});
  ammoTree=createAmmoTree({host:$('pointTypes'),index:sharedItemIndex,selection:pointSelection,onChange:refreshFilter,foldout:layout.foldout,rememberSection:layout.rememberSection});
  mapKeys=createMapKeys({data:d,itemIndex:sharedItemIndex,host:$('pointTypes'),selection:pointSelection,foldout:layout.foldout,iconHtml:itemIconHtml,onSelect:locateKeyDoor});
  mapFilters=createMapFilters({index:sharedItemIndex,map:MAP,data:d,host:$('valueFilterSection'),onChange:refreshFilter,rememberSection:layout.rememberSection});
  if(mapUI.mode==='value')mapFilters.activate();
  myTasks=createMyTasks({data:d,mapId:MAP.id,host:$('myTaskSection'),iconHtml:itemIconHtml,onChange:refreshFilter,preparedIndex:prepared?.taskIndex,itemIndex:sharedItemIndex,selection:pointSelection,rememberSection:layout.rememberSection});
  $('poiCoverage').textContent=poiWarning;$('poiCoverage').hidden=!poiWarning;
  $('selectAllTypes').onclick=()=>{pointSelection.setMany([...pointTypes.types.map(t=>t.key),...(ammoTree?.keys||[]),...(mapKeys?.keys||[]),...(myTasks?.keys||[]),...(bossUI?.keys||[])],true);};$('clearAllTypes').onclick=()=>pointSelection.clear();pointSelection.subscribe(refreshFilter);
  iconEditor=createIconEditor({points:d.points,base:baseMarkerDescriptors,icons:markerIcons,getSettings:()=>iconSettings,onChange:applyIconSettings,exportName:MAP.id});
  $('openIconSettings').disabled=false;$('openIconSettings').onclick=()=>iconEditor.open();
  $('iconLibraryStatus').textContent=settingsWarning;$('iconLibraryStatus').hidden=!settingsWarning;
  $('versionNote').textContent=`游戏版本 ${d.sources.atlas.clientVersion||'未知'} · ${d.sources.spt?(d.sources.versionMatch?'物资数据适配当前版本':'物资数据与游戏版本存在差异'):'物品池未收录'}`;
  renderFloorButtons();
  $('floors').onclick=e=>{const b=e.target.dataset.band;if(!b)return;if(b.startsWith('cut:'))selectBuildingPreset(b.slice(4));else{setHeightCut(heightRange.max,'all',true);updateGeometry();refresh();}};
  $('cutHeight').oninput=()=>{setHeightCut(+$('cutHeight').value,'custom',true);updateGeometry();refresh();};

  $('markerLegend').hidden=state.markerStyle==='icons';
  $('clearSearch').onclick=()=>itemSearch.clearQuery();
  $('clearPointFilters').onclick=clearPointFilters;
  $('clearValueFilters').onclick=()=>mapFilters.reset();
  applyPageMapRequest(new URL(mapSession.mapUrl));
  $('resultList').onclick=e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(id)choose(d.points.find(p=>p.id===id),true);};
  $('topView').onclick=()=>setMode('top');$('orbitView').onclick=()=>setMode('orbit');$('resetView').onclick=()=>{state.entryPoint=null;if(firstPerson.mode)leaveFirstPerson(previousMode);state.heading=DEFAULT_HEADING;fit();rememberCamera();notice('');};
  $('openViewSettings').onclick=()=>viewUI.open();$('flyView').onclick=()=>enterFirstPerson();
  $('leaveFirstPerson').onclick=()=>leaveFirstPerson();$('lockLook').onclick=()=>firstPerson.lock();
  $('rotateLeft').onclick=()=>rotateView(-Math.PI/12);$('rotateRight').onclick=()=>rotateView(Math.PI/12);
  $('resetHeading').onclick=()=>rotateView(DEFAULT_HEADING-controls.getAzimuthalAngle());
  $('toggleGeometry').onclick=()=>setGeometryVisible(!state.geometry);
  $('exportData').onclick=()=>{const blob=new Blob([JSON.stringify({sources:d.sources,filter:{mode:mapUI.mode,query:$('search').value,types:[...pointTypes.selected],itemSelection:itemSearch.selection(),myTasks:myTasks.selection(),valueFilters:mapFilters.selection(),...floorBounds()},points:state.visible,items:d.items,pools:d.pools},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${MAP.id}-loot-selection.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  grid=new THREE.GridHelper(MAP.streamed?1600:300,MAP.streamed?160:60,'#2b404d','#1d2e3a');gameWorld.add(grid);applyMapSkin(currentMapPalette);
  if(MAP.fitSceneOnZoomOut)sceneOverview=createSceneOverview(renderManifest.bounds);
  fit();restoreCamera(manifest.sceneSha256||manifest.sourceGeometrySha256||manifest.sha256);firstPersonUI();refresh();
  screenshotBounds=manifest.bounds;screenshotUI.ready();
  const bossParams=new URL(mapSession.mapUrl).searchParams,requestedBoss=bossParams.get('boss');
  if(requestedBoss&&bossUI&&bossData.catalog.roles.some(r=>r.id===requestedBoss)){
    mapUI.showTab('point',false);layout.openFilters();bossUI.enable(requestedBoss);bossUI.openRole(requestedBoss);
    if(bossParams.get('bossPoint'))locateBossPoint(bossParams.get('bossPoint'));
  }
  $('loadMessage').textContent='加载地图模型…';
  navigatorDraw=setupNavigator(manifest);
  viewUI.sceneryDetails(geometryResult);
  if(geometryResult.sceneryWarning)notice(`${geometryResult.sceneryWarning} · ${geometryResult.sceneryError?.diagnosticCode||'SCENERY-LOAD'}`);
  if(MAP.streamed){
    viewUI.manifest(renderManifest);
    sectorStreamer=createSectorStreamer({manifest:renderManifest,map:MAP,runtime:geometryRuntime,textureManifest,geometryBase:geometryResult.base,geometryEndpoint:geometryResult.endpoint,getView:()=>({camera,center:firstPerson.mode?camera.position:controls.target,firstPerson:Boolean(firstPerson.mode),overview:state.geometry&&!firstPerson.mode&&atSceneOverview()}),clipping:uniforms,settings:viewSettings,
      onAdd:addSceneGroups,
      onRemove:groups=>{collisionWorld.remove(groups);const removed=new Set(groups);for(const g of groups)g.mesh.removeFromParent();state.groups=state.groups.filter(g=>!removed.has(g));invalidate();},
      onStatus:(message,error,paused,failure,sectorId)=>{
        const action=error?(failure.status===409||failure.requiresReload?reloadMap:()=>sectorStreamer.retry()):null;
        setSceneStatus(message,action,failure,sectorId);viewUI.status(message,paused);
      }});
    sectorStreamer.setSuspended(pageSuspended);updateGeometry();sectorStreamer.update();$('loading').style.display='none';invalidate();return;
  }
  await mapSession.waitUntilActive();
  const controller=new AbortController();
  let buffer,spatial;
  try{
    [buffer,spatial]=await Promise.all([loadFactoryGeometry(renderManifest,(done,total,source)=>{
      $('loadMessage').textContent=geometryProgressText(done,total,source)+'…';
    },geometryResult.endpoint,controller.signal),loadPreparedSpatial(MAP.id,'whole',renderManifest,geometryRuntime,{signal:controller.signal})]);
  }finally{controller.abort();}
  const library=createMaterialLibrary(textureManifest,uniforms);
  const renderedMaterials=new Set();
  async function loadMissingMaterials(){
    $('loadMessage').textContent='加载地图贴图…';
    setSceneStatus(`${MAP.name}场景 · 加载贴图`);
    try{
      for await(const {groups,materialIds} of texturedGroupBatches(renderManifest,buffer,library,spatial,{skipMaterials:renderedMaterials,waitUntilActive:()=>mapSession.waitUntilActive(),progress:(done,total)=>{
        $('loadMessage').textContent=`加载地图贴图 ${done} / ${total}…`;
        setSceneStatus(`${MAP.name}场景 · 补充贴图 ${done}/${total}`);
      }})){
        addSceneGroups(groups);for(const id of materialIds)renderedMaterials.add(id);
        $('loading').style.display='none';
        setSceneStatus(`${MAP.name}场景 · 逐步显示 ${state.groups.length}/${renderManifest.meshes.length}`);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      setSceneStatus();
    }catch(error){
      const failure=error.diagnosticCode?error:mapLoadError('SCENE-MATERIAL-LOAD', '场景材质加载失败', {cause:error});
      console.error(failure.diagnosticCode,MAP.id,failure.url||'',failure);
      const changed=failure.status===409||failure.requiresReload;
      setSceneStatus(`场景加载不完整 · ${mapErrorMessage(failure)} · ${changed?'重新加载地图':'点击重试'}`,changed?reloadMap:loadMissingMaterials,failure);
    }finally{
      $('loading').style.display='none';
    }
  }
  window.factoryDebug={state,manifest,renderer,camera,scene,controls};
  await loadMissingMaterials();
}
function applyPageMapRequest(url){
  if(myTasks&&url.searchParams.get('myTasks')==='1'){mapUI.showTab('point',false);myTasks.enable(url.searchParams.get('task'));layout.openFilters();}
}
const mapSession=installMapSession({map:MAP,
  shouldReload:()=>readSceneryMode()!==requestedQuality.scenery,
  onSuspend(){
    flushCamera();screenshotUI.setSuspended(true);
    pageSuspended=true;sectorStreamer?.setSuspended(true);firstPerson.setSuspended(true);touchNavigation.reset();resetPointGestures();
    clearTimeout(overlayTimer);overlayTimer=null;$('tooltip').hidden=true;
  },
  onResume(url,{routeChanged}){
    screenshotUI.setSuspended(false);
    pageSuspended=false;
    const next=readMapViewSettings(MAP.id);
    if(JSON.stringify(next)!==JSON.stringify(viewSettings)){
      Object.assign(viewSettings,next);state.markerSize=next.markerSize;state.markerStyle=next.markerStyle;viewUI.sync();
      $('markerSizeValue').value=next.markerSize+' px';$('markerLegend').hidden=next.markerStyle==='icons';
      manualPivot=next.manualPivot?new THREE.Vector3(...next.manualPivot):null;controls.rotateSpeed=next.rotationSpeed;
      firstPerson.camera.fov=next.fov;firstPerson.camera.far=next.drawDistance;firstPerson.camera.updateProjectionMatrix();applySceneQuality();
      if(state.data&&pointTypes&&markerIcons)refresh();
    }
    firstPerson.setSuspended(false);sectorStreamer?.setSuspended(false);if(routeChanged)applyPageMapRequest(url);lastOverlay=-Infinity;
    // A resize while the map was covered must update the retained cameras too.
    resizeViewport();
  }
});
