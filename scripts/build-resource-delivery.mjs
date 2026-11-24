// Prepares a separate versioned output. No client extraction, source mutation,
// live deployment, or automatic deletion of historical resources.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {readMapCachePlan} from './lib/map-cache-plan.mjs';
import {createSiteServer} from './lib/site-server.mjs';
import {DELIVERY_CHUNK} from './lib/prepared-delivery.mjs';
import {createResourceArchive,createResourceCollection} from './lib/resource-pack.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
export async function buildResourceDelivery({root,out,mapIds,quality={geometry:'low',texture:'medium',scenery:'full'},zip=true,onProgress=console.log}){
  root=path.resolve(root);out=path.resolve(out);
  if(!mapIds?.length||mapIds.some(id=>!Object.hasOwn(ATLAS_MAPS,id)))throw Error('地图无效');
  if(!['original','medium','low'].includes(quality.geometry)||!['original','medium','low'].includes(quality.texture)||!['full','simple'].includes(quality.scenery))throw Error('资源档位无效');
  // An absent output is required, preventing accidental mutation of a release.
  await fs.mkdir(out);await fs.mkdir(path.join(out,'packs'));await fs.mkdir(path.join(out,'chunks'));
  const staging=path.join(out,'_bundles');await fs.mkdir(staging);
  const server=createSiteServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,catalog={schemaVersion:1,packs:[]},receipts=[];
  const readManifest=async file=>JSON.parse(await fs.readFile(file,'utf8'));
  try{
    for(const mapId of mapIds){
      const plan=await readMapCachePlan(root,ATLAS_MAPS[mapId],quality,readManifest),planSha=hash(JSON.stringify(plan));
      const name=`${mapId}-${quality.geometry}-${quality.texture}-${quality.scenery}-${planSha.slice(0,12)}`;
      const bundle=path.join(staging,name);await fs.mkdir(path.join(bundle,'blobs'),{recursive:true});
      const resources=[...plan.geometry,...plan.texture];
      await fs.writeFile(path.join(bundle,'resources.json'),JSON.stringify({schemaVersion:1,type:'tarkov-map-resource-pack',mapId,quality,planSha256:planSha,resources}));
      for(const [identity,version,bytes] of resources){
        const target=path.join(bundle,'blobs',version);
        try{const stat=await fs.stat(target);if(stat.size===bytes&&await fileHash(target)===version)continue;throw Error('资源内容冲突');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(identity.startsWith('texture:')){
          const source=path.resolve(root,'.'+identity.slice(8));if(!source.startsWith(root+path.sep))throw Error('资源路径越界');
          await fs.copyFile(source,target);
        }else{
          const handle=await fs.open(target,'wx'),digest=createHash('sha256');
          try{for(let offset=0;offset<bytes;offset+=DELIVERY_CHUNK){
            const length=Math.min(DELIVERY_CHUNK,bytes-offset),response=await fetch(base+identity.slice(9)+'?'+new URLSearchParams({offset,length,version}));
            if(!response.ok)throw Error(`模型准备失败 ${mapId} HTTP ${response.status}`);
            const chunk=await response.json(),decoded=Buffer.from(chunk.data,'base64');
            if(chunk.offset!==offset||chunk.total!==bytes||decoded.length!==length||hash(decoded)!==chunk.sha256)throw Error('模型分块校验失败');
            digest.update(decoded);await handle.writeFile(decoded);
            const directory=path.join(out,'chunks',version);await fs.mkdir(directory,{recursive:true});
            const packed=gzipSync(Buffer.from(JSON.stringify(chunk)),{level:4});
            await fs.writeFile(path.join(directory,`${offset}-${length}.gz`),packed,{flag:'wx'}).catch(async error=>{if(error.code!=='EEXIST'||hash(await fs.readFile(path.join(directory,`${offset}-${length}.gz`)))!==hash(packed))throw error;});
          }
          if(digest.digest('hex')!==version)throw Error('模型完整性校验失败');
          }finally{await handle.close();}
        }
        if((await fs.stat(target)).size!==bytes||await fileHash(target)!==version)throw Error('资源包内容校验失败');
      }
      const entry={mapId,quality,planSha256:planSha,resourceBytes:resources.reduce((n,r)=>n+r[2],0),resourceCount:resources.length};
      if(zip){
        Object.assign(entry,await createResourceArchive(bundle,path.join(out,'packs'),name));
      }
      catalog.packs.push(entry);receipts.push({mapId,planSha256:planSha,resources});
      onProgress(`${mapId}: ${resources.length} resources verified, ${(entry.resourceBytes/2**20).toFixed(1)} MiB`);
    }
    if(zip)catalog.all=await createResourceCollection(staging,path.join(out,'packs'),catalog.packs);
    await fs.writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog));
    await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({schemaVersion:1,root,quality,maps:receipts},null,2));
    return catalog;
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),read=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const out=read('--out');if(!out)throw Error('请提供尚不存在的独立暂存目录 --out');
  const maps=read('--map','all'),mapIds=maps==='all'?Object.keys(ATLAS_MAPS):maps.split(',');
  await buildResourceDelivery({root:path.resolve('site'),out,mapIds,quality:{geometry:read('--geometry','low'),texture:read('--texture','medium'),scenery:read('--scenery','full')},zip:!args.includes('--no-zip')});
}
