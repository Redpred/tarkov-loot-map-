import {createHash} from 'node:crypto';
import {MeshoptSimplifier} from 'meshoptimizer';

export const GEOMETRY_RECIPE=1;
export const GEOMETRY_TIERS={medium:{ratio:.6,errorMeters:.025},low:{ratio:.3,errorMeters:.075}};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const manifestDigest=value=>digest(JSON.stringify(value));
export const bytesOf=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
export function views(m,buffer){
  return {positions:new Float32Array(buffer,m.positionOffset,m.vertices*3),uvs:new Float32Array(buffer,m.uvOffset,m.vertices*2),
    paint:m.paintOffset==null?null:new Uint8Array(buffer,m.paintOffset,m.vertices*4),
    indices:m.indexComponentType==='uint16'?new Uint16Array(buffer,m.indexOffset,m.indices):new Uint32Array(buffer,m.indexOffset,m.indices),
    matrices:new Float32Array(buffer,m.matrixOffset,m.instances*12),boxes:new Float32Array(buffer,m.boundsOffset,m.instances*6)};
}
export function matrixScale(matrices){
  // sqrt(||A||1 * ||A||infinity) bounds stretch even with shear and reflection.
  let largest=0;
  for(let i=0;i<matrices.length;i+=12){let rows=0,cols=0;for(let a=0;a<3;a++){
    let row=0,col=0;for(let b=0;b<3;b++){row+=Math.abs(matrices[i+a*4+b]);col+=Math.abs(matrices[i+b*4+a]);}
    rows=Math.max(rows,row);cols=Math.max(cols,col);
  }largest=Math.max(largest,Math.sqrt(rows*cols));}
  return Math.max(largest,1e-8);
}
function compact(data,indices,paint){
  indices=Uint32Array.from(indices);
  const [remap,count]=MeshoptSimplifier.compactMesh(indices);
  const positions=new Float32Array(count*3),uvs=new Float32Array(count*2),colors=paint?new Uint8Array(count*4):null;
  for(let old=0;old<remap.length;old++)if(remap[old]!==0xffffffff){const id=remap[old];positions.set(data.positions.subarray(old*3,old*3+3),id*3);uvs.set(data.uvs.subarray(old*2,old*2+2),id*2);if(colors)colors.set(data.paint.subarray(old*4,old*4+4),id*4);}
  return {positions,uvs,paint:colors,indices:count<=65535?Uint16Array.from(indices):indices};
}
function weld(data,paint){
  const vertices=data.positions.length/3,remap=new Uint32Array(vertices),seen=new Map(),ids=[];
  const p=new Uint32Array(data.positions.buffer,data.positions.byteOffset,data.positions.length),uv=new Uint32Array(data.uvs.buffer,data.uvs.byteOffset,data.uvs.length);
  for(let i=0;i<vertices;i++){
    const color=paint?`:${data.paint[i*4]},${data.paint[i*4+1]},${data.paint[i*4+2]},${data.paint[i*4+3]}`:'';
    const key=`${p[i*3]},${p[i*3+1]},${p[i*3+2]}:${uv[i*2]},${uv[i*2+1]}${color}`;
    let id=seen.get(key);if(id===undefined){id=ids.length;seen.set(key,id);ids.push(i);}remap[i]=id;
  }
  const positions=new Float32Array(ids.length*3),uvs=new Float32Array(ids.length*2),colors=paint?new Uint8Array(ids.length*4):null;
  ids.forEach((old,id)=>{positions.set(data.positions.subarray(old*3,old*3+3),id*3);uvs.set(data.uvs.subarray(old*2,old*2+2),id*2);if(colors)colors.set(data.paint.subarray(old*4,old*4+4),id*4);});
  return {positions,uvs,paint:colors,indices:Uint32Array.from(data.indices,id=>remap[id])};
}
export function createMeshSimplifier({cacheBytes=256*2**20}={}){
  const cache=new Map();let size=0,hits=0,misses=0;
  return {get metrics(){return {hits,misses,cacheBytes:size};},async simplify(data,material,quality){
    await MeshoptSimplifier.ready;
    const tier=GEOMETRY_TIERS[quality];if(!tier)throw Error('Unknown geometry tier');
    const paint=Boolean(material.vp),protectedMesh=['decal','cutout'].includes(material.role)||data.indices.length<72;
    const scale=matrixScale(data.matrices),error=tier.errorMeters/scale;
    const hash=createHash('sha256');for(const a of [data.positions,data.uvs,data.indices,...(paint?[data.paint]:[])])hash.update(bytesOf(a));
    hash.update(`${quality}:${paint}:${protectedMesh}:${error}`);const key=hash.digest('hex');
    if(cache.has(key)){hits++;const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
    misses++;let result;
    if(protectedMesh)result={...compact(data,data.indices,paint),errorWorld:0,protected:true};
    else{
      const welded=weld(data,paint),stride=paint?6:2,attributes=new Float32Array(welded.positions.length/3*stride);
      for(let i=0;i<welded.positions.length/3;i++){attributes.set(welded.uvs.subarray(i*2,i*2+2),i*stride);if(paint)for(let k=0;k<4;k++)attributes[i*stride+2+k]=welded.paint[i*4+k]/255;}
      const target=Math.max(12,Math.floor(welded.indices.length*tier.ratio/3)*3);
      const [indices,achieved]=MeshoptSimplifier.simplifyWithAttributes(welded.indices,welded.positions,3,attributes,stride,Array(stride).fill(1),null,target,error,['LockBorder','ErrorAbsolute']);
      if(!indices.length||indices.length%3||!Number.isFinite(achieved)||achieved>error*1.001)throw Error('Invalid simplification result');
      result={...compact(welded,indices,paint),errorWorld:achieved*scale,protected:false};
    }
    const bytes=result.positions.byteLength+result.uvs.byteLength+(result.paint?.byteLength||0)+result.indices.byteLength;
    while(cache.size&&size+bytes>cacheBytes){const [old,value]=cache.entries().next().value;cache.delete(old);size-=value.byteSize;}
    result.byteSize=bytes;if(bytes<=cacheBytes){cache.set(key,result);size+=bytes;}return result;
  }};
}
export async function simplifyGeometry(manifest,buffer,materials,quality,simplifier=createMeshSimplifier()){
  const parts=[],meshes=[];let offset=0,triangles=0,instancedTriangles=0,vertices=0,changedMeshes=0,protectedMeshes=0,maxErrorMeters=0;
  function append(array){const padding=(4-offset%4)%4;if(padding){parts.push(Buffer.alloc(padding));offset+=padding;}const start=offset,bytes=bytesOf(array);parts.push(bytes);offset+=bytes.length;return start;}
  for(const source of manifest.meshes){
    const data=views(source,buffer),out=await simplifier.simplify(data,materials[source.material],quality);
    const mesh={...source,vertices:out.positions.length/3,indices:out.indices.length,indexComponentType:out.indices instanceof Uint16Array?'uint16':'uint32',
      positionOffset:append(out.positions),uvOffset:append(out.uvs),paintOffset:out.paint?append(out.paint):null,indexOffset:append(out.indices),matrixOffset:append(data.matrices),boundsOffset:append(data.boxes),
      simplification:{sourceVertices:source.vertices,sourceIndices:source.indices,errorMeters:out.errorWorld,protected:out.protected}};
    meshes.push(mesh);vertices+=mesh.vertices;triangles+=mesh.indices/3;instancedTriangles+=mesh.indices/3*mesh.instances;
    if(mesh.indices<source.indices)changedMeshes++;if(out.protected)protectedMeshes++;maxErrorMeters=Math.max(maxErrorMeters,out.errorWorld);
  }
  const bytes=Buffer.concat(parts),stats={...manifest.stats,bytes:bytes.length,meshGroups:meshes.length,vertices,triangles,instancedTriangles};
  return {bytes,manifest:{...manifest,sha256:digest(bytes),meshes,stats},summary:{vertices,triangles,instancedTriangles,changedMeshes,protectedMeshes,maxErrorMeters,bytes:bytes.length}};
}
