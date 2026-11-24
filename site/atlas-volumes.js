import {volumeContains,volumeCenter} from './atlas-region-bounds.js';
// All coordinates remain in Unity XYZ. The containing gameWorld flips Z once.
const EPS=1e-7;
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const same=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<EPS);
const unique=points=>points.filter((p,i)=>!points.slice(0,i).some(q=>same(p,q)));
const clean=points=>points.filter((p,i)=>!same(p,points[(i+1)%points.length]));
const cached=new WeakMap();

export function validateVolume(value){
  if(!value||typeof value!=='object')return null;
  if(cached.has(value))return cached.get(value);
  let volume=null;
  if(value.type==='box'&&Array.isArray(value.corners)&&value.corners.length===8&&value.corners.every(finitePoint)){
    const p=value.corners,u=subtract(p[1],p[0]),v=subtract(p[3],p[0]),w=subtract(p[4],p[0]);
    const scale=Math.max(...u.map(Math.abs),...v.map(Math.abs),...w.map(Math.abs),1),tolerance=scale*1e-5;
    const positions=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    // Reject malformed corner order and collapsed transforms, preserve shear.
    if(Math.abs(dot(cross(u,v),w))>EPS&&positions.every(([a,b,c],i)=>p[i].every((n,k)=>Math.abs(n-p[0][k]-u[k]*a-v[k]*b-w[k]*c)<=tolerance)))volume=value;
  }else if(value.type==='sphere'&&finitePoint(value.center)&&Number.isFinite(value.radius)&&value.radius>EPS){volume=value;
  }else if(Array.isArray(value.polygon)&&value.polygon.length>=3&&value.polygon.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z))&&Number.isFinite(value.minY)&&Number.isFinite(value.maxY)&&value.maxY>value.minY){
    const area=value.polygon.reduce((sum,p,i)=>{const q=value.polygon[(i+1)%value.polygon.length];return sum+p.x*q.z-q.x*p.z;},0);
    if(Math.abs(area)>EPS)volume=value;
  }
  cached.set(value,volume);return volume;
}

export function volumesFor(entry){
  const values=Array.isArray(entry?.volumes)?entry.volumes:entry?.volume?[entry.volume]:[];
  return values.map(validateVolume).filter(Boolean);
}

export function volumeBounds(value){
  const volume=validateVolume(value);if(!volume)return null;
  if(volume.type==='sphere')return {minY:volume.center[1]-volume.radius,maxY:volume.center[1]+volume.radius};
  if(volume.type==='box')return {minY:Math.min(...volume.corners.map(p=>p[1])),maxY:Math.max(...volume.corners.map(p=>p[1]))};
  return {minY:volume.minY,maxY:volume.maxY};
}

export function volumeIntersectsHeight(volume,low=-Infinity,high=Infinity){
  const bounds=volumeBounds(volume);return Boolean(bounds&&high>low&&bounds.minY<high&&bounds.maxY>low);
}

export function pointIntersectsHeight(point,low=-Infinity,high=Infinity){
  const volumes=volumesFor(point);
  return volumes.length?volumes.some(volume=>volumeIntersectsHeight(volume,low,high)):Boolean(point.position&&point.position.y>=low&&point.position.y<high);
}

export function volumeContainsPosition(value,position){
  const volume=validateVolume(value);if(!volume||![position?.x,position?.y,position?.z].every(Number.isFinite))return false;
  if(volume.type==='sphere')return Math.hypot(position.x-volume.center[0],position.y-volume.center[1],position.z-volume.center[2])<=volume.radius;
  if(volume.type!=='box')return volumeContains(volume,position);
  const p=volume.corners,u=subtract(p[1],p[0]),v=subtract(p[3],p[0]),w=subtract(p[4],p[0]),d=subtract([position.x,position.y,position.z],p[0]),det=dot(u,cross(v,w));
  return [dot(d,cross(v,w))/det,dot(u,cross(d,w))/det,dot(u,cross(v,d))/det].every(t=>t>=-EPS&&t<=1+EPS);
}

export function volumeCenterPosition(value){
  const volume=validateVolume(value);if(!volume)return null;
  if(volume.type==='sphere')return {x:volume.center[0],y:volume.center[1],z:volume.center[2]};
  if(volume.type!=='box')return volumeCenter(volume);
  return {x:volume.corners.reduce((sum,p)=>sum+p[0],0)/8,y:volume.corners.reduce((sum,p)=>sum+p[1],0)/8,z:volume.corners.reduce((sum,p)=>sum+p[2],0)/8};
}

