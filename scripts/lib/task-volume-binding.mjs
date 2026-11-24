import crypto from 'node:crypto';

const canonical=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Reuse verified shapes only when every original point is unchanged. New point
// markers may be added, but a new outlined region needs its own volume evidence.
export function rebindTaskVolumes(sidecar,previous,next){
  if(sidecar.baseSha256!==canonical(previous))throw Error('Task volume base fingerprint mismatch');
  if(sidecar.mapId!==next.mapId&&next.mapId)throw Error('Task volume map mismatch');
  if(sidecar.eftBuild!==next.sources.spt.eftBuild)throw Error('Task volume client version mismatch');
  const nextPoints=new Map(next.points.map(p=>[p.id,p]));
  for(const p of previous.points){
    if(JSON.stringify(nextPoints.get(p.id))!==JSON.stringify(p))throw Error(`Task point changed; rebuild verified volumes: ${p.id}`);
  }
  for(const p of next.points)if(p.outline?.length>=3&&!sidecar.points[p.id])throw Error(`Missing verified task volume: ${p.id}`);
  return {...sidecar,baseSha256:canonical(next)};
}
