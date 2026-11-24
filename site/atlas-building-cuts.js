// Building cut coordinates are always original Unity XYZ. Names and heights are
// view preferences; they never alter the source geometry or task database.
export const CUT_SCHEMA=1;
export const MAX_CUT_REGIONS=1024;
export const CUT_GRID=64;
export const MAX_CELL_CUTS=128;
const finite=Number.isFinite;
export const rectArea=r=>(r.maxX-r.minX)*(r.maxZ-r.minZ);
export const inCutRect=(p,r)=>p.x>=r.minX&&p.x<=r.maxX&&p.z>=r.minZ&&p.z<=r.maxZ;
export const defaultCutPresets=()=>[{id:'first',name:'一楼'},{id:'second',name:'二楼'},{id:'third',name:'三楼'},{id:'basement',name:'地下'}];
export function validateBuildingCuts(input,{map,geometrySha256}){
  if(input?.version!==CUT_SCHEMA||input.map!==map||input.geometrySha256!==geometrySha256)throw Error('剖切配置与当前地图版本不一致');
  if(!Array.isArray(input.presets)||input.presets.length<1||input.presets.length>24||!Array.isArray(input.regions)||input.regions.length>MAX_CUT_REGIONS)throw Error('剖切配置数量无效');
  const ids=new Set(),regionIds=new Set();
  const presets=input.presets.map(p=>{if(!/^[a-z0-9_-]{1,40}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40)throw Error('楼层名称无效');ids.add(p.id);return {id:p.id,name:p.name.trim()};});
  const regions=input.regions.map(r=>{
    if(typeof r.id!=='string'||!r.id||r.id.length>120||regionIds.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100)throw Error('建筑名称无效');regionIds.add(r.id);
    if(!['minX','maxX','minZ','maxZ'].every(k=>finite(r[k])&&Math.abs(r[k])<=100000)||r.maxX-r.minX<.1||r.maxZ-r.minZ<.1)throw Error('建筑框选范围无效');
    const cuts={};for(const [key,height] of Object.entries(r.cuts||{})){if(!ids.has(key)||!finite(height)||Math.abs(height)>100000)throw Error('建筑剖切高度无效');cuts[key]=height;}
    return {id:r.id,name:r.name.trim(),minX:r.minX,maxX:r.maxX,minZ:r.minZ,maxZ:r.maxZ,cuts,edited:r.edited===true,...(r.source?{source:r.source}:{})};
  });
  return {version:CUT_SCHEMA,map,geometrySha256,presets,regions,...(input.source?{source:input.source}:{})};
}
export function createCutPlan(profile,preset){
  const regions=profile.regions.filter(r=>finite(r.cuts[preset])).map(r=>({...r,high:r.cuts[preset]})).sort((a,b)=>Number(Boolean(b.edited))-Number(Boolean(a.edited))||rectArea(a)-rectArea(b)||a.id.localeCompare(b.id));
  const bounds=regions.length?{minX:Math.min(...regions.map(r=>r.minX)),maxX:Math.max(...regions.map(r=>r.maxX)),minZ:Math.min(...regions.map(r=>r.minZ)),maxZ:Math.max(...regions.map(r=>r.maxZ))}:{minX:0,maxX:1,minZ:0,maxZ:1};
  const cells=Array.from({length:CUT_GRID**2},()=>[]);
  const cell=(x,min,max)=>Math.min(CUT_GRID-1,Math.max(0,Math.floor((x-min)/(max-min)*CUT_GRID)));
  regions.forEach((r,index)=>{for(let z=cell(r.minZ,bounds.minZ,bounds.maxZ);z<=cell(r.maxZ,bounds.minZ,bounds.maxZ);z++)for(let x=cell(r.minX,bounds.minX,bounds.maxX);x<=cell(r.maxX,bounds.minX,bounds.maxX);x++)cells[z*CUT_GRID+x].push(index);});
  if(cells.some(c=>c.length>MAX_CELL_CUTS))throw Error('此处重叠剖切范围过多，请拆分或移除重复范围');
  function at(position){if(!position||!regions.length||!inCutRect(position,bounds))return null;return cells[cell(position.z,bounds.minZ,bounds.maxZ)*CUT_GRID+cell(position.x,bounds.minX,bounds.maxX)].map(i=>regions[i]).find(r=>inCutRect(position,r))||null;}
  return {regions,bounds,cells,at,highAt:(p,fallback)=>at(p)?.high??fallback};
}
export function presetForCutPoint(profile,position,preferred=null){
  if(!profile||!position)return null;
  const candidates=profile.presets.map(p=>({id:p.id,region:createCutPlan(profile,p.id).at(position)})).filter(p=>p.region&&p.region.high>position.y+.1);
  if(candidates.some(p=>p.id===preferred))return preferred;
  return candidates.sort((a,b)=>a.region.high-b.region.high)[0]?.id??null;
}

