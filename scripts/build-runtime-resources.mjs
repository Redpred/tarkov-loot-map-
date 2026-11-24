import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {runtimeInputs,mergeMapData,RUNTIME_VERSION} from '../site/atlas-runtime.js';
import {createItemIndex} from '../site/atlas-item-index.js';
import {createTaskMapIndex,serializeTaskMapIndex} from '../site/task-map-index.js';
import {buildSpatialData} from '../site/atlas-spatial-data.js';

const root=path.resolve(import.meta.dirname,'..'),site=path.join(root,'site');
const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const selected=arg('--map')?.split(',')||Object.keys(ATLAS_MAPS);
const mapsOnly=args.includes('--maps-only');
if(selected.some(id=>!Object.hasOwn(ATLAS_MAPS,id)))throw new Error('Unknown map');
const target=path.join(site,'data/runtime');
const staging=path.join(root,'work',`runtime-build-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.mkdir(staging,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let existing=null;try{existing=JSON.parse(await fs.readFile(path.join(target,'manifest.json'),'utf8'));}catch{}
const catalog=existing?.version===RUNTIME_VERSION?structuredClone(existing):{version:RUNTIME_VERSION,maps:{},geometry:{}};
const records=[];let fileCount=0,rawBytes=0,gzipBytes=0;
async function artifact(value) {
  const bytes=Buffer.from(JSON.stringify(value)),sha256=hash(bytes),name=sha256+'.json',compressed=gzipSync(bytes,{level:9});
  await fs.writeFile(path.join(staging,name),bytes);await fs.writeFile(path.join(staging,name+'.gz'),compressed);
  fileCount++;rawBytes+=bytes.length;gzipBytes+=compressed.length;
  return {file:'data/runtime/'+name,sha256,bytes:bytes.length};
}
async function read(relative) {const bytes=await fs.readFile(path.join(site,relative));return {value:JSON.parse(bytes),sha256:hash(bytes)};}
for(const id of selected) {
  const map=ATLAS_MAPS[id],start=performance.now(),inputs={},sources=[];
  for(const file of runtimeInputs(map)){const source=await read(file);inputs[file]=source.sha256;sources.push(source.value);}
  const [loot,poi,quests,regions,tasks]=sources,data=mergeMapData(loot,poi,quests);
  const itemIndex=createItemIndex(data),taskIndex=createTaskMapIndex({catalog:tasks,data,mapId:id,itemIndex});
  const prepared={version:RUNTIME_VERSION,mapId:id,loot,poi,quests,regions,
    itemIndex:itemIndex.serialize(),taskIndex:serializeTaskMapIndex(taskIndex,tasks,data)};
  catalog.maps[id]={...await artifact(prepared),inputs};
  if(mapsOnly){
    if(!existing?.geometry?.[id])throw new Error(`No existing geometry derivative to reuse: ${id}`);
    for(const [file,sha] of Object.entries(inputs))if((await read(file)).sha256!==sha)throw new Error(`Source changed: ${file}`);
    const record={id,points:data.points.length,items:itemIndex.items.length,tasks:prepared.taskIndex.entries.length,geometryReused:true,bundleBytes:catalog.maps[id].bytes,seconds:+((performance.now()-start)/1000).toFixed(2)};
    records.push(record);console.log(JSON.stringify(record));continue;
  }
  const {value:manifest}=await read(map.geometry),entries={};
  const sectors=map.streamed?manifest.sectors:[{id:'whole',file:null}];
  let modelBytes=0,meshes=0;
  for(const sector of sectors) {
    const file=map.streamed?map.textureBase+sector.file:map.geometry;
    const detail=map.streamed?(await read(file)).value:manifest;
    const buffer=await fs.readFile(path.join(site,file.replace(/\.json$/,'.bin')));
    if(buffer.length!==detail.stats.bytes||hash(buffer)!==detail.sha256)throw new Error(`Invalid geometry: ${file}`);
    const bytes=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
    const spatial=buildSpatialData(detail,bytes);
    entries[sector.id]={...await artifact(spatial),geometrySha256:detail.sha256,manifestSha256:hash(JSON.stringify(detail))};
    modelBytes+=buffer.length;meshes+=detail.meshes.length;
  }
  // Prevent a concurrent source update from publishing a mixed derivative.
  for(const [file,sha] of Object.entries(inputs))if((await read(file)).sha256!==sha)throw new Error(`Source changed: ${file}`);
  catalog.geometry[id]=entries;
  const record={id,points:data.points.length,items:itemIndex.items.length,tasks:prepared.taskIndex.entries.length,
    sectors:sectors.length,meshes,modelBytes,bundleBytes:catalog.maps[id].bytes,seconds:+((performance.now()-start)/1000).toFixed(2)};
  records.push(record);console.log(JSON.stringify(record));
}
// Immutable payloads go first. The catalog switch is the final publication step.
await fs.mkdir(target,{recursive:true});
if(existing)await fs.copyFile(path.join(target,'manifest.json'),path.join(staging,'manifest.before.json'));
for(const name of await fs.readdir(staging))if(/^[a-f0-9]{64}\.json(?:\.gz)?$/.test(name))await fs.copyFile(path.join(staging,name),path.join(target,name));
await fs.writeFile(path.join(target,'manifest.next.json'),JSON.stringify(catalog));
await fs.rename(path.join(target,'manifest.next.json'),path.join(target,'manifest.json'));
const report={version:RUNTIME_VERSION,staging,generatedAt:new Date().toISOString(),records,fileCount,rawBytes,gzipBytes};
await fs.writeFile(path.join(staging,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fileCount,rawMiB:+(rawBytes/2**20).toFixed(2),gzipMiB:+(gzipBytes/2**20).toFixed(2),report:path.join(staging,'report.json')}));