export function volumeDisplayPosition(entry,low=-Infinity,high=Infinity){
  const original=entry.position;
  if(!original||original.y>=low&&original.y<=high)return original;
  const candidates=volumesFor(entry).filter(v=>volumeIntersectsHeight(v,low,high)).map(volume=>{
    const bounds=volumeBounds(volume),y=Math.max(bounds.minY,low,Math.min(bounds.maxY,high,original.y));
    if(volume.type==='sphere')return {x:volume.center[0],y,z:volume.center[2]};
    if(volume.type!=='box')return {...original,y};
    // The horizontal cut centroid stays inside even a tilted/sheared box.
    const vertices=unique(clippedVolume(volume,low,high).faces.flat().filter(p=>Math.abs(p[1]-y)<EPS));
    if(!vertices.length)return {...volumeCenterPosition(volume),y};
    return {x:vertices.reduce((sum,p)=>sum+p[0],0)/vertices.length,y,z:vertices.reduce((sum,p)=>sum+p[2],0)/vertices.length};
  });
  candidates.sort((a,b)=>Math.hypot(a.x-original.x,a.y-original.y,a.z-original.z)-Math.hypot(b.x-original.x,b.y-original.y,b.z-original.z));
  return candidates[0]||original;
}

function clipFaces(faces,height,keepAbove){
  if(!Number.isFinite(height))return faces;
  const clipped=[],intersections=[];
  const inside=p=>keepAbove?p[1]>=height:p[1]<=height;
  for(const face of faces){
    const polygon=[];
    for(let i=0;i<face.length;i++){
      const a=face[i],b=face[(i+1)%face.length],aIn=inside(a),bIn=inside(b);
      if(aIn)polygon.push(a);
      if(aIn!==bIn){const t=(height-a[1])/(b[1]-a[1]),point=[a[0]+(b[0]-a[0])*t,height,a[2]+(b[2]-a[2])*t];polygon.push(point);intersections.push(point);}
    }
    const result=clean(polygon);if(result.length>=3)clipped.push(result);
  }
  const cap=unique(intersections);
  if(cap.length>=3){
    const x=cap.reduce((sum,p)=>sum+p[0],0)/cap.length,z=cap.reduce((sum,p)=>sum+p[2],0)/cap.length;
    cap.sort((a,b)=>Math.atan2(a[2]-z,a[0]-x)-Math.atan2(b[2]-z,b[0]-x));clipped.push(cap);
  }
  return clipped;
}

function faceEdges(faces){
  const edges=new Map(),key=p=>p.map(v=>Math.round(v/EPS)).join(',');
  for(const face of faces)for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length],aKey=key(a),bKey=key(b);
    if(aKey!==bKey)edges.set([aKey,bKey].sort().join('|'),[a,b]);
  }
  return [...edges.values()];
}

function sphereGeometry(volume,low,high){
  const [cx,cy,cz]=volume.center,r=volume.radius,bottom=Math.max(cy-r,low),top=Math.min(cy+r,high),segments=32;
  const levels=[bottom,top];
  for(let i=1;i<16;i++){const y=cy-r*Math.cos(i*Math.PI/16);if(y>bottom+EPS&&y<top-EPS)levels.push(y);}
  levels.sort((a,b)=>a-b);
  const rings=levels.map(y=>{
    const radius=Math.sqrt(Math.max(0,r*r-(y-cy)**2));
    return Array.from({length:segments},(_,i)=>[cx+radius*Math.cos(i*2*Math.PI/segments),y,cz+radius*Math.sin(i*2*Math.PI/segments)]);
  });
  const faces=[];
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){
    const next=(i+1)%segments,face=clean([rings[j][i],rings[j][next],rings[j+1][next],rings[j+1][i]]);
    if(face.length>=3)faces.push(face);
  }
  if(bottom>cy-r+EPS)faces.push(rings[0]);if(top<cy+r-EPS)faces.push(rings.at(-1));
  const edges=[];
  // Boundary rings and four meridians keep the actual sphere readable without
  // drawing the tessellation triangles as a dense wire mesh.
  for(let j=0;j<rings.length;j++)if(j===0||j===rings.length-1||Math.abs(levels[j]-cy)<EPS)for(let i=0;i<segments;i++)if(!same(rings[j][i],rings[j][(i+1)%segments]))edges.push([rings[j][i],rings[j][(i+1)%segments]]);
  for(let j=0;j<rings.length-1;j++)for(const i of [0,8,16,24])edges.push([rings[j][i],rings[j+1][i]]);
  return {faces,edges};
}

// Faces include real horizontal cut caps; rendering never moves a box corner
// independently to the height plane (which would distort tilted volumes).
export function clippedVolume(value,low=-Infinity,high=Infinity){
  const volume=validateVolume(value);if(!volumeIntersectsHeight(volume,low,high))return {faces:[],edges:[]};
  if(volume.type==='sphere')return sphereGeometry(volume,low,high);
  let faces;
  if(volume.type==='box'){
    const p=volume.corners;
    faces=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]].map(indices=>indices.map(i=>p[i]));
    faces=clipFaces(clipFaces(faces,low,true),high,false);
  }else{
    const bottom=Math.max(volume.minY,low),top=Math.min(volume.maxY,high);
    const a=volume.polygon.map(p=>[p.x,bottom,p.z]),b=volume.polygon.map(p=>[p.x,top,p.z]);
    faces=[a,b];
    for(let i=0;i<a.length;i++){const next=(i+1)%a.length;faces.push([a[i],a[next],b[next],b[i]]);}
  }
  return {faces,edges:faceEdges(faces)};
}