// Clip a convex volume into disjoint rectangular columns in the same priority
// order used by the GPU. A trigger crossing two buildings must not disappear
// merely because its center happens to be above the lower building's cut.
function planeClip(faces,axis,value,above){
  const out=[],cap=[],eps=1e-7,seen=new Set();
  for(const face of faces){const poly=[];for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length],ain=above?a[axis]>=value-eps:a[axis]<=value+eps,bin=above?b[axis]>=value-eps:b[axis]<=value+eps;
    if(ain)poly.push(a);if(ain!==bin){const t=(value-a[axis])/(b[axis]-a[axis]),p=a.map((v,j)=>v+(b[j]-v)*t);poly.push(p);const key=p.map(v=>v.toFixed(6)).join();if(!seen.has(key)){seen.add(key);cap.push(p);}}
  }if(poly.length>=3)out.push(poly);}
  if(cap.length>=3){const axes=[0,1,2].filter(a=>a!==axis),center=axes.map(a=>cap.reduce((s,p)=>s+p[a],0)/cap.length);cap.sort((a,b)=>Math.atan2(a[axes[1]]-center[1],a[axes[0]]-center[0])-Math.atan2(b[axes[1]]-center[1],b[axes[0]]-center[0]));out.push(cap);}
  return out;
}
const boundsOf=faces=>{const v=faces.flat();return v.length?{minX:Math.min(...v.map(p=>p[0])),maxX:Math.max(...v.map(p=>p[0])),minZ:Math.min(...v.map(p=>p[2])),maxZ:Math.max(...v.map(p=>p[2]))}:null;};
const overlaps=(a,b)=>a&&a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
const hasVolume=faces=>{const points=faces.flat();return points.length>3&&[0,1,2].every(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))>1e-6);};
export function cutVolumeFaces(faces,plan){
  if(!plan?.regions.length)return [faces];
  let remainder=[faces];const result=[],bounds=boundsOf(faces);
  for(const region of plan.regions){if(!overlaps(bounds,region))continue;const next=[];
    for(const fragment of remainder){if(!overlaps(boundsOf(fragment),region)){next.push(fragment);continue;}
      let inside=fragment;
      for(const [axis,value,above] of [[0,region.minX,true],[0,region.maxX,false],[2,region.minZ,true],[2,region.maxZ,false]]){
        const outside=planeClip(inside,axis,value,!above);if(hasVolume(outside))next.push(outside);inside=planeClip(inside,axis,value,above);if(!inside.length)break;
      }
      const visible=planeClip(inside,1,region.high,false);if(hasVolume(visible))result.push(visible);
    }remainder=next;
  }
  return [...result,...remainder].filter(hasVolume);
}
export function facesEdges(faces){const seen=new Set(),edges=[];for(const face of faces)for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],key=[a.map(v=>v.toFixed(5)).join(),b.map(v=>v.toFixed(5)).join()].sort().join('|');if(!seen.has(key)){seen.add(key);edges.push([a,b]);}}return edges;}
