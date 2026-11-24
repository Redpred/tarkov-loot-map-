import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Matrix4,Quaternion,Vector3} from 'three';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {validateVolume,volumeBounds,clippedVolume} from '../site/atlas-volumes.js';

const root=path.resolve(import.meta.dirname,'..'),arg=process.argv.indexOf('--directory');
const directory=path.resolve(root,arg<0?'site':process.argv[arg+1]);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=value=>hash(JSON.stringify(value));
const evidenceCache=new Map();
const evidence=source=>{
  if(!evidenceCache.has(source.evidence)){
    const bytes=fs.readFileSync(path.join(root,source.evidence));assert.equal(hash(bytes),source.evidenceSha256);
    evidenceCache.set(source.evidence,read(path.join(root,source.evidence)));
  }
  return evidenceCache.get(source.evidence).flatMap(r=>r.volumes||[]).find(v=>v.source.componentId===source.componentId&&v.source.colliderId===source.colliderId);
};
let pointCount=0,buildingCount=0,cornerCount=0,maxDifference=0,negativeSizes=0;
const results=[];
for(const map of Object.values(ATLAS_MAPS)){
  const result={mapId:map.id,points:0,buildings:0};
  for(const [basePath,volumePath] of [[`site/data/${map.id}-pois.json`,`data/volumes/${map.id}.json`],[`site/data/tasks/maps/${map.id}.json`,`data/tasks/volumes/${map.id}.json`]]){
    const base=read(path.join(root,basePath)),sidecar=read(path.join(directory,volumePath));
    assert.equal(sidecar.mapId,map.id);assert.equal(sidecar.eftBuild,base.sources.spt.eftBuild);assert.equal(sidecar.baseSha256,canonical(base));
    const byId=new Map(base.points.map(p=>[p.id,p]));
    assert.equal(base.points.filter(p=>p.outline?.length>=3&&!sidecar.points[p.id]).length,0,`${map.id}: original area without volume`);
    for(const [id,volumes] of Object.entries(sidecar.points)){
      assert(byId.has(id));assert(volumes.length>0);
      for(const volume of volumes){
        assert(validateVolume(volume));const raw=evidence(volume.source);assert(raw);assert.deepEqual(volume.corners,raw.corners);
        // Independent Three.js TRS composition from original local engine values
        // checks the numpy transform code, not just copied world matrices.
        const mat=new Matrix4();
        for(const local of raw.source.transformChain){
          const composed=new Matrix4().compose(new Vector3(...local.position),new Quaternion(...local.rotation),new Vector3(...local.scale));
          mat.multiply(composed);
        }
        const signs=[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]];
        if(raw.source.localSize.some(s=>s<0))negativeSizes++;
        for(let i=0;i<8;i++){
          const p=new Vector3(...raw.source.localCenter.map((c,k)=>c+signs[i][k]*raw.source.localSize[k]/2)).applyMatrix4(mat).toArray();
          const error=Math.max(...p.map((v,k)=>Math.abs(v-volume.corners[i][k])));maxDifference=Math.max(maxDifference,error);assert(error<1e-7,`${id}: coordinate mismatch ${error}`);cornerCount++;
        }
        const bounds=volumeBounds(volume);
        for(const ratio of [.1,.5,.9]){
          const high=bounds.minY+(bounds.maxY-bounds.minY)*ratio;
          const clipped=clippedVolume(volume,bounds.minY-1,high);assert(clipped.faces.length);
          assert(clipped.faces.flat().every(p=>p.every(Number.isFinite)&&p[1]<=high+1e-7));
        }
      }
      pointCount++;result.points++;
    }
    if(Object.keys(sidecar.regions||{}).length){
      const regions=read(path.join(root,`site/data/${map.id}-regions.json`)),geometry=read(path.join(root,'site',map.geometry));
      assert.equal(sidecar.regionBaseSha256,canonical(regions));assert.equal(sidecar.regionGeometrySha256,geometry.sourceGeometrySha256||geometry.sha256);
      for(const [id,volumes] of Object.entries(sidecar.regions)){
        assert(regions.labels.some(r=>r.id===id));assert(volumes.every(validateVolume));buildingCount++;result.buildings++;
      }
    }
  }
  results.push(result);
}
const report={pointCount,buildingCount,cornerCount,maxDifference,negativeSizes,results};
console.log(JSON.stringify(report));
const reportArg=process.argv.indexOf('--report');if(reportArg>=0)fs.writeFileSync(path.resolve(root,process.argv[reportArg+1]),JSON.stringify(report,null,2));
