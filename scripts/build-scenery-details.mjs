import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {DEFAULT_GEOMETRY_QUALITY} from '../site/atlas-geometry-quality.js';
import {buildSpatialData} from '../site/atlas-spatial-data.js';
import {digest,manifestDigest} from './lib/geometry-quality.mjs';
import {SCENERY_RECIPE,decorationFamily,protectedDecorationName,smallDecoration,instanceKey,mergeBounds,filterGeometry} from './lib/scenery-details.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function write(file,bytes){await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||digest(await fs.readFile(file))!==digest(bytes))throw e;}}
const json=(file,value)=>write(file,Buffer.from(JSON.stringify(value)+'\n'));
const records=(map,manifest)=>map.streamed?manifest.sectors:[{id:'whole',...manifest}];
export async function sourceDetail(root,map,manifest,record,quality){
  const base=quality==='original'?path.dirname(map.geometry):`data/geometry-quality/${map.id}/${quality}`;
  const detail=map.streamed?await read(path.join(root,base,record.file)):manifest;
  const raw=await fs.readFile(path.join(root,base,detail.binary));
  if(raw.length!==detail.stats.bytes||digest(raw)!==detail.sha256||detail.sha256!==record.sha256)throw Error(`Source geometry mismatch: ${map.id}/${quality}/${record.id}`);
  return {detail,raw};
}
export async function classifyDecorations({root,map,manifest,sceneFile}){
  const objects=new Map(),names=new Map();
  for(const record of records(map,manifest)){
    const {detail,raw}=await sourceDetail(root,map,manifest,record,'original');
    for(const mesh of detail.meshes){
      const rule=decorationFamily(mesh.name);if(!rule)continue;
      let name=names.get(mesh.name);if(!name){name={name:mesh.name,category:rule.id,label:rule.label,rule,keys:new Set(),groups:0,instances:0};names.set(mesh.name,name);}name.groups++;name.instances+=mesh.instances;
      for(let i=0;i<mesh.instances;i++){
        const matrix=new Float32Array(raw.buffer,raw.byteOffset+mesh.matrixOffset+i*48,12),box=new Float32Array(raw.buffer,raw.byteOffset+mesh.boundsOffset+i*24,6),key=instanceKey(mesh.name,matrix);
        name.keys.add(key);objects.set(key,mergeBounds(objects.get(key),box));
      }
    }
  }
  const sceneBytes=await fs.readFile(sceneFile),sceneSha256=digest(sceneBytes);
  if(sceneSha256!==manifest.sceneSha256)throw Error(`Scene metadata source mismatch: ${map.id}`);
  const evidence=new Map();
  for(const row of JSON.parse(sceneBytes).instances){
    if(!names.has(row.mesh)||!Array.isArray(row.m)||row.m.length!==16)continue;
    const key=instanceKey(row.mesh,Float32Array.from(row.m.slice(0,12)));if(!objects.has(key))continue;
    // Scene roots often name an entire floor; only functional root names
    // protect their descendants. Structural names still protect the renderer.
    const protectedObject=protectedDecorationName(row.gameObjectName)||/quest|task|loot|interact|switch|extract|trigger/i.test(row.root||'');
    const old=evidence.get(key);
    evidence.set(key,{protected:protectedObject||old?.protected||false,name:row.gameObjectName,root:row.root});
  }
  const audit=[];
  for(const value of names.values()){
    let unmatched=0,protectedObjects=0,oversized=0;const maxSize=[0,0,0],examples=[];
    for(const key of value.keys){
      const box=objects.get(key),proof=evidence.get(key);
      for(let i=0;i<3;i++)maxSize[i]=Math.max(maxSize[i],box[i+3]-box[i]);
      if(!proof)unmatched++;else if(proof.protected)protectedObjects++;
      if(!smallDecoration(value.rule,box))oversized++;
      if(proof&&examples.length<2&&!examples.some(e=>e.name===proof.name&&e.root===proof.root))examples.push(proof);
    }
    audit.push({name:value.name,category:value.category,label:value.label,objects:value.keys.size,groups:value.groups,instances:value.instances,maxSize,unmatched,protectedObjects,oversized,exclude:!unmatched&&!protectedObjects&&!oversized,examples});
  }
  return {sceneSha256,audit,removed:new Set(audit.filter(v=>v.exclude).map(v=>v.name))};
}

