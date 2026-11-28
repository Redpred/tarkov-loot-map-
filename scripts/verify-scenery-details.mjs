import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {buildSpatialData} from '../site/atlas-spatial-data.js';
import {DEFAULT_GEOMETRY_QUALITY,loadGeometryQuality} from '../site/atlas-geometry-quality.js';
import {DEFAULT_TEXTURE_QUALITY,selectTextureManifest} from '../site/atlas-texture-quality.js';
import {loadSceneryDetails} from '../site/atlas-scenery-details.js';
import {classifyDecorations,readDecorationAudit} from './build-scenery-details.mjs';
import {digest,manifestDigest,views,bytesOf} from './lib/geometry-quality.mjs';
import {SCENERY_RECIPE,validateSpans,readFilteredRange} from './lib/scenery-details.mjs';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const arrayBuffer=raw=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
const offsets=['positionOffset','uvOffset','paintOffset','indexOffset','matrixOffset','boundsOffset'];
const records=(map,manifest)=>map.streamed?manifest.sectors:[{id:'whole',...manifest}];
const metadata=mesh=>Object.fromEntries(Object.entries(mesh).filter(([key])=>!offsets.includes(key)));
function ranges(mesh){
  return [[mesh.positionOffset,mesh.vertices*12],[mesh.uvOffset,mesh.vertices*8],...(mesh.paintOffset==null?[]:[[mesh.paintOffset,mesh.vertices*4]]),[mesh.indexOffset,mesh.indices*(mesh.indexComponentType==='uint16'?2:4)],[mesh.matrixOffset,mesh.instances*48],[mesh.boundsOffset,mesh.instances*24]];
}

// Check immutable attributes separately from the retained-range recipe: an
// incorrect recipe and an incorrect manifest must not be able to agree silently.
export function verifyRetainedGeometry(source,sourceRaw,derived,derivedRaw,approved){
  const kept=source.meshes.filter(mesh=>!approved.has(mesh.name));
  assert.equal(derived.meshes.length,kept.length,'all and only approved named meshes removed');
  const a=arrayBuffer(sourceRaw),b=arrayBuffer(derivedRaw);let cursor=0;
  for(let i=0;i<kept.length;i++){
    const old=kept[i],mesh=derived.meshes[i];
    assert.deepEqual(metadata(mesh),metadata(old),'retained mesh order and non-offset metadata');
    const from=views(old,a),to=views(mesh,b);
    for(const key of Object.keys(from)){
      if(from[key]===null)assert.equal(to[key],null,key);
      else assert.ok(bytesOf(from[key]).equals(bytesOf(to[key])),`exact retained ${key}: ${old.name}`);
    }
    const oldRanges=ranges(old),newRanges=ranges(mesh);
    const delta=mesh.positionOffset-old.positionOffset;
    for(let n=0;n<oldRanges.length;n++){
      const [start,length]=newRanges[n];
      assert.ok(Number.isSafeInteger(start)&&start>=cursor&&Number.isSafeInteger(length)&&length>0,'valid nonoverlapping retained attribute');
      assert.equal(start,oldRanges[n][0]+delta,'one offset translation per mesh');
      assert.equal(length,oldRanges[n][1],'unchanged attribute length');
      cursor=start+length;assert.ok(cursor<=derivedRaw.length,'retained attribute within binary');
    }
    if(kept.length!==source.meshes.length)assert.equal(mesh.positionOffset,i?ranges(derived.meshes[i-1]).at(-1).reduce((x,y)=>x+y):0,'compact mesh start');
  }
  if(kept.length!==source.meshes.length)assert.equal(cursor,derivedRaw.length,'compact data ends at last mesh');
  else assert.ok(derivedRaw.equals(sourceRaw),'unmodified sector retains exact cache bytes including padding');
  assert.deepEqual(derived.materialIds,[...new Set(kept.map(mesh=>mesh.material))].sort((x,y)=>x-y),'only retained material IDs');
  for(const key of ['bounds','coordinateSystem','viewerTransform','sceneSha256','materials','textures'])assert.deepEqual(derived[key],source[key],`unchanged ${key}`);
  assert.equal(derived.stats.bytes,derivedRaw.length);
  assert.equal(derived.stats.meshGroups,kept.length);
  assert.equal(derived.stats.exportedInstances,kept.reduce((n,m)=>n+m.instances,0));
  assert.equal(derived.stats.vertices,kept.reduce((n,m)=>n+m.vertices,0));
  assert.equal(derived.stats.triangles,kept.reduce((n,m)=>n+m.indices/3,0));
  assert.equal(derived.stats.instancedTriangles,kept.reduce((n,m)=>n+m.indices/3*m.instances,0));
  assert.equal(digest(derivedRaw),derived.sha256,'retained geometry SHA-256');
}

