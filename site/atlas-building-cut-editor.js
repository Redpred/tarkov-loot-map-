import * as THREE from 'three';
import {validateBuildingCuts,createCutPlan,inCutRect,rectArea,defaultCutPresets} from './atlas-building-cuts.js';

export async function createBuildingCutEditor({map,geometrySha256,bounds,viewport,canvas,controls,getCamera,getPreset,setPreset,setMode,onChange,invalidate,notice}){
  const identity={map:map.id,geometrySha256},key=`atlas-building-cuts-${map.id}-v1`;
  const checked=input=>{const next=validateBuildingCuts(input,identity);for(const p of next.presets)createCutPlan(next,p.id);return next;};
  let initial={version:1,...identity,presets:defaultCutPresets(),regions:[]},warning='';
  try{const response=await fetch(`data/building-cuts/${map.id}.json`);if(!response.ok)throw Error('默认剖切数据未加载');initial=checked(await response.json());}catch(error){warning=error.message;}
  let saved=structuredClone(initial);
  try{const stored=localStorage.getItem(key);if(stored)saved=checked(JSON.parse(stored));}catch(error){warning=`${error.message}；已使用默认配置，原保存记录未删除。`;}
  let profile=structuredClone(saved),selected=null,open=false,action=null,drag=null,undo=[];
  const css=document.createElement('link');css.rel='stylesheet';css.href='atlas-building-cuts.css';document.head.append(css);
  const button=document.createElement('button');button.id='editBuildingCuts';button.type='button';button.textContent='编辑建筑剖切…';document.getElementById('heightSection').append(button);
  const note=document.createElement('p');note.className='hint';note.id='buildingCutSummary';button.before(note);
  const panel=document.createElement('section');panel.className='building-cut-editor';panel.hidden=true;panel.setAttribute('aria-label','建筑剖切编辑');
  panel.innerHTML=`<header><strong>建筑剖切</strong><div><button type="button" data-action="collapse" aria-expanded="true">收起面板</button><button type="button" data-action="close" aria-label="关闭建筑剖切编辑">×</button></div></header>
    <div class="building-cut-scroll"><label>楼层预设<select id="buildingCutPreset"></select></label>
    <label>建筑或区域<select id="buildingCutList" size="5"></select></label>
    <div class="cut-row"><button data-action="locate">定位</button><button data-action="pick">地图点选</button><button data-action="new">新增框选</button></div>
    <label>名称<input id="buildingCutName" maxlength="100"></label>
    <label>本层剖切高度（米）<input id="buildingCutHeight" type="number" step="0.05"></label>
    <input id="buildingCutSlider" aria-label="建筑剖切高度" type="range" step="0.05">
    <div class="cut-row"><button data-action="lower">−0.1 米</button><button data-action="raise">+0.1 米</button><button data-action="draw">重画范围</button></div>
    <p class="hint">在三维视图拖动金色高度手柄，可实时查看剖切。每栋建筑、每个楼层分别保存。</p>
    <details><summary>范围坐标</summary><div class="cut-coordinates"><label>最小 X<input id="cutMinX" type="number" step="0.1"></label><label>最大 X<input id="cutMaxX" type="number" step="0.1"></label><label>最小 Z<input id="cutMinZ" type="number" step="0.1"></label><label>最大 Z<input id="cutMaxZ" type="number" step="0.1"></label></div><button data-action="bounds">应用范围</button></details>
    <div class="cut-row"><button data-action="clear">本层不剖切</button><button data-action="restore">恢复此建筑</button><button data-action="remove">移除区域</button></div>
    <details><summary>导入 / 导出</summary><button data-action="export">导出本图</button><button data-action="import">导入本图</button><button data-action="defaults">恢复本图默认</button><input id="buildingCutFile" type="file" accept=".json,application/json" hidden><p class="hint">保存在当前浏览器；导出文件可用于备份或交给我更新默认预设。</p></details></div>
    <footer><div class="cut-row"><button data-action="save">保存预设</button><button data-action="undo">撤销保存</button><button data-action="cancel">取消修改</button></div><p id="buildingCutStatus" role="status"></p></footer>`;
  document.body.append(panel);const $=id=>panel.querySelector('#'+id);
  const overlay=document.createElement('div');overlay.className='building-cut-overlay';viewport.append(overlay);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),outline=document.createElementNS(svg.namespaceURI,'polygon');svg.append(outline);overlay.append(svg);
  const handle=document.createElement('button');handle.className='building-cut-handle';handle.setAttribute('aria-label','拖动调整建筑剖切高度');handle.title='上下拖动调整此建筑的剖切高度';handle.innerHTML='↕ <span></span>';overlay.append(handle);overlay.hidden=true;
  const bar=document.createElement('div');bar.className='building-cut-drawbar';bar.hidden=true;bar.innerHTML='<span></span><button>取消</button>';viewport.append(bar);bar.querySelector('button').onclick=()=>stopAction();
  const selectedRegion=()=>profile.regions.find(r=>r.id===selected),preset=()=>getPreset()||profile.presets[0].id;
  const dirty=()=>JSON.stringify(profile)!==JSON.stringify(saved);
  function status(text){$('buildingCutStatus').textContent=text;}
  function syncList(){
    $('buildingCutPreset').replaceChildren(...profile.presets.map(p=>new Option(p.name,p.id,false,p.id===preset())));
    $('buildingCutList').replaceChildren(...profile.regions.map(r=>new Option(`${r.name}${Number.isFinite(r.cuts[preset()])?'':' · 未设置'}`,r.id,false,r.id===selected)));
    if(!selected)$('buildingCutList').selectedIndex=-1;
  }
  function syncFields(){
    const r=selectedRegion(),cut=r?.cuts[preset()];
    $('buildingCutName').value=r?.name||'';$('buildingCutHeight').value=Number.isFinite(cut)?cut.toFixed(2):'';
    $('buildingCutSlider').min=Math.max(bounds.min[1],Number.isFinite(cut)?cut-12:bounds.min[1]);$('buildingCutSlider').max=Math.min(bounds.max[1],Number.isFinite(cut)?cut+12:bounds.max[1]);$('buildingCutSlider').value=Number.isFinite(cut)?cut:bounds.min[1];
    for(const [id,k] of [['cutMinX','minX'],['cutMaxX','maxX'],['cutMinZ','minZ'],['cutMaxZ','maxZ']])$(id).value=r?.[k]??'';
    for(const id of ['buildingCutName','buildingCutHeight','buildingCutSlider','cutMinX','cutMaxX','cutMinZ','cutMaxZ'])$(id).disabled=!r;
    panel.querySelector('[data-action="undo"]').disabled=!undo.length;render();
  }
  function changed(){if(!getPreset())setPreset(preset());onChange(profile,preset());syncSummary();render();status('预览中 · 尚未保存');}
  function collapse(value){panel.classList.toggle('collapsed',value);const toggle=panel.querySelector('[data-action="collapse"]');toggle.textContent=value?'展开面板':'收起面板';toggle.setAttribute('aria-expanded',String(!value));}
  function syncSummary(){const id=getPreset(),count=id?profile.regions.filter(r=>Number.isFinite(r.cuts[id])).length:0;note.textContent=id?`${count} 个剖切区域 · 初始预设，可逐栋调整；区域外保留完整高度`:'楼层预设按各个区域分别剖切，可逐栋编辑';}
  function choose(id){selected=id;syncList();syncFields();}
  function updateHeight(value){const r=selectedRegion();if(!r||!Number.isFinite(value))return;r.cuts[preset()]=Math.max(bounds.min[1],Math.min(bounds.max[1],value));r.edited=true;$('buildingCutHeight').value=r.cuts[preset()].toFixed(2);$('buildingCutSlider').value=r.cuts[preset()];changed();}
  function screenPoint(x,z,y){const p=new THREE.Vector3(x,y,-z).project(getCamera());return {x:(p.x+1)*viewport.clientWidth/2,y:(1-p.y)*viewport.clientHeight/2,visible:p.z>=-1&&p.z<=1};}
  function render(){
    if(!open){overlay.hidden=true;return;}const r=selectedRegion(),height=r?.cuts[preset()];
    overlay.hidden=!r||!Number.isFinite(height)||Boolean(action);if(overlay.hidden)return;
    const points=[[r.minX,r.minZ],[r.maxX,r.minZ],[r.maxX,r.maxZ],[r.minX,r.maxZ]].map(([x,z])=>screenPoint(x,z,height));
    svg.setAttribute('viewBox',`0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);outline.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));
    const p=screenPoint((r.minX+r.maxX)/2,(r.minZ+r.maxZ)/2,height);handle.hidden=!p.visible;handle.style.left=`${p.x}px`;handle.style.top=`${p.y}px`;handle.querySelector('span').textContent=height.toFixed(2)+' m';invalidate();
  }
  controls.addEventListener('change',render);
  const resize=new ResizeObserver(render);resize.observe(viewport);
  function ray(event){const box=canvas.getBoundingClientRect(),r=new THREE.Raycaster();r.setFromCamera(new THREE.Vector2((event.clientX-box.left)/box.width*2-1,1-(event.clientY-box.top)/box.height*2),getCamera());return r.ray;}
  function planePoint(event){const p=ray(event).intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-controls.target.y),new THREE.Vector3());return p?{x:p.x,z:-p.z}:null;}
  function stopAction(){if(drag?.pointerId!==undefined&&canvas.hasPointerCapture(drag.pointerId))canvas.releasePointerCapture(drag.pointerId);action=null;drag=null;bar.hidden=true;panel.hidden=!open;controls.enabled=true;canvas.style.cursor='';render();}
  function beginAction(type){stopAction();action=type;setMode('top');panel.hidden=true;bar.hidden=false;bar.querySelector('span').textContent=type==='pick'?'点击已设置的建筑范围':'拖动框选建筑范围';controls.enabled=false;canvas.style.cursor=type==='pick'?'pointer':'crosshair';render();}
  const capture=e=>{e.stopImmediatePropagation();e.preventDefault();};
  canvas.addEventListener('pointerdown',e=>{if(!action||e.button!==0)return;capture(e);const p=planePoint(e);if(!p)return;
    if(action==='pick'){const r=profile.regions.filter(r=>inCutRect(p,r)).sort((a,b)=>rectArea(a)-rectArea(b))[0];stopAction();if(r)choose(r.id);else status('此处尚无剖切区域，可新增框选。');return;}
    drag={pointerId:e.pointerId,start:p};canvas.setPointerCapture(e.pointerId);
  },true);
  canvas.addEventListener('pointermove',e=>{if(!action||!drag)return;capture(e);const p=planePoint(e);if(!p)return;overlay.hidden=false;handle.hidden=true;svg.setAttribute('viewBox',`0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);outline.setAttribute('points',[[drag.start.x,drag.start.z],[p.x,drag.start.z],[p.x,p.z],[drag.start.x,p.z]].map(([x,z])=>screenPoint(x,z,controls.target.y)).map(p=>`${p.x},${p.y}`).join(' '));},true);
  canvas.addEventListener('pointerup',e=>{if(!action||!drag||e.pointerId!==drag.pointerId)return;capture(e);const p=planePoint(e),start=drag.start,type=action;stopAction();if(!p||Math.abs(p.x-start.x)<.1||Math.abs(p.z-start.z)<.1){status('范围太小，请重新框选。');return;}
    let r=selectedRegion();if(type==='new'||!r){r={id:'user-'+crypto.randomUUID(),name:`建筑区域 ${profile.regions.length+1}`,cuts:{},edited:true};profile.regions.push(r);selected=r.id;}
    Object.assign(r,{minX:Math.min(p.x,start.x),maxX:Math.max(p.x,start.x),minZ:Math.min(p.z,start.z),maxZ:Math.max(p.z,start.z),edited:true});
    if(!Number.isFinite(r.cuts[preset()]))r.cuts[preset()]=Math.max(bounds.min[1],Math.min(bounds.max[1],controls.target.y+1.6));
    syncList();syncFields();setMode('orbit');changed();status('已建立框选草稿，请调整高度后保存。');
  },true);
  canvas.addEventListener('pointercancel',()=>{if(action)stopAction();},true);
  handle.addEventListener('pointerdown',e=>{capture(e);const r=selectedRegion();if(!r)return;const camera=getCamera(),direction=camera.getWorldDirection(new THREE.Vector3());direction.y=0;if(direction.lengthSq()<1e-8){setMode('orbit');return;}
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(direction.normalize(),new THREE.Vector3((r.minX+r.maxX)/2,r.cuts[preset()],-(r.minZ+r.maxZ)/2)),start=ray(e).intersectPlane(plane,new THREE.Vector3());if(!start)return;
    drag={pointerId:e.pointerId,plane,start:start.y,height:r.cuts[preset()]};controls.enabled=false;handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove',e=>{if(!drag?.plane||drag.pointerId!==e.pointerId)return;capture(e);const p=ray(e).intersectPlane(drag.plane,new THREE.Vector3());if(p)updateHeight(Math.round((drag.height+p.y-drag.start)*20)/20);});
  const stopHandle=()=>{drag=null;controls.enabled=true;syncFields();};handle.addEventListener('pointerup',stopHandle);handle.addEventListener('pointercancel',stopHandle);handle.addEventListener('lostpointercapture',()=>{if(drag?.plane)stopHandle();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.stopImmediatePropagation();if(action)stopAction();else close();}},true);
  window.addEventListener('blur',()=>{if(action)stopAction();if(drag?.plane)stopHandle();});
  $('buildingCutPreset').onchange=()=>{setPreset($('buildingCutPreset').value);syncList();syncFields();};
  $('buildingCutList').onchange=()=>choose($('buildingCutList').value);
  $('buildingCutName').onchange=()=>{const r=selectedRegion();if(r&&$('buildingCutName').value.trim()){r.name=$('buildingCutName').value.trim();syncList();changed();}};
  $('buildingCutHeight').oninput=()=>{if($('buildingCutHeight').value!=='')updateHeight(Number($('buildingCutHeight').value));};
  $('buildingCutSlider').oninput=()=>updateHeight(Number($('buildingCutSlider').value));
  function close(){stopAction();open=false;if(dirty()){profile=structuredClone(saved);onChange(profile,getPreset());}panel.hidden=true;overlay.hidden=true;syncSummary();invalidate();}
  async function save(){const next=validateBuildingCuts(profile,identity);for(const p of next.presets)createCutPlan(next,p.id);const previous={profile:structuredClone(saved),stored:localStorage.getItem(key)};localStorage.setItem(key,JSON.stringify(next));undo.push(previous);saved=next;profile=structuredClone(next);onChange(profile,getPreset());syncList();syncFields();status('已保存到当前浏览器');}
  panel.addEventListener('click',async e=>{const actionName=e.target.closest('[data-action]')?.dataset.action;if(!actionName)return;const r=selectedRegion();try{
    if(actionName==='close')close();
    if(actionName==='collapse')collapse(!panel.classList.contains('collapsed'));
    if(actionName==='save')await save();
    if(actionName==='cancel'){profile=structuredClone(saved);onChange(profile,getPreset());syncList();syncFields();status('已取消未保存修改');}
    if(actionName==='undo'&&undo.length){const previous=undo.at(-1);if(previous.stored===null)localStorage.removeItem(key);else localStorage.setItem(key,previous.stored);undo.pop();saved=structuredClone(previous.profile);profile=structuredClone(saved);onChange(profile,getPreset());syncList();syncFields();status('已撤销上次保存');}
    if(actionName==='defaults'){const previous={profile:structuredClone(saved),stored:localStorage.getItem(key)};localStorage.removeItem(key);undo.push(previous);saved=structuredClone(initial);profile=structuredClone(saved);selected=null;setPreset(profile.presets[0].id);onChange(profile,getPreset());syncList();syncFields();status('已恢复本图默认，可撤销');}
    if(actionName==='new')beginAction('new');
    if(actionName==='pick')beginAction('pick');
    if(actionName==='draw'&&r)beginAction('draw');
    if(actionName==='locate'&&r){const target=new THREE.Vector3((r.minX+r.maxX)/2,r.cuts[preset()]??controls.target.y,-(r.minZ+r.maxZ)/2),delta=target.clone().sub(controls.target),camera=getCamera();camera.position.add(delta);controls.target.copy(target);setMode('orbit');camera.zoom=Math.min(12,Math.max(controls.minZoom,(camera.top-camera.bottom)/(Math.max(r.maxX-r.minX,r.maxZ-r.minZ)+12)/2.3));camera.updateProjectionMatrix();controls.update();if(matchMedia('(max-width:700px)').matches)collapse(true);render();}
    if(actionName==='lower'&&r)updateHeight((r.cuts[preset()]??controls.target.y)-.1);
    if(actionName==='raise'&&r)updateHeight((r.cuts[preset()]??controls.target.y)+.1);
    if(actionName==='clear'&&r){r.cuts[preset()]=bounds.max[1];r.edited=true;syncList();syncFields();changed();}
    if(actionName==='restore'&&r){const original=initial.regions.find(v=>v.id===r.id);if(original)profile.regions[profile.regions.indexOf(r)]=structuredClone(original);else r.cuts={};syncList();syncFields();changed();}
    if(actionName==='remove'&&r){profile.regions=profile.regions.filter(v=>v!==r);selected=null;syncList();syncFields();changed();}
    if(actionName==='bounds'&&r){const candidate={...r,minX:Number($('cutMinX').value),maxX:Number($('cutMaxX').value),minZ:Number($('cutMinZ').value),maxZ:Number($('cutMaxZ').value),edited:true};validateBuildingCuts({...profile,regions:[candidate]},identity);Object.assign(r,candidate);changed();}
    if(actionName==='export'){const data=validateBuildingCuts(profile,identity),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${map.id}-building-cuts.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    if(actionName==='import')$('buildingCutFile').click();
  }catch(error){status(`未保存：${error.message}`);}});
  $('buildingCutFile').onchange=async()=>{try{const file=$('buildingCutFile').files[0];if(!file)return;if(file.size>2**20)throw Error('文件过大');const next=validateBuildingCuts(JSON.parse(await file.text()),identity);for(const p of next.presets)createCutPlan(next,p.id);profile=next;selected=null;setPreset(profile.presets[0].id);syncList();syncFields();changed();status('已导入预览，保存后生效');}catch(error){status('导入失败：'+error.message);}finally{$('buildingCutFile').value='';}};
  button.onclick=()=>{document.getElementById('heightDialog')?.close();document.getElementById('openHeight')?.setAttribute('aria-expanded','false');open=true;panel.hidden=false;collapse(false);if(!getPreset())setPreset(profile.presets[0].id);setMode('orbit');syncList();syncFields();status(warning||'选中建筑后调整高度；关闭面板会取消未保存修改。');};
  syncSummary();if(warning)notice(warning);
  return {get profile(){return profile;},sync(){syncSummary();if(open){syncList();syncFields();}},render,close,firstPerson(active){button.disabled=active;if(active){if(open)close();controls.enabled=false;}}};
}