export async function readDecorationAudit(root,map,original){
  const audit=await read(path.join(root,map.id+'-audit.json'));
  const catalog=await read(path.join(root,'scenery-details',map.id,'manifest.json'));
  assert.equal(catalog.recipeVersion,SCENERY_RECIPE);
  assert.equal(catalog.mapId,map.id);
  assert.equal(catalog.sourceManifestSha256,manifestDigest(original),'Saved audit belongs to a different original export');
  assert.equal(catalog.sceneSha256,original.sceneSha256);
  assert.equal(audit.sceneSha256,original.sceneSha256);
  assert.equal(audit.mapId,map.id);
  const names=new Set(),removed=new Set();
  for(const row of audit.candidates){
    assert(!names.has(row.name)&&decorationFamily(row.name)?.id===row.category,'Invalid saved decoration audit');
    names.add(row.name);
    for(const count of [row.unmatched,row.protectedObjects,row.oversized])assert(Number.isSafeInteger(count)&&count>=0);
    assert.equal(row.exclude,row.unmatched===0&&row.protectedObjects===0&&row.oversized===0);
    if(row.exclude)removed.add(row.name);
  }
  return {sceneSha256:audit.sceneSha256,audit:audit.candidates,removed};
}

export async function buildSceneryDetails({siteRoot,snapshotRoot,qualityRoot,sceneRoot,auditRoot,outRoot,maps=Object.values(ATLAS_MAPS),onProgress=console.log}){
  for(const input of [siteRoot,snapshotRoot,qualityRoot,auditRoot||sceneRoot])if(path.resolve(outRoot)===path.resolve(input)||path.resolve(outRoot).startsWith(path.resolve(input)+path.sep))throw Error('Use independent staging output');
  const reports=[];
  for(const map of maps){
    const original=await read(path.join(snapshotRoot,map.geometry));
    if(manifestDigest(original)!==manifestDigest(await read(path.join(siteRoot,map.geometry))))throw Error('Active original manifest changed');
    const classified=auditRoot?await readDecorationAudit(auditRoot,map,original):await classifyDecorations({root:snapshotRoot,map,manifest:original,sceneFile:path.join(sceneRoot,map.id==='factory'?'factory_rework':map.id,'scene.json')});
    const catalog={schemaVersion:1,recipeVersion:SCENERY_RECIPE,mapId:map.id,sceneSha256:classified.sceneSha256,sourceManifestSha256:manifestDigest(original),variants:{}};
    const report={mapId:map.id,sceneSha256:classified.sceneSha256,candidates:classified.audit,tiers:{}};
    onProgress(`${map.id}: ${classified.removed.size}/${classified.audit.length} named meshes accepted`);
    const quality=DEFAULT_GEOMETRY_QUALITY;
    const relative=`data/geometry-quality/${map.id}/${quality}/manifest.json`;
    const source=await read(path.join(qualityRoot,relative));
    if(manifestDigest(source)!==manifestDigest(await read(path.join(siteRoot,relative))))throw Error('Active quality manifest changed');
    const sourceManifestSha256=manifestDigest(source),directory=path.join(outRoot,'scenery-details',map.id,quality),sectors=[],runtime={geometry:{}};
    const summary={sourceBytes:0,bytes:0,sourceGroups:0,groups:0,sourceInstances:0,instances:0,vertices:0,triangles:0,instancedTriangles:0,removedGroups:0};let whole;
    for(const record of records(map,source)){
      const {detail,raw}=await sourceDetail(qualityRoot,map,source,record,quality),out=filterGeometry(detail,raw,classified.removed);
      summary.sourceBytes+=raw.length;summary.bytes+=out.bytes.length;summary.sourceGroups+=detail.meshes.length;summary.groups+=out.manifest.meshes.length;
      summary.sourceInstances+=detail.meshes.reduce((n,m)=>n+m.instances,0);summary.instances+=out.manifest.stats.exportedInstances;summary.vertices+=out.manifest.stats.vertices;summary.triangles+=out.manifest.stats.triangles;summary.instancedTriangles+=out.manifest.stats.instancedTriangles;summary.removedGroups+=out.omitted.length;
      if(!out.bytes.length)continue;
      const file=map.streamed?`sectors/${record.id}.json`:'manifest.json';
      const derived={...out.manifest,file,decorationFilter:{recipeVersion:SCENERY_RECIPE,sourceManifestSha256,sourceGeometrySha256:detail.sha256,sourceBytes:raw.length,removedMeshes:out.omitted.length,spans:out.spans}};
      const spatial=buildSpatialData(derived,out.bytes.buffer.slice(out.bytes.byteOffset,out.bytes.byteOffset+out.bytes.length)),spatialBytes=Buffer.from(JSON.stringify(spatial)+'\n'),sha=digest(spatialBytes);
      await write(path.join(outRoot,'runtime',sha+'.json'),spatialBytes);await write(path.join(outRoot,'runtime',sha+'.json.gz'),gzipSync(spatialBytes));
      runtime.geometry[record.id]={file:`data/runtime/${sha}.json`,sha256:sha,bytes:spatialBytes.length,geometrySha256:derived.sha256,manifestSha256:manifestDigest(derived)};
      if(map.streamed){await json(path.join(directory,file),derived);const {meshes,decorationFilter,...index}=derived;sectors.push({...index,decorationFilter:{...decorationFilter,spans:undefined}});}else whole=derived;
    }
    if(!summary.bytes)throw Error('Filter cannot empty an entire map');
    const manifest=map.streamed?{...source,sectors,decorationFilter:{recipeVersion:SCENERY_RECIPE,sourceManifestSha256},stats:{...source.stats,sectorCount:sectors.length,sectorBytes:summary.bytes,exportedInstances:summary.instances,meshGroups:summary.groups,vertices:summary.vertices,triangles:summary.triangles,instancedTriangles:summary.instancedTriangles}}:whole;
    await json(path.join(directory,'manifest.json'),manifest);
    catalog.variants[quality]={file:`${quality}/manifest.json`,sourceManifestSha256,manifestSha256:manifestDigest(manifest),runtime,stats:summary};report.tiers[quality]=summary;
    onProgress(`${map.id} ${quality}: removed ${summary.removedGroups} groups, ${((summary.sourceBytes-summary.bytes)/2**20).toFixed(1)} MiB (${(100*(1-summary.bytes/summary.sourceBytes)).toFixed(1)}%)`);
    await json(path.join(outRoot,'scenery-details',map.id,'manifest.json'),catalog);await json(path.join(outRoot,map.id+'-audit.json'),report);reports.push(report);
  }
  await json(path.join(outRoot,'report.json'),reports.map(({candidates,...r})=>({...r,excludedNames:candidates.filter(v=>v.exclude).length,excludedObjects:candidates.filter(v=>v.exclude).reduce((n,v)=>n+v.objects,0)})));
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  for(const required of ['--snapshot','--quality-root','--out'])if(!args.includes(required))throw Error(`Required ${required}`);
  await buildSceneryDetails({siteRoot:path.resolve('site'),snapshotRoot:get('--snapshot'),qualityRoot:get('--quality-root'),sceneRoot:path.resolve('work/atlas-assets'),auditRoot:args.includes('--audit-root')?get('--audit-root'):undefined,outRoot:get('--out'),maps:args.includes('--map')?get('--map').split(',').map(id=>{if(!ATLAS_MAPS[id])throw Error('Unknown map');return ATLAS_MAPS[id];}):Object.values(ATLAS_MAPS)});
}