function referencedTextures(manifest,materialIds,textures){
  const files=new Map();
  for(const id of materialIds){
    const material=manifest.materials[id];assert.ok(material,`material ${id} exists`);
    for(const name of [material.tex,material.emis,material.vp?.heights,...(material.vp?.layers||[]).map(layer=>layer.tex)]){
      if(!name||!textures[name])continue;
      const entry=textures[name];files.set(entry.file,entry);
    }
  }
  return {count:files.size,bytes:[...files.values()].reduce((n,entry)=>n+entry.bytes,0)};
}

export async function verifySceneryDetails({siteRoot,snapshotRoot,derivedRoot,sceneRoot=path.resolve('work/atlas-assets'),auditRoot,maps=Object.values(ATLAS_MAPS),onProgress=console.log}){
  const reports=[];
  for(const map of maps){
    const original=await read(path.join(snapshotRoot,map.geometry));
    assert.deepEqual(await read(path.join(siteRoot,map.geometry)),original,'active original manifest equals protected snapshot');
    const audit=await read(path.join(derivedRoot,map.id+'-audit.json'));
    const classified=auditRoot?await readDecorationAudit(auditRoot,map,original):await classifyDecorations({root:snapshotRoot,map,manifest:original,sceneFile:path.join(sceneRoot,map.id==='factory'?'factory_rework':map.id,'scene.json')});
    assert.equal(audit.mapId,map.id);assert.equal(audit.sceneSha256,original.sceneSha256);
    assert.deepEqual(audit.candidates,classified.audit,'source scene evidence equals generated audit');
    const approved=classified.removed;
    for(const row of audit.candidates)if(row.exclude){assert.equal(row.unmatched,0);assert.equal(row.protectedObjects,0);assert.equal(row.oversized,0);}
    const catalog=await read(path.join(derivedRoot,'scenery-details',map.id,'manifest.json'));
    assert.deepEqual(Object.keys(catalog.variants),[DEFAULT_GEOMETRY_QUALITY]);
    assert.equal(catalog.schemaVersion,1);assert.equal(catalog.recipeVersion,SCENERY_RECIPE);assert.equal(catalog.mapId,map.id);
    assert.equal(catalog.sourceManifestSha256,manifestDigest(original));assert.equal(catalog.sceneSha256,original.sceneSha256);
    const report={mapId:map.id,sceneSha256:original.sceneSha256,sourceManifestSha256:manifestDigest(original),excludedNames:approved.size,excludedObjects:audit.candidates.filter(row=>row.exclude).reduce((n,row)=>n+row.objects,0),tiers:{},textures:{}};
    const sourceMaterialIds=new Set(),retainedMaterialIds=new Set();
    const fetcher=async url=>{
      const relative=String(url).replace(/^\//,'');
      const target=relative.startsWith('data/scenery-details/')?path.join(derivedRoot,relative.slice(5)):path.join(siteRoot,relative);
      return {ok:true,json:()=>read(target)};
    };
    const quality=DEFAULT_GEOMETRY_QUALITY;
    const geometry=await loadGeometryQuality(original,map,quality,{fetcher});
    assert.equal(geometry.quality,quality,geometry.reason);
    const selected=await loadSceneryDetails(geometry,map,'simple',{fetcher});
    assert.equal(selected.scenery,'simple',selected.sceneryReason);
    const source=geometry.manifest,derived=selected.manifest,variant=catalog.variants[quality];
    assert.equal(variant.sourceManifestSha256,manifestDigest(source));assert.equal(variant.manifestSha256,manifestDigest(derived));
    assert.equal(derived.decorationFilter.sourceManifestSha256,manifestDigest(source));
    const sourceRecords=records(map,source),derivedRecords=records(map,derived),outputById=new Map(derivedRecords.map(record=>[record.id,record]));
    assert.equal(outputById.size,derivedRecords.length,'unique output partition IDs');
    const expectedIds=[],summary={sourceBytes:0,bytes:0,sourceGroups:0,groups:0,sourceInstances:0,instances:0,vertices:0,triangles:0,instancedTriangles:0,removedGroups:0};
    for(const record of sourceRecords){
      const base=`data/geometry-quality/${map.id}/${quality}`;
      const detail=map.streamed?await read(path.join(siteRoot,base,record.file)):source;
      const sourceFile=path.join(siteRoot,base,detail.binary),raw=await fs.readFile(sourceFile);
      assert.equal(raw.length,detail.stats.bytes,'active source binary size');assert.equal(digest(raw),detail.sha256,'active source binary SHA-256');assert.equal(detail.sha256,record.sha256,'source partition binding');
      const kept=detail.meshes.filter(mesh=>!approved.has(mesh.name));
      summary.sourceBytes+=raw.length;summary.sourceGroups+=detail.meshes.length;summary.sourceInstances+=detail.meshes.reduce((n,m)=>n+m.instances,0);summary.removedGroups+=detail.meshes.length-kept.length;
      for(const mesh of detail.meshes)sourceMaterialIds.add(mesh.material);
      if(!kept.length){assert.ok(!outputById.has(record.id),'empty partition omitted');continue;}
      expectedIds.push(record.id);
      const index=outputById.get(record.id);assert.ok(index,`retained partition ${record.id} exists`);
      const directory=path.join(derivedRoot,'scenery-details',map.id,quality);
      const output=map.streamed?await read(path.join(directory,index.file)):derived;
      assert.deepEqual(output.bounds,detail.bounds,'partition extent preserved');assert.equal(output.sha256,index.sha256);assert.equal(output.stats.bytes,index.stats.bytes);
      assert.equal(output.decorationFilter.recipeVersion,SCENERY_RECIPE);
      assert.equal(output.decorationFilter.sourceManifestSha256,manifestDigest(source));assert.equal(output.decorationFilter.sourceGeometrySha256,detail.sha256);assert.equal(output.decorationFilter.sourceBytes,raw.length);assert.equal(output.decorationFilter.removedMeshes,detail.meshes.length-kept.length);
      validateSpans(output.decorationFilter.spans,output.stats.bytes,raw.length);
      const reconstructed=Buffer.concat(output.decorationFilter.spans.map(([,start,length])=>raw.subarray(start,start+length)));
      verifyRetainedGeometry(detail,raw,output,reconstructed,approved);
      // Exercise the actual random-access reader at a retained-range boundary
      // as well as the final short chunk, without reading a second full copy.
      const handle=await fs.open(sourceFile,'r');
      try{
        const probes=new Set([0,Math.max(0,reconstructed.length-23),...output.decorationFilter.spans.slice(1,2).map(([out])=>Math.max(0,out-7))]);
        for(const offset of probes){const chunk=await readFilteredRange(handle,output.decorationFilter.spans,offset,32,reconstructed.length);assert.ok(chunk.equals(reconstructed.subarray(offset,offset+32)),'range reader crosses retained spans accurately');}
      }finally{await handle.close();}
      assert.deepEqual(index.materialIds,output.materialIds);
      for(const id of output.materialIds)retainedMaterialIds.add(id);
      const spatial=variant.runtime.geometry[record.id];assert.ok(spatial,'spatial entry exists');
      assert.equal(spatial.geometrySha256,output.sha256);assert.equal(spatial.manifestSha256,manifestDigest(output));
      assert.equal(spatial.file,`data/runtime/${spatial.sha256}.json`);
      const spatialFile=path.join(derivedRoot,spatial.file.slice(5)),spatialRaw=await fs.readFile(spatialFile);
      assert.equal(spatialRaw.length,spatial.bytes);assert.equal(digest(spatialRaw),spatial.sha256);
      assert.ok(gunzipSync(await fs.readFile(spatialFile+'.gz')).equals(spatialRaw),'gzip is exact same spatial JSON');
      // JSON intentionally serializes signed zero as zero. Compare the exact
      // regenerated JSON bytes, rather than Object.is(-0, 0) semantics.
      const expectedSpatial=Buffer.from(JSON.stringify(buildSpatialData(output,arrayBuffer(reconstructed)))+'\n');
      assert.ok(spatialRaw.equals(expectedSpatial),'spatial mesh order, local bounds and collision partitions');
      summary.bytes+=reconstructed.length;summary.groups+=output.meshes.length;summary.instances+=output.stats.exportedInstances;summary.vertices+=output.stats.vertices;summary.triangles+=output.stats.triangles;summary.instancedTriangles+=output.stats.instancedTriangles;
    }
    assert.deepEqual(derivedRecords.map(record=>record.id),expectedIds,'partition order and membership');
    assert.deepEqual(Object.keys(variant.runtime.geometry),expectedIds,'runtime has exactly the retained partitions');
    assert.deepEqual(summary,variant.stats,'catalog summary');assert.deepEqual(summary,audit.tiers[quality],'audit tier summary');
    if(map.streamed){assert.equal(derived.stats.sectorCount,expectedIds.length);assert.equal(derived.stats.sectorBytes,summary.bytes);assert.equal(derived.stats.meshGroups,summary.groups);assert.equal(derived.stats.exportedInstances,summary.instances);assert.equal(derived.stats.vertices,summary.vertices);assert.equal(derived.stats.triangles,summary.triangles);assert.equal(derived.stats.instancedTriangles,summary.instancedTriangles);}
    report.tiers[quality]={...summary,savedBytes:summary.sourceBytes-summary.bytes,savedPercent:100*(1-summary.bytes/summary.sourceBytes)};
    onProgress(`${map.id} ${quality}: ${expectedIds.length} partitions, ${summary.groups} retained groups, ${summary.removedGroups} removed, ${(report.tiers[quality].savedBytes/2**20).toFixed(2)} MiB saved`);
    const textureCatalog=await read(path.join(siteRoot,'data/model-quality',map.id,'manifest.json'));
    assert.deepEqual(Object.keys(textureCatalog.variants),[DEFAULT_TEXTURE_QUALITY]);
    const {textures}=await selectTextureManifest(original,textureCatalog,map.id,DEFAULT_TEXTURE_QUALITY);
    const before=referencedTextures(original,sourceMaterialIds,textures),after=referencedTextures(original,retainedMaterialIds,textures);
    report.textures[DEFAULT_TEXTURE_QUALITY]={sourceCount:before.count,count:after.count,sourceBytes:before.bytes,bytes:after.bytes,savedBytes:before.bytes-after.bytes};
    reports.push(report);
  }
  const sum=(group,tier,fields)=>Object.fromEntries(fields.map(key=>[key,reports.reduce((n,r)=>n+r[group][tier][key],0)]));
  return {schemaVersion:1,recipeVersion:SCENERY_RECIPE,verifiedAt:new Date().toISOString(),maps:reports,totals:{excludedObjects:reports.reduce((n,r)=>n+r.excludedObjects,0),excludedNames:reports.reduce((n,r)=>n+r.excludedNames,0),tiers:{[DEFAULT_GEOMETRY_QUALITY]:sum('tiers',DEFAULT_GEOMETRY_QUALITY,['sourceBytes','bytes','savedBytes','sourceGroups','groups','removedGroups','sourceInstances','instances'])},textures:{[DEFAULT_TEXTURE_QUALITY]:sum('textures',DEFAULT_TEXTURE_QUALITY,['sourceBytes','bytes','savedBytes','sourceCount','count'])}}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  if(!args.includes('--snapshot')||!args.includes('--derived'))throw Error('Required: --snapshot <versioned Atlas export> --derived <generated resources>');
  const maps=args.includes('--map')?get('--map').split(',').map(id=>{assert.ok(Object.hasOwn(ATLAS_MAPS,id),'Unknown map');return ATLAS_MAPS[id];}):Object.values(ATLAS_MAPS);
  const report=await verifySceneryDetails({siteRoot:path.resolve(args.includes('--site')?get('--site'):'site'),snapshotRoot:get('--snapshot'),derivedRoot:get('--derived'),auditRoot:args.includes('--audit-root')?get('--audit-root'):undefined,maps});
  if(args.includes('--report'))await fs.writeFile(get('--report'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.totals));
}
