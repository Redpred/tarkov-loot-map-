import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export const SCENERY_RECIPE=1;
// Explicit prop families only. Generic meshes, furniture, plants, signs and
// structural debris stay visible. Bounds are the union of ALL material parts.
const protectedName=/wall|floor|roof|ceiling|stair|ladder|door|window|rail|fence|barrier|container|scontainer|quest|task|loot|interact|switch|extract|trigger|pallet|shelf|rack|terrain|ground|bridge|roadblock|cover|support/i;
const families=[
  {id:'paper',label:'散落废纸',pattern:/^paper(?:\d+|_\d+)(?:_lod\d+)?$/i,max:4,height:.3,volume:3},
  {id:'bottles',label:'小型酒瓶装饰',pattern:/^(?:Bottle_Baltika_\d+|(?:Wine|Champagne)_Bottle_(?:Broken_)?\d+)(?:_lod\d+)?$/i,max:.65,height:.65,volume:.12},
  // Concrete/glass debris can contain tiled slabs or frame-like parts (visual
  // review, 2026-10-26). Keep those families and larger plaster/rubble pieces.
  {id:'fragments',label:'小型碎砖与碎屑',pattern:/^(?:Brick_broken_(?:set_)?\d+|Bricks_Rubble|plaster_debris_(?:group_)?\d+)(?:_lod\d+)?$/i,max:1.6,height:.45,volume:.4},
  {id:'flat-litter',label:'薄层散落垃圾组合',pattern:/^(?:(?:Reserve_)?Road_Garbage_[a-z]+|Garbage_Parking_\d+)(?:_lod\d+)?$/i,max:18,height:.3,volume:60},
  {id:'litter',label:'低矮零散垃圾',pattern:/^(?:Garbage_set_\d+|heap_garbage_\d+|goshan_garbage_?\d+|garbage_mix\d+_set|Package_garbage_set_\d+)(?:_lod\d+)?$/i,max:3,height:.45,volume:3},
];
export function decorationFamily(name){
  const stem=String(name).split('__')[0];
  if(protectedName.test(stem))return null;
  return families.find(rule=>rule.pattern.test(stem))||null;
}
export const protectedDecorationName=name=>protectedName.test(String(name));
export function smallDecoration(rule,box){
  if(!rule||box.length!==6||!box.every(Number.isFinite))return false;
  const size=box.slice(3).map((v,i)=>v-box[i]);
  return size.every(v=>v>=0)&&Math.max(...size)<=rule.max&&size[1]<=rule.height&&size.reduce((a,b)=>a*b,1)<=rule.volume;
}
export function instanceKey(name,matrix){return name+':'+Buffer.from(matrix.buffer,matrix.byteOffset,matrix.byteLength).toString('base64');}
export function mergeBounds(a,b){if(!a)return Array.from(b);for(let k=0;k<3;k++){a[k]=Math.min(a[k],b[k]);a[k+3]=Math.max(a[k+3],b[k+3]);}return a;}

export function meshExtent(m){
  const ranges=[[m.positionOffset,m.vertices*12],[m.uvOffset,m.vertices*8],...(m.paintOffset==null?[]:[[m.paintOffset,m.vertices*4]]),[m.indexOffset,m.indices*(m.indexComponentType==='uint16'?2:4)],[m.matrixOffset,m.instances*48],[m.boundsOffset,m.instances*24]];
  let end=m.positionOffset;
  for(const [offset,length] of ranges){if(!Number.isSafeInteger(offset)||offset<end||!Number.isSafeInteger(length)||length<=0)throw Error('Unsupported mesh layout');end=offset+length;}
  if(m.positionOffset%4||end%4)throw Error('Unaligned mesh layout');
  return [m.positionOffset,end];
}
export function filterGeometry(manifest,raw,removed){
  const parts=[],spans=[],meshes=[],omitted=[];let offset=0,last=0;
  for(let i=0;i<manifest.meshes.length;i++){
    const m=manifest.meshes[i],[start,end]=meshExtent(m);
    if(start<last||end>raw.length)throw Error('Overlapping or truncated mesh data');last=end;
    if(removed.has(m.name)){omitted.push(i);continue;}
    const copy={...m};
    for(const field of ['positionOffset','uvOffset','paintOffset','indexOffset','matrixOffset','boundsOffset'])if(copy[field]!=null)copy[field]+=offset-start;
    meshes.push(copy);parts.push(raw.subarray(start,end));
    const previous=spans.at(-1);
    if(previous&&previous[1]+previous[2]===start)previous[2]+=end-start;else spans.push([offset,start,end-start]);
    offset+=end-start;
  }
  // No changes: preserve the exact original bytes/cache key, including padding.
  const bytes=omitted.length?Buffer.concat(parts):raw;
  const selected=omitted.length?meshes:manifest.meshes;
  const stats={...manifest.stats,bytes:bytes.length,meshGroups:selected.length,exportedInstances:selected.reduce((n,m)=>n+m.instances,0),vertices:selected.reduce((n,m)=>n+m.vertices,0),triangles:selected.reduce((n,m)=>n+m.indices/3,0),instancedTriangles:selected.reduce((n,m)=>n+m.indices/3*m.instances,0)};
  return {bytes,omitted,spans:omitted.length?spans:[[0,0,raw.length]],manifest:{...manifest,meshes:selected,materialIds:[...new Set(selected.map(m=>m.material))].sort((a,b)=>a-b),sha256:digest(bytes),stats}};
}

// The extensionless endpoint reads only retained ranges from the existing
// immutable source binary. No second multi-gigabyte model set is necessary.
export function validateSpans(spans,total,sourceBytes){
  let cursor=0,previousSourceEnd=0;
  if(!Array.isArray(spans)||!Number.isSafeInteger(total)||total<1||!Number.isSafeInteger(sourceBytes)||sourceBytes<total)throw Error('Invalid filtered geometry');
  for(const span of spans){
    if(!Array.isArray(span)||span.length!==3||!span.every(Number.isSafeInteger))throw Error('Invalid retained range');
    const [out,source,length]=span;
    if(out!==cursor||source<previousSourceEnd||length<1||source+length>sourceBytes)throw Error('Invalid retained range');
    cursor+=length;previousSourceEnd=source+length;
  }
  if(cursor!==total)throw Error('Incomplete retained ranges');
}
export async function readFilteredRange(handle,spans,offset,length,total){
  const output=Buffer.allocUnsafe(Math.min(length,total-offset)),end=offset+output.length;
  for(const [out,source,size] of spans){
    if(out+size<=offset)continue;if(out>=end)break;
    const start=Math.max(out,offset),stop=Math.min(out+size,end);let done=0;
    while(done<stop-start){const {bytesRead}=await handle.read(output,start-offset+done,stop-start-done,source+start-out+done);if(!bytesRead)throw Error('Incomplete source read');done+=bytesRead;}
  }
  return output;
}
