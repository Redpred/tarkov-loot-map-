import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {buildSpatialData} from '../site/atlas-spatial-data.js';
import {digest,manifestDigest,GEOMETRY_RECIPE,GEOMETRY_TIERS,simplifyGeometry,createMeshSimplifier} from './lib/geometry-quality.mjs';

async function read(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function write(file,bytes){await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||digest(await fs.readFile(file))!==digest(bytes))throw e;}}
const json=(file,value)=>write(file,Buffer.from(JSON.stringify(value)+'\n'));
const inside=(root,relative)=>{const result=path.resolve(root,relative);if(!result.startsWith(path.resolve(root)+path.sep))throw Error('Unsafe source path');return result;};
export async function buildGeometryQuality({siteRoot,snapshotRoot,outRoot,maps=Object.values(ATLAS_MAPS),onProgress=console.log}){
  for(const a of [siteRoot,snapshotRoot])if(path.resolve(outRoot).startsWith(path.resolve(a)+path.sep)||path.resolve(outRoot)===path.resolve(a))throw Error('Output must be independent');
  const simplifier=createMeshSimplifier(),reports=[];
  for(const map of maps){
    const source=await read(inside(snapshotRoot,map.geometry)),active=await read(inside(siteRoot,map.geometry)),sourceManifestSha256=manifestDigest(source);
    if(manifestDigest(active)!==sourceManifestSha256)throw Error(`${map.id}: snapshot differs from active manifest`);
    const catalog={schemaVersion:1,recipeVersion:GEOMETRY_RECIPE,mapId:map.id,sourceManifestSha256,sourceGeometrySha256:source.sourceGeometrySha256||source.sha256,variants:{}};
    const totals={mapId:map.id,original:{bytes:0,vertices:0,triangles:0,instancedTriangles:0,instances:0},variants:{}};
    const records=map.streamed?source.sectors:[{id:'whole',file:path.basename(map.geometry),...source}],base=path.dirname(map.geometry);
    for(const quality of Object.keys(GEOMETRY_TIERS)){
      const directory=path.join(outRoot,'geometry-quality',map.id,quality),sectors=[],runtime={geometry:{}},summary={bytes:0,vertices:0,triangles:0,instancedTriangles:0,changedMeshes:0,protectedMeshes:0,maxErrorMeters:0};
      let whole;
      for(let i=0;i<records.length;i++){
        const record=records[i],relative=map.streamed?path.join(base,record.file):map.geometry;
        const detail=map.streamed?await read(inside(snapshotRoot,relative)):source;
        if(map.streamed&&manifestDigest(await read(inside(siteRoot,relative)))!==manifestDigest(detail))throw Error('Active sector changed');
        const raw=await fs.readFile(inside(snapshotRoot,path.join(base,detail.binary))),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
        if(raw.length!==detail.stats.bytes||digest(raw)!==detail.sha256||detail.sha256!==record.sha256)throw Error(`${map.id}/${record.id}: source hash mismatch`);
        if(quality==='medium'){
          totals.original.bytes+=raw.length;for(const m of detail.meshes){totals.original.vertices+=m.vertices;totals.original.triangles+=m.indices/3;totals.original.instancedTriangles+=m.indices/3*m.instances;totals.original.instances+=m.instances;}
        }
        const result=await simplifyGeometry(detail,buffer,source.materials,quality,simplifier);
        const file=map.streamed?`sectors/${record.id}.json`:'manifest.json',binary=map.streamed?`sectors/${record.id}.bin`:'model.bin';
        const derived={...result.manifest,file,binary,geometryQuality:{recipeVersion:GEOMETRY_RECIPE,quality,sourceManifestSha256,sourceGeometrySha256:detail.sha256,simplifier:'meshoptimizer@1.3.0',...GEOMETRY_TIERS[quality]}};
        await write(path.join(directory,binary),result.bytes);
        const spatial=buildSpatialData(derived,result.bytes.buffer.slice(result.bytes.byteOffset,result.bytes.byteOffset+result.bytes.byteLength));
        const spatialBytes=Buffer.from(JSON.stringify(spatial)+'\n'),spatialSha=digest(spatialBytes);
        await write(path.join(outRoot,'runtime',spatialSha+'.json'),spatialBytes);await write(path.join(outRoot,'runtime',spatialSha+'.json.gz'),gzipSync(spatialBytes));
        runtime.geometry[record.id]={file:`data/runtime/${spatialSha}.json`,sha256:spatialSha,bytes:spatialBytes.length,geometrySha256:derived.sha256,manifestSha256:manifestDigest(derived)};
        if(map.streamed){await json(path.join(directory,file),derived);const {meshes,...index}=derived;sectors.push(index);}else whole=derived;
        for(const key of Object.keys(summary))summary[key]=key==='maxErrorMeters'?Math.max(summary[key],result.summary[key]):summary[key]+result.summary[key];
        if(i%8===0||i===records.length-1)onProgress(`${map.id} ${quality}: ${i+1}/${records.length} · ${Math.round(summary.bytes/2**20)} MiB`);
      }
      const output=map.streamed?{...source,sectors,geometryQuality:{recipeVersion:GEOMETRY_RECIPE,quality,sourceManifestSha256,...GEOMETRY_TIERS[quality]},stats:{...source.stats,sectorBytes:summary.bytes,instancedTriangles:summary.instancedTriangles}}:whole;
      await json(path.join(directory,'manifest.json'),output);
      catalog.variants[quality]={file:`${quality}/manifest.json`,manifestSha256:manifestDigest(output),stats:summary,runtime};totals.variants[quality]=summary;
    }
    await json(path.join(outRoot,'geometry-quality',map.id,'manifest.json'),catalog);reports.push(totals);
    await json(path.join(outRoot,`${map.id}-report.json`),{...totals,recipeVersion:GEOMETRY_RECIPE,sourceManifestSha256,snapshotRoot:path.resolve(snapshotRoot)});
    onProgress(JSON.stringify({complete:map.id,...totals,cache:simplifier.metrics}));
  }
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  if(!args.includes('--snapshot')||!args.includes('--out'))throw Error('Required --snapshot <existing verified export snapshot> --out <new staging directory>');
  const maps=args.includes('--map')?get('--map').split(',').map(id=>{if(!Object.hasOwn(ATLAS_MAPS,id))throw Error('Unknown map');return ATLAS_MAPS[id];}):Object.values(ATLAS_MAPS);
  await buildGeometryQuality({siteRoot:path.resolve('site'),snapshotRoot:get('--snapshot'),outRoot:get('--out'),maps});
}
