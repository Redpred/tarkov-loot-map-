import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {readMapCachePlan} from './lib/map-cache-plan.mjs';
import {DELIVERY_CHUNK} from './lib/prepared-delivery.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=option('--input');if(!input)throw Error('请提供 --input 暂存目录');
const root=path.resolve('site'),directory=path.resolve(input),catalog=JSON.parse(await fs.readFile(path.join(directory,'catalog.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),readManifest=async file=>JSON.parse(await fs.readFile(file));
const verified=new Set(),files=[],maps=[];
const catalogBytes=await fs.readFile(path.join(directory,'catalog.json'));
files.push({file:'catalog.json',bytes:catalogBytes.length,sha256:hash(catalogBytes)});
for(const pack of catalog.packs){
  const plan=await readMapCachePlan(root,ATLAS_MAPS[pack.mapId],pack.quality,readManifest);
  if(hash(JSON.stringify(plan))!==pack.planSha256)throw Error('资源包与当前地图版本不一致：'+pack.mapId);
  for(const [identity,version,bytes] of plan.geometry){
    if(verified.has(version))continue;verified.add(version);const digest=createHash('sha256');
    for(let offset=0;offset<bytes;offset+=DELIVERY_CHUNK){
      const length=Math.min(DELIVERY_CHUNK,bytes-offset),file=`chunks/${version}/${offset}-${length}.gz`,compressed=await fs.readFile(path.join(directory,file));
      const chunk=JSON.parse(gunzipSync(compressed)),raw=Buffer.from(chunk.data,'base64');
      if(chunk.offset!==offset||chunk.total!==bytes||raw.length!==length||hash(raw)!==chunk.sha256)throw Error('分块损坏：'+file);
      digest.update(raw);files.push({file,bytes:compressed.length,sha256:hash(compressed)});
    }
    if(digest.digest('hex')!==version)throw Error('模型校验失败：'+identity);
  }
  const file=`packs/${pack.sha256}.zip`,digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path.join(directory,file))){digest.update(chunk);bytes+=chunk.length;}
  if(bytes!==pack.bytes||digest.digest('hex')!==pack.sha256)throw Error('下载包校验失败：'+pack.mapId);
  files.push({file,bytes,sha256:pack.sha256});maps.push({mapId:pack.mapId,quality:pack.quality,resources:pack.resourceCount,resourceBytes:pack.resourceBytes,downloadBytes:pack.bytes});
}
if(catalog.all){
  if(catalog.all.mapIds.length!==maps.length||maps.some(map=>!catalog.all.mapIds.includes(map.mapId)))throw Error('合集地图清单不一致');
  const file=`packs/${catalog.all.sha256}.zip`,digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path.join(directory,file))){digest.update(chunk);bytes+=chunk.length;}
  if(bytes!==catalog.all.bytes||digest.digest('hex')!==catalog.all.sha256)throw Error('合集下载包校验失败');
  files.push({file,bytes,sha256:catalog.all.sha256});
}
const summary={schemaVersion:1,maps,preparedModels:verified.size,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
const report=option('--report');if(report)await fs.writeFile(path.resolve(report),JSON.stringify(summary,null,2));
console.log(JSON.stringify({maps:maps.length,preparedModels:verified.size,files:files.length,totalBytes:summary.totalBytes,downloadBytes:maps.reduce((n,m)=>n+m.downloadBytes,0)}));
