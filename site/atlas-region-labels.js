import * as THREE from 'three';
import {unityToView} from './factory-coordinates.js';
import {createRegionNameEditor,regionNameKey,regionDisplayName,validateRegionNames} from './atlas-region-names.js';
import {createRegionArrivalNotice} from './atlas-region-arrivals.js';
import {volumesFor,volumeBounds,volumeIntersectsHeight} from './atlas-volumes.js';

export function validateRegionSettings(value){
  return {areas:value?.areas===true,roads:value?.roads===true,arrivals:value?.arrivals!==false};
}

export function regionVisibleOnFloor(label,band,low,high){
  if(low>high)return false;
  const volumes=volumesFor(label);
  if(volumes.length)return volumes.some(volume=>volumeIntersectsHeight(volume,low,high));
  // Building context remains available above ground; rooms belong to one floor.
  if(!label.floor)return band!=='underground'&&(label.heightMethod==='nearby-point-height'?high>=label.position.y:!label.sourceHeight||high>=label.sourceHeight.bottom);
  if(band!=='all'&&!(Array.isArray(label.floor)?label.floor:[label.floor]).includes(band))return false;
  return label.position.y<=high&&(Array.isArray(label.floor)||label.position.y>=low);
}

function overlaps(a,b,gap=7){return a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;}

// Pure projection/layout so coordinate handedness, clipping and decluttering can
// be checked without WebGL. Label sizes come from the actual browser font.
export function layoutRegionLabels(labels,{camera,width,height,settings,band='all',low=-10000,high=10000,firstPerson=false,distance=160,heightAt=null}){
  if(!width||!height||(!settings.areas&&!settings.roads))return [];
  camera.updateMatrixWorld();
  const projected=new THREE.Vector3(),world=new THREE.Vector3(),candidates=[];
  const pixelsPerMeter=camera.isOrthographicCamera?height*camera.zoom/(camera.top-camera.bottom):Infinity;
  for(const label of labels){
    const localHigh=heightAt&&!firstPerson?heightAt(label.position,high):high;
    if(!(label.kind==='road'?settings.roads:settings.areas))continue;
    if(!firstPerson&&!regionVisibleOnFloor(label,band,low,localHigh))continue;
    if(pixelsPerMeter<(label.minPixelsPerMeter||0))continue;
    if(!firstPerson&&pixelsPerMeter>=8&&label.overviewFor?.length&&(band==='all'||label.overviewFor.includes(band)))continue;
    const pos=unityToView(label.position);world.set(pos.x,pos.y,pos.z);
    if(firstPerson){
      const bounds=volumesFor(label).map(volumeBounds);
      if(bounds.length)world.y=Math.max(Math.min(...bounds.map(b=>b.minY)),Math.min(Math.max(...bounds.map(b=>b.maxY)),camera.position.y-1.65));
      // Nearby, floor-specific names only; don't label an upstairs room from a
      // corridor below it. Buildings are orientation aids, not visible surfaces.
      if(label.floor&&(bounds.length?!bounds.some(b=>camera.position.y-1.65>=b.minY-2.5&&camera.position.y-1.65<=b.maxY+2.5):Math.abs(camera.position.y-1.65-pos.y)>2.5))continue;
      if(world.distanceTo(camera.position)>distance)continue;
      world.y+=1.8;
    }else if(!label.floor||Array.isArray(label.floor)||volumesFor(label).length){
      // Put broad names on the currently visible slice rather than below it.
      world.y=Math.min(localHigh,Math.max(low,pos.y));
    }
    projected.copy(world).project(camera);
    if(!Number.isFinite(projected.x)||projected.z< -1||projected.z>1)continue;
    const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2;
    const w=label.width??Math.max(36,label.name.length*14),h=label.height??22;
    const box={left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2};
    if(box.left<6||box.right>width-6||box.top<6||box.bottom>height-6)continue;
    candidates.push({label,x,y,...box,priority:label.priority+(label.kind==='room'?4:0),depth:world.distanceToSquared(camera.position)});
  }
  candidates.sort((a,b)=>b.priority-a.priority||(firstPerson?a.depth-b.depth:0)||a.label.id.localeCompare(b.label.id));
  const placed=[];
  for(const candidate of candidates){if(!placed.some(p=>overlaps(p,candidate)))placed.push(candidate);}
  return placed;
}

