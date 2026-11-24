import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ATLAS_MAPS} from '../site/atlas-maps.js';

// Deliberately curated architecture selectors. A nearby marker, arrival radius,
// furniture prop or broad scene root is never enough to establish a building.
const selections = [
  ['factory',0,'Office Building','SBG_Factory_Rework_Admin_Office','^Admin_office_(?:Floor_0[13]|Shower|staircase_0[12])_LOD0$'],
  ['customs',2,'New Gas','SBG_Custom_AZS','^Custom_AZS_(?:Wall|Roof)_LOD0$'],
  ['customs',3,'Old Gas','SBG_Custom_AZS_Old','^AZS_Old_LOD0$'],
  ['customs',5,'Crackhouse','SBG_Custom_Abandoned_Lab','^custom_Abandoned_Lab_exterior_LOD0$'],
  ['customs',12,'Repair Shop','SBG_Custom_RepairBox','^Custom_RepairBox_outside_LOD0$'],
  ['reserve',2,'White Pawn','SBG_Reserve_Base_Casarms','^reserve_casarm_(?:left|right)_outside_LOD0$'],
  ['reserve',10,'Black Pawn','SBG_Reserve_Base_Casarms','^reserve_casarm_(?:left|right)_outside_LOD0$'],
  ['reserve',11,'Barracks','SBG_Reserve_Base_MilitaryDorms','^Reserv_military_dorms_LOD0$'],
  ['reserve',25,'Dome','SBG_Reserve_Base_RLS_Station','^reserve_RLS_station_(?:sphere_(?:frame|base_outside|fabric)|outside_vertex_paint)_LOD0$'],
  ['ground_zero',0,'TerraGroup','SBG_Sandbox_Area_05','^Terragroup_office_0[12]_LOD0$'],
  ['ground_zero',1,'Skyside','SBG_Sandbox_Area_04','^Skyside_LOD0$'],
  ['ground_zero',2,'Fusion','SBG_Sandbox_Area_03','^Fusion_(?:smalltower|middle_building)_LOD0$'],
  ['ground_zero',3,'Empire','SBG_Sandbox_Area_01','^Empire_(?:Base|Extension|tower_0[12])_LOD0$'],
  ['ground_zero',5,'Nakatani','SBG_Sandbox_Area_07','^Nakatani_tower_0[1-4]_LOD0$'],
  ['ground_zero',6,'Elemental Global','SBG_Sandbox_Area_08','^Elemental_global_(?:Tower|Building)_0[1-3]_LOD0$'],
  ['streets',19,'Cinema','SBG_City_SE_03_Cinema','^Cinema_Exterier_(?:Wall_[0-9]+|construction_(?:Left|Right|Front))_LOD0$'],
  ['streets',35,'School','SBG_City_SW_01_B_School_30','^House_School_30_(?:[0-9]+|roof_[0-9]+)_LOD0$'],
].map(([map,index,en,root,name])=>({map,id:`${map}-region-${index}`,en,root,name}));

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outArg=process.argv.indexOf('--out');
const out=path.resolve(root,outArg>=0?process.argv[outArg+1]:'work/region-names-20261019/buildings');
if(!out.startsWith(root+path.sep)||out.startsWith(path.join(root,'site')+path.sep))throw new Error('Output must be an independent project staging directory.');
fs.mkdirSync(out,{recursive:true});
const read=p=>fs.readFileSync(path.join(root,p));
const json=p=>JSON.parse(read(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const fileHash=async p=>{const h=createHash('sha256');for await(const c of fs.createReadStream(path.join(root,p)))h.update(c);return h.digest('hex');};
const write=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
const cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
function hull(points){
  const ordered=points.sort((a,b)=>a.x-b.x||a.z-b.z).filter((p,i,a)=>!i||p.x!==a[i-1].x||p.z!==a[i-1].z);
  const lower=[],upper=[];
  for(const p of ordered){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of ordered.toReversed()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const contains=(poly,p)=>poly.length>=3&&poly.every((a,i)=>cross(a,poly[(i+1)%poly.length],p)>=-1e-5);
const matrixKey=m=>Array.from(m.slice(0,12),Math.fround).join(',');
const slice=(fd,offset,count)=>{const b=Buffer.alloc(count*4);if(fs.readSync(fd,b,0,b.length,offset)!==b.length)throw new Error('Short geometry read');return Array.from({length:count},(_,i)=>b.readFloatLE(i*4));};
const records=[],regions={},inputs={},mapSummaries=[];
for(const [map,cfg] of Object.entries(ATLAS_MAPS)){
  const labelPath=`site/data/${map}-regions.json`,labelBytes=read(labelPath),labels=JSON.parse(labelBytes).labels;
  inputs[labelPath]={sha256:hash(labelBytes),bytes:labelBytes.length};
  const mapSelections=selections.filter(s=>s.map===map),accepted=[];
  if(mapSelections.length){
    const scenePath=`work/atlas-assets/${cfg.atlas}/scene.json`,sceneBytes=read(scenePath),scene=JSON.parse(sceneBytes),sceneSha256=hash(sceneBytes);
    const provenancePath=`data/atlas/${map}-source.json`,provenanceBytes=read(provenancePath),provenance=JSON.parse(provenanceBytes);
    if(provenance.eftBuild!==47965||provenance.map!==cfg.atlas)throw new Error(`${map}: unexpected source version`);
    inputs[provenancePath]={sha256:hash(provenanceBytes),bytes:provenanceBytes.length};
    const manifestPath=map==='factory'?'site/data/atlas/factory-geometry.json':`site/data/atlas/${map}/${map}-geometry.json`;
    const manifestBytes=read(manifestPath),manifest=JSON.parse(manifestBytes),binaryPath=path.posix.join(path.posix.dirname(manifestPath),manifest.binary);
    if(manifest.sceneSha256!==sceneSha256)throw new Error(`${map}: source scene mismatch`);
    const binarySha256=await fileHash(binaryPath);
    if(manifest.sha256!==binarySha256)throw new Error(`${map}: runtime geometry mismatch`);
    inputs[scenePath]={sha256:sceneSha256,bytes:sceneBytes.length};inputs[manifestPath]={sha256:hash(manifestBytes),bytes:manifestBytes.length};
    inputs[binaryPath]={sha256:binarySha256,bytes:fs.statSync(path.join(root,binaryPath)).size};
    const fd=fs.openSync(path.join(root,binaryPath),'r');
    try{for(const selection of mapSelections){
      const label=labels.find(l=>l.id===selection.id);if(label?.en!==selection.en)throw new Error(`Label changed: ${selection.id}`);
      const re=new RegExp(selection.name,'i');
      const sourceRows=scene.instances.filter(i=>i.root===selection.root&&re.test(i.gameObjectName??'')&&i.renON!==false&&i.aih!==false&&!i.drop);
      const sourceByMesh=new Map();for(const row of sourceRows){if(!sourceByMesh.has(row.mesh))sourceByMesh.set(row.mesh,new Map());sourceByMesh.get(row.mesh).set(matrixKey(row.m),row);}
      // Keep separate architecture objects when this selector intentionally spans
      // two identically named building assets; spatial containment must disambiguate.
      const perObject=new Map(),geometryEvidence=[];
      for(const mesh of manifest.meshes){
        const byMatrix=sourceByMesh.get(mesh.name);if(!byMatrix)continue;
        const matrices=slice(fd,mesh.matrixOffset,mesh.instances*12),positions=slice(fd,mesh.positionOffset,mesh.vertices*3);
        for(let k=0;k<mesh.instances;k++){
          const m=matrices.slice(k*12,k*12+12),sourceRow=byMatrix.get(matrixKey(m));if(!sourceRow)continue;
          const key=`${sourceRow.rendererSource}:${sourceRow.rendererPathId}`;
          if(!perObject.has(key))perObject.set(key,{points:[],minY:Infinity,maxY:-Infinity,sourceRow});
          const entry=perObject.get(key);
          for(let v=0;v<positions.length;v+=3){const x=positions[v],y=positions[v+1],z=positions[v+2];const wx=m[0]*x+m[1]*y+m[2]*z+m[3],wy=m[4]*x+m[5]*y+m[6]*z+m[7],wz=m[8]*x+m[9]*y+m[10]*z+m[11];entry.points.push({x:wx,z:wz});entry.minY=Math.min(entry.minY,wy);entry.maxY=Math.max(entry.maxY,wy);}
          geometryEvidence.push({mesh:mesh.name,material:mesh.material,positionOffset:mesh.positionOffset,matrixOffset:mesh.matrixOffset,instance:k,sourceFaceStart:mesh.sourceFaceStart,sourceFaceCount:mesh.sourceFaceCount,sourceFaceRanges:mesh.sourceFaceRanges,groundClip:mesh.groundClip,rendererSource:sourceRow.rendererSource,rendererPathId:sourceRow.rendererPathId,gameObjectPathId:sourceRow.gameObjectPathId,gameObjectName:sourceRow.gameObjectName,matrix:m});
        }
      }
      let entries=[...perObject.values()];
      if(map==='reserve'&&[2,10].some(n=>selection.id===`reserve-region-${n}`))entries=entries.filter(e=>contains(hull(e.points.slice()),label.position));
      const points=entries.flatMap(e=>e.points),polygon=hull(points),minY=Math.min(...entries.map(e=>e.minY)),maxY=Math.max(...entries.map(e=>e.maxY));
      const containing=contains(polygon,label.position),valid=polygon.length>=3&&Number.isFinite(minY)&&maxY>minY&&containing;
      const evidenceKeys=new Set(entries.map(e=>`${e.sourceRow.rendererSource}:${e.sourceRow.rendererPathId}`));
      const evidence=geometryEvidence.filter(e=>evidenceKeys.has(`${e.rendererSource}:${e.rendererPathId}`));
      const record={...selection,status:valid?'accepted':'rejected',reason:valid?'Semantic architecture selector + exact source/runtime mesh and world-matrix match + label XZ containment.':!points.length?'No matching active architecture in current runtime.':'Label anchor is outside architecture footprint; no guessed expansion.',sourceRendererCount:sourceRows.length,runtimeRendererCount:entries.length,labelPosition:label.position,geometryEvidence:evidence,volume:points.length?{polygon,minY,maxY}:null};
      records.push(record);
      if(valid){const volume={polygon,minY,maxY};
        regions[selection.id]={volume,source:{kind:'client-architecture-envelope',method:'Convex horizontal envelope of named current runtime architecture vertices, extruded between actual minimum and maximum Y.',clientVersion:provenance.clientVersion,eftBuild:provenance.eftBuild,provenancePath,sceneSha256,geometrySha256:binarySha256,geometryManifestSha256:hash(manifestBytes),sceneRoot:selection.root,rendererCount:entries.length,evidence:`${map}-evidence.json#${selection.id}`,notice:'建筑模型包围范围；不是游戏触发器或精确房间边界。'}};accepted.push(selection.id);}
    }}finally{fs.closeSync(fd);}
    write(`${map}-evidence.json`,{map,coordinateSystem:'unity-world-xyz',records:records.filter(r=>r.map===map)});
  }
  mapSummaries.push({map,labelCount:labels.length,accepted:accepted.length,unmapped:labels.filter(l=>!regions[l.id]).map(l=>({id:l.id,name:l.name,en:l.en,reason:l.kind==='road'?'Road caption has no authored volume.':'No verified named architecture envelope in this bounded review.'}))});
  console.log(`${map}: ${accepted.length}/${labels.length} verified architecture envelopes`);
}
const authored=[];
for(const name of fs.readdirSync(path.join(root,'work/local-map-edits')).filter(n=>n.endsWith('.json'))){const p=`work/local-map-edits/${name}`,b=read(p),d=JSON.parse(b);inputs[p]={sha256:hash(b),bytes:b.length};authored.push({path:p,map:d.map,regionCount:d.regions.length,volumeRegionCount:d.regions.filter(r=>r.volume).length,exclusionCount:d.exclusions.length});}
write('building-volumes.json',{schemaVersion:1,coordinateSystem:'unity-world-xyz',regions});
write('audit.json',{schemaVersion:1,coordinateSystem:'unity-world-xyz',inputs,authored,totalLabels:mapSummaries.reduce((n,m)=>n+m.labelCount,0),accepted:Object.keys(regions).length,rejectedCandidates:records.filter(r=>r.status!=='accepted').map(({geometryEvidence,...r})=>r),maps:mapSummaries,limitations:['Bounding envelopes describe visible architecture, not gameplay trigger or navigable-room extents.','No arrival radius or label display height was used to manufacture a volume.','Existing labels and authored input files were not modified.','This review covers explicit architecture selectors only; unmapped labels remain point captions.']});
console.log(`Wrote ${Object.keys(regions).length} verified envelopes to ${path.relative(root,out)}`);
