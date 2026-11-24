export const performancePresets={
  light:{renderScale:.65,maxFps:30,markerHz:10,maxMarkers:500,showClusterCounts:false,showDecals:false,anisotropy:1,sectorBudget:512,distance:175,drawDistance:100,markerDistance:45,retain:true,mode:'view'},
  balanced:{renderScale:1,maxFps:60,markerHz:20,maxMarkers:1500,showClusterCounts:true,showDecals:true,anisotropy:2,sectorBudget:1024,distance:300,drawDistance:100,markerDistance:60,retain:true,mode:'view'},
  quality:{renderScale:1,maxFps:120,markerHz:30,maxMarkers:4000,showClusterCounts:true,showDecals:true,anisotropy:4,sectorBudget:2048,distance:500,drawDistance:100,markerDistance:100,retain:true,mode:'view'},
};
export function renderPixelRatio(deviceRatio,scale){return Math.max(.25,Math.min(deviceRatio||1,2)*scale);}

// Geometry bytes, not an estimate of total browser/GPU memory. Keep at least
// the closest sector, and preserve nearby coverage in first-person flight.
export function budgetSectors(sectors,budgetMiB,required=()=>false){
  if(!budgetMiB)return sectors;
  const budget=budgetMiB*2**20,keep=new Set(sectors.filter(required).map(s=>s.id));
  let used=sectors.filter(s=>keep.has(s.id)).reduce((n,s)=>n+(s.stats?.bytes||0),0);
  for(const s of sectors){if(keep.has(s.id))continue;const bytes=s.stats?.bytes||0;if(!keep.size||used+bytes<=budget){keep.add(s.id);used+=bytes;}}
  return sectors.filter(s=>keep.has(s.id));
}

export function limitMarkers(clusters,max,width,height,selectedId){
  if(!max||clusters.length<=max)return clusters;
  // Closest to the screen centre first; keep the selected point if present.
  return [...clusters].sort((a,b)=>Number(b.point.id===selectedId)-Number(a.point.id===selectedId)||Math.hypot(a.x-width/2,a.y-height/2)-Math.hypot(b.x-width/2,b.y-height/2)).slice(0,max);
}
