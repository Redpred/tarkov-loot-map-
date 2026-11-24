import {ATLAS_MAPS} from './atlas-maps.js';
import {volumeContains,volumeCenter} from './atlas-region-bounds.js';
import {volumesFor,volumeContainsPosition,volumeCenterPosition} from './atlas-volumes.js';

// These are bounded proximity zones, not extracted building footprints. Keep
// their provenance in the generated dataset instead of implying exact borders.
export function buildRegionArrival(label,map){
  if(label.kind==='road')return null;
  if(map==='streets')return {radius:label.priority>=4?42:22,minY:-3,maxY:23,approximate:true};
  if(map!=='factory'){
    const config=ATLAS_MAPS[map],floors=Array.isArray(label.floor)?label.floor:[label.floor];
    const bands=config?.heightBands.filter(b=>floors.includes(b.id))||[];
    let minY=label.position.y-5,maxY=label.position.y+(label.kind==='room'?3:15);
    if(bands.length){minY=Math.max(minY,Math.min(...bands.map(b=>b.min)));maxY=Math.min(maxY,Math.max(...bands.map(b=>b.max)));}
    const radius=label.kind==='room'?7:config?.outdoor?45:map==='interchange'?35:map==='ground_zero'?28:25;
    return {radius,minY,maxY,approximate:true};
  }
  const floors=Array.isArray(label.floor)?label.floor:[label.floor];
  let minY=-.75,maxY=label.en==='Office Building'||/Stairs$/.test(label.en)?11:5;
  if(floors.includes('underground')){minY=-6;maxY=-.75;}
  else if(floors.includes('office')){minY=6.75;maxY=11;}
  else if(floors.includes('upper')){minY=floors.includes('ground')?-.75:3.25;maxY=6.75;}
  else if(floors.includes('ground')){minY=-.75;maxY=3.25;}
  const radius=label.kind==='room'?4:label.en==='Office Building'?16:8;
  return {radius,minY,maxY,approximate:true};
}

function score(label,position,exit=false){
  if(label.volumes?.length){
    const volumes=volumesFor(label);
    if(volumes.length){
      const matches=volumes.filter(volume=>volumeContainsPosition(volume,position));if(!matches.length)return null;
      const ratios=matches.map(volume=>{
        const center=volumeCenterPosition(volume),vertices=volume.type==='box'?volume.corners:volume.polygon?.map(p=>[p.x,0,p.z])||[];
        const radius=Math.max(1,volume.radius||0,...vertices.map(p=>Math.hypot(p[0]-center.x,p[2]-center.z)));
        return Math.hypot(position.x-center.x,position.z-center.z)/radius;
      });
      return {label,ratio:Math.min(...ratios),rank:label.kind==='room'?4:3};
    }
  }
  if(label.volume){
    if(!volumeContains(label.volume,position))return null;
    const center=volumeCenter(label.volume),radius=Math.max(1,...label.volume.polygon.map(p=>Math.hypot(p.x-center.x,p.z-center.z)));
    return {label,ratio:Math.hypot(position.x-center.x,position.z-center.z)/radius,rank:label.kind==='room'?4:3};
  }
  const a=label.arrival;
  if(!a||![position.x,position.y,position.z].every(Number.isFinite))return null;
  if(position.y<a.minY||position.y>=a.maxY)return null;
  const distance=Math.hypot(position.x-label.position.x,position.z-label.position.z),ratio=distance/a.radius;
  if(distance>a.radius+(exit?Math.min(3,a.radius*.2):0))return null;
  return {label,ratio,rank:label.kind==='room'?2:1};
}

export function regionAtPosition(labels,position,currentId=null){
  const candidates=labels.map(l=>score(l,position)).filter(Boolean).sort((a,b)=>b.rank-a.rank||a.ratio-b.ratio||a.label.id.localeCompare(b.label.id));
  const next=candidates[0],current=labels.find(l=>l.id===currentId),held=current&&score(current,position,true);
  if(held&&(!next||next.label.id===currentId||(next.rank<=held.rank&&next.ratio+.2>=held.ratio)))return current;
  return next?.label||null;
}

export function createRegionArrivalTracker(labels,{dwellMs=450,cooldownMs=3500}={}){
  let currentId=null,pendingId,pendingSince=0;const notified=new Map();
  return {
    update(position,now){
      const next=regionAtPosition(labels,position,currentId),id=next?.id||null;
      if(id===currentId){pendingId=undefined;return null;}
      if(id!==pendingId){pendingId=id;pendingSince=now;return null;}
      if(now-pendingSince<dwellMs)return null;
      currentId=id;pendingId=undefined;
      if(!next||now-(notified.get(id)??-Infinity)<cooldownMs)return null;
      notified.set(id,now);return next;
    },
    get currentId(){return currentId;},
    reset(){currentId=null;pendingId=undefined;notified.clear();}
  };
}

export function createRegionArrivalNotice({getName}){
  const root=document.createElement('div');root.id='regionArrivalNotice';root.hidden=true;root.setAttribute('role','status');root.setAttribute('aria-live','polite');root.setAttribute('aria-atomic','true');
  root.innerHTML='<span class="region-arrival-caption">附近区域</span><strong id="regionArrivalName"></strong><small id="regionArrivalOriginal"></small>';
  document.querySelector('.map-panel').append(root);
  let tracker=null,interval=null,expiry=null,camera=null,shown=null;
  function hide(){clearTimeout(expiry);expiry=null;root.hidden=true;shown=null;}
  function stop(){clearInterval(interval);interval=null;camera=null;tracker?.reset();hide();}
  function show(label){
    clearTimeout(expiry);shown=label;root.querySelector('strong').textContent=getName(label);root.querySelector('small').textContent=label.en;
    root.hidden=false;root.classList.remove('arriving');void root.offsetWidth;root.classList.add('arriving');
    expiry=setTimeout(hide,4500);
  }
  function tick(){
    if(!tracker||!camera||document.hidden||document.querySelector('dialog[open]'))return;
    const p=camera.position,entry=tracker.update({x:p.x,y:p.y-1.65,z:-p.z},performance.now());
    if(entry)show(entry);
    else if(shown&&tracker.currentId!==shown.id)hide();
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
  return {
    setData(labels){stop();tracker=createRegionArrivalTracker(labels);},
    update(view,enabled){
      if(!enabled||!view.firstPerson){if(interval!==null)stop();return;}
      camera=view.camera;
      if(interval===null){interval=setInterval(tick,100);tick();}
    },
    rename(){if(shown)root.querySelector('strong').textContent=getName(shown);},
    stop
  };
}
