import fs from 'node:fs';
import path from 'node:path';
import {requestedMaps} from './lib/atlas-build-maps.mjs';
import {atlasToUnity} from './lib/factory-data.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const cell=.25,tolerance=.1;
for(const map of requestedMaps()){
  const data=read('site/'+map.data),client=read(`work/tarkmap/out/${map.atlas}/gamedata.json`);
  const grid=new Map(),index=p=>[p.x,p.y,p.z].map(v=>Math.floor(v/cell));
  for(const row of client.loose_points||[]){
    const p=atlasToUnity(row.pos);if(!p||row.active===false)continue;
    const key=index(p).join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(p);
  }
  const unresolved=[];let matched=0;
  for(const point of data.points.filter(p=>p.kind==='loose')){
    const p=point.position,[x,y,z]=index(p);let found=false;
    for(let dx=-1;dx<=1&&!found;dx++)for(let dy=-1;dy<=1&&!found;dy++)for(let dz=-1;dz<=1&&!found;dz++){
      found=(grid.get([x+dx,y+dy,z+dz].join(','))||[]).some(c=>Math.hypot(c.x-p.x,c.y-p.y,c.z-p.z)<=tolerance);
    }
    if(found)matched++;else unresolved.push({id:point.id,sourceId:point.sourceId,position:p,forced:point.forced,outsideClientEnvelope:point.outsideClientEnvelope});
  }
  const audit={map:map.id,generatedAt:new Date().toISOString(),source:data.sources.spt,client:data.sources.atlas.clientVersion,
    method:'Loose coordinates within 0.1 m in 3D of an active current-client loose point; a coordinate check only, not a loot-pool or probability check.',
    limitation:'The client ships only a small subset of loose points. Most positions are server-side and cannot be verified by this comparison; unmatched does not mean misplaced.',
    clientLoosePointCount:(client.loose_points||[]).filter(p=>p.active!==false).length,
    stats:{loose:data.stats.loose,nearCurrentClientPoint:matched,unmatchedLoose:unresolved.length,outsideClientEnvelope:data.coordinateAudit.outsideLoose,
      containers:data.stats.containers,exactContainerIdAndTemplate:data.stats.matchedContainers,unlocatedContainers:data.stats.unlocatedContainers,clientOnlyContainers:data.stats.clientOnlyContainers},unresolved};
  fs.writeFileSync(path.join(root,`data/atlas/${map.id}-alignment.json`),JSON.stringify(audit,null,2));
  console.log(map.id,JSON.stringify(audit.stats));
}
