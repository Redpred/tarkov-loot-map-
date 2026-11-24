// Join same-build, typed collider evidence to existing point IDs. Never regenerate
// the loot/task catalogs or infer volume height from their projected outlines.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';

const root=path.resolve(import.meta.dirname,'..');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const evidence=arg('--evidence','work/region-volumes-20261019/extracted');
const output=path.resolve(root,arg('--out','work/region-names-20261019/staged-volumes'));
if(!output.startsWith(path.join(root,'work')+path.sep))throw Error('Generate an independent staging version under work/ first');
const read=file=>JSON.parse(fs.readFileSync(path.resolve(root,file),'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=file=>sha(fs.readFileSync(path.resolve(root,file)));
const canonicalHash=value=>sha(JSON.stringify(value));
const buildingsPath=arg('--buildings','work/region-names-20261019/buildings/building-volumes.json');
const buildings=read(buildingsPath),buildingsAudit=read(path.posix.join(path.posix.dirname(buildingsPath),'audit.json'));
if(buildings.schemaVersion!==1||buildings.coordinateSystem!=='unity-world-xyz')throw Error('Unexpected building data');
// Geometry binary SHA validation is performed by build-building-volumes.mjs;
// here bind its retained envelopes to the current manifests and source labels.
for(const [file,info] of Object.entries(buildingsAudit.inputs).filter(([file])=>file.endsWith('.json'))){
  if(hash(file)!==info.sha256)throw Error(`Building source changed: ${file}`);
}
const repairsPath='data/tasks/20261013-901f569-point-repairs/positions.json';
const repairs=read(repairsPath),repairManifest=read('data/tasks/20261013-901f569-point-repairs/manifest.json');
if(hash(repairsPath)!==repairManifest.files.find(f=>f.path==='positions.json')?.sha256||repairs.source.eftBuild!==47965)throw Error('Task repair identity mismatch');
const manifestPath=`${evidence}/manifest.json`,manifest=read(manifestPath);
if(manifest.eftBuild!==47965||manifest.eftVersion!=='1.2.0.0.47965')throw Error('Wrong collider source version');
for(const file of manifest.sourceFiles)if(hash(file.path)!==file.sha256)throw Error(`Collider source changed: ${file.path}`);
const levels=new Map();
for(const [level,info] of Object.entries(manifest.levels)){
  if(hash(info.path)!==info.sha256)throw Error(`Collider evidence changed: ${info.path}`);
  levels.set(Number(level),read(info.path));
}
const exfils=new Set(['ExfiltrationPoint','ScavExfiltrationPoint','SharedExfiltrationPoint','SecretExfiltrationPoint']);
const triggers=new Set(['PlaceItemTrigger','ExperienceTrigger','FlareShootDetectorZone','QuestTrigger']);
const classesFor=p=>{
  const t=p.poiTypes?.[0]||'';
  const factions={extract_pmc:'ExfiltrationPoint',extract_scav:'ScavExfiltrationPoint',extract_shared:'SharedExfiltrationPoint',extract_secret:'SecretExfiltrationPoint'};
  return factions[t]?new Set([factions[t]]):t==='quest_extract'?new Set([...exfils,'TransitPoint']):t==='transit'?new Set(['TransitPoint']):
    t==='mine'?new Set(['Minefield','MineDirectional']):t==='sniper_zone'?new Set(['SniperFiringZone']):
    ['quest_visit','quest_place','quest_beacon','quest_zone','quest_flare'].includes(t)?triggers:null;
};
const distance=(a,b)=>Math.max(...['x','y','z'].map((key,i)=>Math.abs(a[key]-b[i])));
const volumeKey=volumes=>JSON.stringify(volumes.map(v=>({type:v.type,corners:v.corners?.map(p=>p.map(n=>Math.round(n*1e5)/1e5))})));
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const stats=[],unmatched=[],inputs=[],allOutputs=[];
inputs.push({path:repairsPath,sha256:hash(repairsPath)});
inputs.push({path:buildingsPath,sha256:hash(buildingsPath)});
for(const map of Object.values(ATLAS_MAPS)){
  const candidates=(manifest.maps[map.id]||[]).flatMap(lv=>levels.get(lv)||[]);
  for(const [kind,baseFile,destination] of [
    ['poi',`site/data/${map.id}-pois.json`,`data/volumes/${map.id}.json`],
    ['task',`site/data/tasks/maps/${map.id}.json`,`data/tasks/volumes/${map.id}.json`]
  ]){
    const base=read(baseFile),points={},counts={mapId:map.id,kind,total:base.points.length,withOutline:0,volumePoints:0,uniqueVolumes:0,noVolume:0};
    if(base.sources?.spt?.eftBuild!==47965)throw Error(`Wrong point source version: ${baseFile}`);
    inputs.push({path:baseFile,sha256:hash(baseFile),canonicalSha256:canonicalHash(base)});
    const unique=new Set();
    for(const p of base.points){
      if(p.outline?.length>=3)counts.withOutline++;
      const allowed=classesFor(p);
      if(!allowed)continue;
      const transitBinding=(repairs.maps[map.id]?.transits||[]).find(r=>r.name===p.sourceId&&distance(p.position,['x','y','z'].map(k=>r.position[k]))<=.0101)?.sourceEvidence;
      const matches=candidates.filter(r=>r.active&&allowed.has(r.class)&&
        (r.sourceId.trim()===p.sourceId.trim()||r.class==='TransitPoint'&&transitBinding?.level===r.level&&transitBinding.componentId===r.componentId)&&
        (p.sceneLevel==null||r.level===p.sceneLevel)&&
        (!p.sourceEvidence?.componentId||r.componentId===p.sourceEvidence.componentId)&&
        r.position&&distance(p.position,r.position)<=.0101);
      const footprintMatches=r=>!p.outline?.length||r.volumes?.[0]?.corners&&p.outline.every(p=>r.volumes[0].corners.slice(0,4).some(c=>Math.hypot(c[0]-p.x,c[2]-p.z)<.025));
      const shapes=new Map();
      for(const match of matches)if(match.volumes?.length&&footprintMatches(match))shapes.set(volumeKey(match.volumes),match);
      if(shapes.size!==1){
        counts.noVolume++;
        unmatched.push({mapId:map.id,kind,id:p.id,sourceId:p.sourceId,poiTypes:p.poiTypes,position:p.position,level:p.sceneLevel,
          hadOutline:p.outline?.length>=3,reason:shapes.size>1?'ambiguous-geometry':matches.some(r=>r.volumes?.length)?'footprint-mismatch':matches.length?'no-supported-collider':'no-exact-typed-match',
          matchingRecords:matches.map(r=>({level:r.level,componentId:r.componentId,class:r.class}))});
        continue;
      }
      const row=[...shapes.values()][0];
      // Besides the serialized identity + class + rounded center, check that
      // existing footprint endpoints match this collider in X/Z. Display Y may
      // have been lifted by the old terrain draping; it is not the source height.
      points[p.id]=row.volumes.map(v=>({type:v.type,corners:v.corners,source:{
        level:v.source.level,componentId:v.source.componentId,gameObjectId:v.source.gameObjectId,class:v.source.class,
        colliderId:v.source.colliderId,transformId:v.source.transformId,relation:v.source.relation,
        colliderEnabled:v.source.colliderEnabled,isTrigger:v.source.isTrigger,eftBuild:47965,
        ...(transitBinding&&row.class==='TransitPoint'?{taskTransitBinding:{...transitBinding,path:repairsPath,sha256:hash(repairsPath)}}:{}),
        evidence:`${evidence}/level${row.level}.json`,evidenceSha256:manifest.levels[row.level].sha256,
        sourceFile:manifest.sourceFiles.find(f=>f.path.endsWith(`/level${row.level}`))?.path,
        sourceSha256:manifest.sourceFiles.find(f=>f.path.endsWith(`/level${row.level}`))?.sha256}}));
      counts.volumePoints++;unique.add(volumeKey(row.volumes));
    }
    counts.uniqueVolumes=unique.size;
    const sidecar={version:1,mapId:map.id,eftBuild:47965,baseSha256:canonicalHash(base),points,
      source:{manifest:manifestPath,manifestSha256:hash(manifestPath),coordinateSystem:'Unity XYZ',binding:'typed source identity + source level when present + world center within original 0.01 m rounding + footprint check'},
      ...(kind==='poi'?{regions:{}}:{})};
    if(kind==='poi'){
      const regionPath=`site/data/${map.id}-regions.json`,regionData=read(regionPath);
      sidecar.regionBaseSha256=canonicalHash(regionData);
      inputs.push({path:regionPath,sha256:hash(regionPath),canonicalSha256:sidecar.regionBaseSha256});
      const geometry=read(`site/${map.geometry}`);
      sidecar.regionGeometrySha256=geometry.sourceGeometrySha256||geometry.sha256;
      for(const label of regionData.labels){
        const record=buildings.regions[label.id];if(!record)continue;
        if(record.source.eftBuild!==47965||record.source.geometrySha256!==sidecar.regionGeometrySha256)throw Error(`Stale building: ${label.id}`);
        const evidenceFile=record.source.evidence.split('#')[0];
        const source={...record.source,evidence:`${path.posix.dirname(buildingsPath)}/${record.source.evidence}`,
          evidenceSha256:hash(`${path.posix.dirname(buildingsPath)}/${evidenceFile}`)};
        sidecar.regions[label.id]=[{type:'prism',...record.volume,source}];
      }
      counts.buildingRegions=Object.keys(sidecar.regions).length;
    }
    write(path.join(output,destination),sidecar);allOutputs.push(destination);stats.push(counts);
  }
}
const audit={version:1,eftBuild:47965,inputs,manifest:{path:manifestPath,sha256:hash(manifestPath)},stats,unmatched,
  exclusions:['Ordinary item/door positions have no gameplay volume association.','SpawnPointMarker sphere references are inventoried, but not treated as playable spawn area without proven semantics.','Building envelopes are generated and verified separately.'],
  outputs:allOutputs.map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(output,file)))}))};
write(path.join(output,'volume-audit.json'),audit);
console.log(JSON.stringify({stats,unmatched:unmatched.map(({mapId,sourceId,reason,hadOutline})=>({mapId,sourceId,reason,hadOutline})),output}));
