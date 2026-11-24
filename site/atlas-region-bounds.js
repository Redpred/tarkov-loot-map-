// All coordinates in this module are unmodified Unity X/Z and Y heights.
export function polygonArea(polygon){
  return Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.z-q.x*p.z;},0))/2;
}

export function pointInPolygon(point,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i],cross=(point.x-a.x)*(b.z-a.z)-(point.z-a.z)*(b.x-a.x);
    if(Math.abs(cross)<1e-7&&point.x>=Math.min(a.x,b.x)-1e-7&&point.x<=Math.max(a.x,b.x)+1e-7&&point.z>=Math.min(a.z,b.z)-1e-7&&point.z<=Math.max(a.z,b.z)+1e-7)return true;
    if((a.z>point.z)!==(b.z>point.z)&&point.x<(b.x-a.x)*(point.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}

export function volumeContains(volume,position){
  return position.y>=volume.minY&&position.y<volume.maxY&&pointInPolygon(position,volume.polygon);
}

export function volumeCenter(volume){
  const count=volume.polygon.length;
  return {x:volume.polygon.reduce((n,p)=>n+p.x,0)/count,y:(volume.minY+volume.maxY)/2,z:volume.polygon.reduce((n,p)=>n+p.z,0)/count};
}
