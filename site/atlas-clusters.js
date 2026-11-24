// A screen-space grouping only: source coordinates, candidate pools and counts
// are retained. Zooming expands groups back into their individual records.
export function clusterScreenPoints(projected,cellSize){
  const cells=new Map();
  for(const entry of projected){
    const key=`${Math.floor(entry.x/cellSize)}:${Math.floor(entry.y/cellSize)}`;
    if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);
  }
  return [...cells.values()].map(entries=>{
    const x=entries.reduce((s,p)=>s+p.x,0)/entries.length,y=entries.reduce((s,p)=>s+p.y,0)/entries.length;
    const nearest=entries.reduce((a,b)=>Math.hypot(a.x-x,a.y-y)<Math.hypot(b.x-x,b.y-y)?a:b);
    return {point:nearest.point,x:nearest.x,y:nearest.y,members:entries.map(e=>e.point)};
  });
}
