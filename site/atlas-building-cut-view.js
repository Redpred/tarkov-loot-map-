import {createCutPlan,cutVolumeFaces,facesEdges} from './atlas-building-cuts.js';
import {clippedVolume,volumesFor,volumeDisplayPosition,pointIntersectsHeight} from './atlas-volumes.js';

export function createBuildingCutView(){
  let plan=null,revision=0,cache=new WeakMap();
  function clip(volume,low,high){
    const original=clippedVolume(volume,low,high);
    if(!plan)return original;
    const parts=cutVolumeFaces(original.faces,plan),faces=parts.flat();return {faces,edges:facesEdges(faces),parts};
  }
  function entry(entry,low,high){
    let cached=cache.get(entry);if(cached?.low===low&&cached?.high===high)return cached;
    const fragments=volumesFor(entry).map(v=>clip(v,low,high));
    const visible=fragments.some(f=>f.faces.length);
    let position=volumeDisplayPosition(entry,low,high);
    if(visible&&position.y>(plan?.highAt(position,high)??high)){
      const candidates=fragments.flatMap(f=>f.parts||[f.faces]).filter(f=>f.length).map(f=>{
        const vertices=f.flat(),top=Math.max(...vertices.map(p=>p[1])),cap=vertices.filter(p=>Math.abs(p[1]-top)<1e-5);
        return {x:cap.reduce((s,p)=>s+p[0],0)/cap.length,y:top,z:cap.reduce((s,p)=>s+p[2],0)/cap.length};
      });
      candidates.sort((a,b)=>Math.hypot(a.x-entry.position.x,a.y-entry.position.y,a.z-entry.position.z)-Math.hypot(b.x-entry.position.x,b.y-entry.position.y,b.z-entry.position.z));position=candidates[0]||position;
    }
    cached={low,high,visible,position};cache.set(entry,cached);return cached;
  }
  return {
    set(profile,preset){plan=profile&&preset?createCutPlan(profile,preset):null;revision++;cache=new WeakMap();return plan;},
    get plan(){return plan;},get revision(){return revision;},
    highAt:(p,high)=>plan?.highAt(p,high)??high,
    visible(point,low,high){if(!plan)return pointIntersectsHeight(point,low,high);return volumesFor(point).length?entry(point,low,high).visible:Boolean(point.position&&point.position.y>=low&&point.position.y<plan.highAt(point.position,high));},
    position(point,low,high){return plan&&volumesFor(point).length?entry(point,low,high).position:volumeDisplayPosition(point,low,high);},
    clip,
  };
}