export function createRegionLabels({map,viewport,onChange}){
  const key=map+'-region-names-v1';
  const namesKey=map+'-region-custom-names-v1';
  let settings=validateRegionSettings(),labels=[],nodes=new Map(),names=Object.create(null),editor;
  try{settings=validateRegionSettings(JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
  const areaToggle=document.getElementById('showRegionNames'),roadToggle=document.getElementById('showStreetNames'),arrivalToggle=document.getElementById('showRegionArrival'),editButton=document.getElementById('editRegionNames');
  const layer=document.createElement('div');layer.id='regionLabels';layer.setAttribute('aria-label','建筑与区域名称图层');layer.hidden=true;
  viewport.appendChild(layer);
  const arrivals=createRegionArrivalNotice({getName:label=>regionDisplayName(label,names)});
  function sync(){
    areaToggle.checked=settings.areas;roadToggle.checked=settings.roads;arrivalToggle.checked=settings.arrivals;
    layer.hidden=!settings.areas&&!settings.roads;
  }
  for(const [element,property] of [[areaToggle,'areas'],[roadToggle,'roads'],[arrivalToggle,'arrivals']])element.addEventListener('change',()=>{
    settings[property]=element.checked;sync();
    if(!settings.arrivals)arrivals.stop();
    try{localStorage.setItem(key,JSON.stringify(settings));}catch{}
    onChange();
  });
  function updateNames(){
    for(const label of labels){
      const el=nodes.get(label.id),name=regionDisplayName(label,names);
      el.querySelector('strong').textContent=name;el.querySelector('small').textContent=label.en;
      el.setAttribute('aria-label',`${name} · ${label.en}`);
    }
    const wasHidden=layer.hidden;layer.hidden=false;layer.style.visibility='hidden';
    for(const el of nodes.values())el.hidden=false;
    for(const label of labels){const el=nodes.get(label.id);label.width=el.offsetWidth;label.height=el.offsetHeight;}
    for(const el of nodes.values())el.hidden=true;
    layer.hidden=wasHidden;layer.style.visibility='';arrivals.rename();onChange();
  }
  sync();
  return {
    setData(data){
      editor?.destroy();
      labels=data.labels;nodes=new Map();layer.replaceChildren();
      try{names=validateRegionNames(JSON.parse(localStorage.getItem(namesKey)||'{}'),labels);}catch{names=Object.create(null);}
      for(const label of labels){
        const el=document.createElement('span');el.className=`region-label region-${label.kind}`;
        el.dataset.regionId=label.id;el.append(document.createElement('strong'),document.createElement('small'));
        // Measure once, without a read/write layout cycle on each animation frame.
        layer.appendChild(el);nodes.set(label.id,el);
      }
      editor=createRegionNameEditor({labels,getNames:()=>names,onSave:(key,value)=>{
        const label=labels.find(l=>regionNameKey(l)===key);
        if(value&&value!==label.name)names[key]=value;else delete names[key];
        updateNames();
        try{localStorage.setItem(namesKey,JSON.stringify({version:1,names}));return '';}
        catch{return '已应用，但浏览器未能保存；刷新后会恢复。';}
      }});
      editButton.onclick=()=>editor.open();
      arrivals.setData(labels);updateNames();
      areaToggle.disabled=roadToggle.disabled=arrivalToggle.disabled=editButton.disabled=!labels.length;
      const status=document.getElementById('regionNamesStatus');status.hidden=Boolean(labels.length);status.textContent=data.emptyReason||'暂未收录区域名称。';
      document.getElementById('streetNamesOption').hidden=!labels.some(l=>l.kind==='road');
      onChange();
    },
    render(options){
      arrivals.update(options,settings.arrivals);
      if(layer.hidden)return;
      const placed=layoutRegionLabels(labels,{...options,width:viewport.clientWidth,height:viewport.clientHeight,settings});
      const visible=new Set(placed.map(p=>p.label.id));
      for(const [id,el] of nodes)el.hidden=!visible.has(id);
      for(const p of placed)nodes.get(p.label.id).style.transform=`translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`;
    },
    volumeLabels({band='all',low=-Infinity,high=Infinity,firstPerson=false}={}){
      return labels.filter(label=>(label.kind==='road'?settings.roads:settings.areas)&&volumesFor(label).length&&(firstPerson||regionVisibleOnFloor(label,band,low,high)));
    },
    fail(){areaToggle.disabled=roadToggle.disabled=arrivalToggle.disabled=editButton.disabled=true;layer.hidden=true;arrivals.stop();const status=document.getElementById('regionNamesStatus');status.hidden=false;status.textContent='名称加载失败，请刷新重试。';}
  };
}
