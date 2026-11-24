import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {loadGeometryQuality} from '../site/atlas-geometry-quality.js';
import {digest,manifestDigest,views,bytesOf,GEOMETRY_TIERS} from './lib/geometry-quality.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const bufferOf=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
function keys(data,paint){
  const p=new Uint32Array(data.positions.buffer,data.positions.byteOffset,data.positions.length),uv=new Uint32Array(data.uvs.buffer,data.uvs.byteOffset,data.uvs.length),color=paint?new Uint32Array(data.paint.buffer,data.paint.byteOffset,data.paint.length/4):null;
  return i=>`${p[i*3]},${p[i*3+1]},${p[i*3+2]},${uv[i*2]},${uv[i*2+1]}${color?','+color[i]:''}`;
}
export function verifyMesh(source,derived,a,b,material,tier){
  for(const key of ['name','material','instances','rendererSources','sourceFaceStart','sourceFaceCount'])assert.deepEqual(derived[key],source[key],key);
  assert.ok(derived.indices>0&&derived.indices%3===0&&derived.indices<=source.indices,'triangle count');assert.ok(derived.vertices>0&&derived.vertices<=source.vertices,'vertex count');
  assert.equal(bytesOf(a.matrices).compare(bytesOf(b.matrices)),0,'instance transforms');assert.equal(bytesOf(a.boxes).compare(bytesOf(b.boxes)),0,'instance bounds');
  assert.equal(Boolean(b.paint),Boolean(material.vp),'only vertex-paint materials retain paint');
  assert.ok(derived.simplification.errorMeters<=GEOMETRY_TIERS[tier].errorMeters*1.001);
  const originalKey=keys(a,Boolean(material.vp)),retainedKey=keys(b,Boolean(material.vp));
  const originalKeys=Array.from({length:source.vertices},(_,i)=>originalKey(i)),retainedKeys=Array.from({length:derived.vertices},(_,i)=>retainedKey(i)),vertices=new Set(originalKeys);
  for(const key of retainedKeys)assert.ok(vertices.has(key),'position, UV and paint must be an exact original vertex');
  for(const id of b.indices)assert.ok(id<derived.vertices,'valid index');
  if(derived.simplification.protected){
    assert.equal(derived.indices,source.indices,'protected mesh keeps all triangles');
    for(let i=0;i<a.indices.length;i++)assert.equal(retainedKeys[b.indices[i]],originalKeys[a.indices[i]],'protected triangle order, winding and attributes');
  }
}
export async function verifyGeometryQuality({siteRoot,snapshotRoot,derivedRoot,maps=Object.values(ATLAS_MAPS),onProgress=console.log}){
  const reports=[];
  for(const map of maps){
    const source=await read(path.join(snapshotRoot,map.geometry)),active=await read(path.join(siteRoot,map.geometry));assert.deepEqual(source,active,'source manifest untouched');
    const report={mapId:map.id,sourceManifestSha256:manifestDigest(source),variants:{}};
    const catalog=await read(path.join(derivedRoot,'geometry-quality',map.id,'manifest.json'));
    for(const tier of ['medium','low']){
      const selected=await loadGeometryQuality(source,map,tier,{fetcher:async url=>({ok:true,json:()=>read(path.join(derivedRoot,url.replace(/^\/?data\//,'')))})});
      assert.equal(selected.quality,tier,selected.reason);
      const model=selected.manifest,records=map.streamed?source.sectors:[{id:'whole',...source}],outputRecords=map.streamed?model.sectors:[model];
      let triangles=0,bytes=0,instances=0,vertices=0,groups=0;
      for(let n=0;n<records.length;n++){
        const row=records[n],out=outputRecords[n],base=path.dirname(map.geometry);
        const detail=map.streamed?await read(path.join(snapshotRoot,base,row.file)):source;
        if(map.streamed)assert.deepEqual(await read(path.join(siteRoot,base,row.file)),detail,'source sector untouched');
        const original=await fs.readFile(path.join(snapshotRoot,base,detail.binary));assert.equal(digest(original),detail.sha256);
        if(tier==='medium')assert.equal(digest(await fs.readFile(path.join(siteRoot,base,detail.binary))),detail.sha256,'active binary untouched');
        const directory=path.join(derivedRoot,'geometry-quality',map.id,tier),derived=map.streamed?await read(path.join(directory,out.file)):model;
        const binary=await fs.readFile(path.join(directory,derived.binary));assert.equal(digest(binary),derived.sha256);assert.equal(binary.length,derived.stats.bytes);
        assert.equal(derived.sha256,out.sha256);assert.equal(derived.meshes.length,detail.meshes.length);assert.deepEqual(derived.bounds,detail.bounds);
        const a=bufferOf(original),b=bufferOf(binary);
        for(let i=0;i<detail.meshes.length;i++){
          const old=detail.meshes[i],m=derived.meshes[i];verifyMesh(old,m,views(old,a),views(m,b),source.materials[m.material],tier);
          triangles+=m.indices/3;vertices+=m.vertices;instances+=m.instances;groups++;
        }
        const spatial=catalog.variants[tier].runtime.geometry[row.id];assert.equal(spatial.geometrySha256,derived.sha256);assert.equal(spatial.manifestSha256,manifestDigest(derived));
        const raw=await fs.readFile(path.join(derivedRoot,spatial.file.replace(/^data\//,'')));assert.equal(raw.length,spatial.bytes);assert.equal(digest(raw),spatial.sha256);
        const prepared=JSON.parse(raw);assert.equal(prepared.meshes.length,derived.meshes.length);assert.equal(prepared.geometrySha256,derived.sha256);
        bytes+=binary.length;
      }
      report.variants[tier]={triangles,vertices,instances,groups,bytes};assert.equal(bytes,catalog.variants[tier].stats.bytes);
      onProgress(`${map.id} ${tier}: validated ${records.length} sectors, ${groups} meshes`);
    }
    assert.ok(report.variants.low.triangles<=report.variants.medium.triangles);assert.equal(report.variants.low.instances,report.variants.medium.instances);
    reports.push(report);
  }
  return reports;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  if(!args.includes('--snapshot')||!args.includes('--derived'))throw Error('Required --snapshot and --derived');
  const maps=args.includes('--map')?get('--map').split(',').map(id=>{if(!Object.hasOwn(ATLAS_MAPS,id))throw Error('Unknown map');return ATLAS_MAPS[id];}):Object.values(ATLAS_MAPS);
  const report=await verifyGeometryQuality({siteRoot:path.resolve('site'),snapshotRoot:get('--snapshot'),derivedRoot:get('--derived'),maps});
  if(args.includes('--report'))await fs.writeFile(get('--report'),JSON.stringify(report,null,2)+'\n');
}
