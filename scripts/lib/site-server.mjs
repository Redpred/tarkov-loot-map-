import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {pipeline} from 'node:stream';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {acceptsGzip,matchesEtag,createResponseCache} from './http-resource-cache.mjs';
import {createRuntimeResourceIndex} from './runtime-resource-index.mjs';
import {createMarketPriceService,MARKET_MODES} from './market-prices.mjs';
import {createMapCachePlanReader} from './map-cache-plan.mjs';
import {validateSpans,readFilteredRange} from './scenery-details.mjs';
import {servePreparedGeometry,serveResourcePack} from './prepared-delivery.mjs';
import {createDesktopArchiveHandler} from './desktop-resource-archive.mjs';

export const MAX_GEOMETRY_CHUNK = 4 * 1024 * 1024;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm','.bin':'application/octet-stream','.txt':'text/plain; charset=utf-8'};

function json(res,status,value,code){
  const body=JSON.stringify(value);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':'inline','X-Content-Type-Options':'nosniff',
    'Cache-Control':'no-store','Content-Length':Buffer.byteLength(body),...(code?{'X-Map-Error-Code':code}:{})});
  res.end(body);
}

function fileErrorCode(resource, error){
  const cause=({ENOENT:'MISSING',EACCES:'PERMISSION',EPERM:'PERMISSION',EMFILE:'LIMIT',ENFILE:'LIMIT'})[error.code]||'IO';
  return `SERVER-${resource}-${cause}`;
}

const immutable='public, max-age=31536000, immutable';
const stamp=stat=>`${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`;

const manifestDigests=new WeakMap();
function manifestDigest(value){if(!manifestDigests.has(value))manifestDigests.set(value,createHash('sha256').update(JSON.stringify(value)).digest('hex'));return manifestDigests.get(value);}
async function geometryChunk(root,url,req,res,map,sectorId,readManifest,responseBody,quality,scenery,preparedDelivery){
  if(req.method!=='GET'){json(res,405,{error:'仅支持 GET'});return;}
  const offsetText=url.searchParams.get('offset'),lengthText=url.searchParams.get('length');
  const offset=Number(offsetText),length=Number(lengthText),version=url.searchParams.get('version');
  if(!/^\d+$/.test(offsetText??'') || !/^\d+$/.test(lengthText??'') ||
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length<1 || length>MAX_GEOMETRY_CHUNK ||
      !/^[a-f0-9]{64}$/.test(version??'')){
    json(res,400,{error:'模型分块参数无效'},'SERVER-MODEL-RANGE');return;
  }
  let file;
  try{
    let manifest,index,binary=map.geometry.replace(/\.json$/,'.bin'),spans;
    if(quality){
      const base=`data/geometry-quality/${map.id}/${quality}/`;index=await readManifest(path.join(root,base,'manifest.json'));
      const source=await readManifest(path.join(root,map.geometry));
      if(index.geometryQuality?.sourceManifestSha256!==manifestDigest(source)||index.geometryQuality.quality!==quality){json(res,409,{error:'模型精度资源已过期，请刷新页面'},'SERVER-MODEL-VERSION');return;}
      manifest=sectorId?index.sectors.find(s=>s.id===sectorId):index;
      if(!manifest){json(res,404,{error:'地图分区不存在'},'SERVER-MODEL-SECTOR-MISSING');return;}
      binary=base+(sectorId?`sectors/${sectorId}.bin`:'model.bin');
    }else if(sectorId){
      index=await readManifest(path.join(root,map.geometry));
      manifest=index.sectors.find(s=>s.id===sectorId);
      if(!manifest){json(res,404,{error:'地图分区不存在'},'SERVER-MODEL-SECTOR-MISSING');return;}
      binary=`${map.textureBase}sectors/${sectorId}.bin`;
    }else manifest=index=await readManifest(path.join(root,map.geometry));
    const sourceManifest=manifest;
    if(scenery==='simple'){
      const tier=quality||'original',base=`data/scenery-details/${map.id}/`,catalog=await readManifest(path.join(root,base,'manifest.json'));
      const variant=catalog.variants?.[tier],selected=await readManifest(path.join(root,base,tier,'manifest.json')),sourceVersion=manifestDigest(index);
      if(catalog.schemaVersion!==1||catalog.recipeVersion!==1||catalog.mapId!==map.id||catalog.sceneSha256!==index.sceneSha256||variant?.file!==`${tier}/manifest.json`||variant.sourceManifestSha256!==sourceVersion||variant.manifestSha256!==manifestDigest(selected)||selected.decorationFilter?.sourceManifestSha256!==sourceVersion){json(res,409,{error:'装饰筛选资源已过期，请刷新页面'},'SERVER-SCENERY-VERSION');return;}
      const entry=sectorId?selected.sectors?.find(s=>s.id===sectorId):selected;
      if(!entry){json(res,404,{error:'地图分区不存在'},'SERVER-MODEL-SECTOR-MISSING');return;}
      manifest=sectorId?await readManifest(path.join(root,base,tier,'sectors',sectorId+'.json')):selected;
      const filter=manifest.decorationFilter,prepared=variant.runtime?.geometry?.[sectorId||'whole'];
      if(manifest.sha256!==entry.sha256||manifest.stats?.bytes!==entry.stats?.bytes||filter?.recipeVersion!==1||filter.sourceManifestSha256!==sourceVersion||filter.sourceGeometrySha256!==sourceManifest.sha256||filter.sourceBytes!==sourceManifest.stats.bytes||!Number.isSafeInteger(filter.removedMeshes)||filter.removedMeshes<0||prepared?.manifestSha256!==manifestDigest(manifest)){
        json(res,409,{error:'装饰筛选资源已过期，请刷新页面'},'SERVER-SCENERY-VERSION');return;
      }
      spans=filter.spans;validateSpans(spans,manifest.stats.bytes,filter.sourceBytes);
    }
    if(manifest.sha256!==version){json(res,409,{error:'模型已更新，请刷新页面'},'SERVER-MODEL-VERSION');return;}
    if(preparedDelivery&&await servePreparedGeometry(root,{version,offset,length,size:manifest.stats.bytes},req,res))return;
    file=await fs.promises.open(path.join(root,binary),'r');
    const stat=await file.stat(),size=manifest.stats.bytes;
    if(stat.size!==sourceManifest.stats.bytes){json(res,503,{error:'模型正在重建，请稍后刷新'},'SERVER-MODEL-SIZE');return;}
    if(offset>=size){json(res,416,{error:'模型分块超出范围'},'SERVER-MODEL-RANGE');return;}
    const compressed=acceptsGzip(req.headers['accept-encoding']);
    const etag=`W/"${version}-${offset}-${length}-${stamp(stat)}"`;
    const headers={'Content-Type':'application/json; charset=utf-8','Content-Disposition':'inline',
      'X-Content-Type-Options':'nosniff','Cache-Control':immutable,'ETag':etag,'Vary':'Accept-Encoding'};
    if(matchesEtag(req.headers['if-none-match'],etag)){res.writeHead(304,headers).end();return;}
    const body=await responseBody(`${binary}:${stamp(stat)}:${version}:${offset}:${length}`,async()=>{
      const data=spans?await readFilteredRange(file,spans,offset,length,size):Buffer.allocUnsafe(Math.min(length,size-offset));
      if(!spans){let read=0;
        while(read<data.length){
          const {bytesRead}=await file.read(data,read,data.length-read,offset+read);
          if(!bytesRead)throw new Error('Incomplete geometry read');read+=bytesRead;
        }
      }
      // Keep JSON + extensionless URLs so IDM/Thunder cannot capture .bin fetches.
      return Buffer.from(JSON.stringify({offset,total:size,encoding:'base64',sha256:createHash('sha256').update(data).digest('hex'),data:data.toString('base64')}));
    },compressed);
    if(compressed)headers['Content-Encoding']='gzip';
    headers['Content-Length']=body.length;res.writeHead(200,headers).end(body);
  }catch(error){
    json(res,error.code==='ENOENT'?404:503,{error:'模型数据暂不可用，请确认场景已提取完成。'},fileErrorCode('MODEL',error));
  }finally{await file?.close();}
}

export function createSiteServer(siteRoot,{marketPrices,preparedDelivery=true,resourceArchive}={}){
  const root=path.resolve(siteRoot);
  if(resourceArchive&&(path.resolve(resourceArchive)===root||path.resolve(resourceArchive).startsWith(root+path.sep)))throw Error('Resource archive must be outside the public site');
  const desktopArchive=createDesktopArchiveHandler(resourceArchive);
  const market=marketPrices||createMarketPriceService({seedDirectory:path.join(root,'data/market'),avatarManifest:path.join(root,'data/tasks/assets/manifest.json')});
  const responseBody=createResponseCache(),manifests=new Map();
  async function readManifest(file){
    const signature=stamp(await fs.promises.stat(file)),cached=manifests.get(file);
    if(cached?.signature===signature)return cached.value;
    const value=fs.promises.readFile(file,'utf8').then(JSON.parse);
    manifests.delete(file);manifests.set(file,{signature,value});
    if(manifests.size>32)manifests.delete(manifests.keys().next().value);
    try{return await value;}catch(error){if(manifests.get(file)?.value===value)manifests.delete(file);throw error;}
  }
  const runtimeIndex=createRuntimeResourceIndex(root,readManifest);
  const cachePlan=createMapCachePlanReader(root,readManifest);
  return http.createServer((req,res)=>{
    let file,url;
    try{
      url=new URL(req.url,'http://localhost');
      const name=decodeURIComponent(url.pathname);
      file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    }catch{res.writeHead(400).end();return;}
    if(url.pathname==='/desktop-resources'||url.pathname.startsWith('/desktop-resources/')){
      desktopArchive(url,req,res).catch(()=>{if(res.headersSent)res.destroy();else res.writeHead(503,{'Cache-Control':'no-store'}).end();});return;
    }
    if(url.pathname==='/api/health'){
      if(req.method!=='GET'){json(res,405,{error:'仅支持 GET'});return;}
      json(res,200,{app:'tarkov-loot-map',siteRoot:root,pid:process.pid});return;
    }
    const packRoute=url.pathname.match(/^\/resource-packs\/([a-f0-9]{64}\.zip)$/);
    if(packRoute){serveResourcePack(root,packRoute[1],req,res).catch(()=>{if(res.headersSent)res.destroy();else res.writeHead(503).end();});return;}
    // Only the catalog and explicitly downloadable ZIPs are public. Prepared
    // response files and build material are served through their checked routes.
    if(file.startsWith(path.join(root,'data/resource-delivery')+path.sep)&&file!==path.join(root,'data/resource-delivery/catalog.json')){res.writeHead(404).end();return;}
    if(url.pathname==='/api/market-prices'){
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'仅支持 GET 或 HEAD'});return;}
      const mode=url.searchParams.get('mode');
      if(!MARKET_MODES.includes(mode)||[...url.searchParams.keys()].some(key=>key!=='mode')||url.searchParams.getAll('mode').length!==1){json(res,400,{error:'游戏模式无效'});return;}
      market.get(mode).then(result=>{
        const headers={'Content-Type':'application/json; charset=utf-8','Content-Disposition':'inline','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=60','ETag':result.etag,'Vary':'Accept-Encoding'};
        if(matchesEtag(req.headers['if-none-match'],result.etag)){res.writeHead(304,headers).end();return;}
        const compressed=acceptsGzip(req.headers['accept-encoding']),body=compressed?result.gzip:result.body;
        if(compressed)headers['Content-Encoding']='gzip';headers['Content-Length']=body.length;
        res.writeHead(200,headers).end(req.method==='HEAD'?undefined:body);
      }).catch(error=>json(res,error.status===400?400:503,{error:'价格服务暂不可用，请稍后重试'}));return;
    }
    const runtimeRoute=url.pathname.match(/^\/api\/runtime\/([a-z_]+)$/);
    const cacheRoute=url.pathname.match(/^\/api\/cache-plan\/([a-z_]+)$/);
    if(cacheRoute){
      const map=Object.hasOwn(ATLAS_MAPS,cacheRoute[1])?ATLAS_MAPS[cacheRoute[1]]:null;
      if(!map){json(res,404,{error:'地图不存在'});return;}
      if(req.method!=='GET'){json(res,405,{error:'仅支持 GET'});return;}
      const quality={geometry:url.searchParams.get('geometry'),texture:url.searchParams.get('texture')};
      if(url.searchParams.has('scenery'))quality.scenery=url.searchParams.get('scenery');
      if(['geometry','texture'].some(key=>!['original','medium','low'].includes(quality[key]))||(quality.scenery!==undefined&&!['full','simple'].includes(quality.scenery))||[...url.searchParams.keys()].some(key=>!Object.hasOwn(quality,key))||Object.keys(quality).some(key=>url.searchParams.getAll(key).length!==1)){json(res,400,{error:'精度参数无效'});return;}
      cachePlan(map,quality).then(async plan=>{
        const version=manifestDigest(plan),etag=`W/"${version}"`,compressed=acceptsGzip(req.headers['accept-encoding']);
        const headers={'Content-Type':'application/json; charset=utf-8','Content-Disposition':'inline','Cache-Control':'no-cache','ETag':etag,'Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff'};
        if(matchesEtag(req.headers['if-none-match'],etag)){res.writeHead(304,headers).end();return;}
        const body=await responseBody(`cache-plan:${version}`,()=>Buffer.from(JSON.stringify(plan)),compressed);
        if(compressed)headers['Content-Encoding']='gzip';headers['Content-Length']=body.length;res.writeHead(200,headers).end(body);
      }).catch(()=>json(res,503,{error:'暂时无法核对所选档位的资源版本'}));return;
    }
    if(runtimeRoute){
      const map=Object.hasOwn(ATLAS_MAPS,runtimeRoute[1])?ATLAS_MAPS[runtimeRoute[1]]:null;
      if(!map){json(res,404,{error:'地图不存在'});return;}
      if(req.method!=='GET'){json(res,405,{error:'仅支持 GET'});return;}
      runtimeIndex(map).then(value=>json(res,200,value)).catch(()=>json(res,503,{error:'索引暂不可用'}));return;
    }
    const route=url.pathname.match(/^\/api\/([a-z_]+)-geometry(?:\/(medium|low))?(?:\/(simple))?(?:\/(s_-?\d+_-?\d+))?$/);
    if(route){
      const map=Object.hasOwn(ATLAS_MAPS,route[1])?ATLAS_MAPS[route[1]]:null;
      if(!map||Boolean(map.streamed)!==Boolean(route[4])){json(res,404,{error:'地图或分区不存在'});return;}
      geometryChunk(root,url,req,res,map,route[4],readManifest,responseBody,route[2],route[3],preparedDelivery).catch(()=>res.destroy());return;
    }
    if(url.pathname.startsWith('/api/')){json(res,404,{error:'接口不存在'});return;}
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    async function serveStatic(){
      const stat=await fs.promises.stat(file);if(!stat.isFile()){res.writeHead(404,{'Cache-Control':'no-store','X-Map-Error-Code':'SERVER-FILE-MISSING'}).end('Not found');return;}
      const extension=path.extname(file),etag=`W/"${stamp(stat)}"`;
      const prepared=/^\/data\/runtime\/[a-f0-9]{64}\.json$/.test(url.pathname);
      const versioned=prepared||(/^[a-f0-9]{64}$/.test(url.searchParams.get('v')||'')&&/\.(webp|png|svg)$/.test(file));
      const compressible=['.html','.js','.css','.json','.svg','.txt'].includes(extension);
      const compressed=compressible&&stat.size>=1024&&stat.size<=32*2**20&&acceptsGzip(req.headers['accept-encoding']);
      const headers={'Content-Type':types[extension]||'application/octet-stream','Cache-Control':versioned?immutable:'no-cache',
        'X-Content-Type-Options':'nosniff','ETag':etag,'Last-Modified':stat.mtime.toUTCString(),...(compressible?{'Vary':'Accept-Encoding'}:{})};
      if(matchesEtag(req.headers['if-none-match'],etag)){res.writeHead(304,headers).end();return;}
      if(prepared&&acceptsGzip(req.headers['accept-encoding'])){
        let packed;try{packed=await fs.promises.stat(file+'.gz');}catch{}
        if(packed?.isFile()){
          headers['Content-Encoding']='gzip';headers['Content-Length']=packed.size;
          res.writeHead(200,headers);if(req.method==='HEAD'){res.end();return;}
          fs.createReadStream(file+'.gz').on('error',()=>res.destroy()).pipe(res);return;
        }
      }
      if(compressed){
        const body=await responseBody(`${file}:${stamp(stat)}`,()=>fs.promises.readFile(file),true);
        headers['Content-Encoding']='gzip';headers['Content-Length']=body.length;res.writeHead(200,headers).end(req.method==='HEAD'?undefined:body);
      }else{
        headers['Content-Length']=stat.size;
        if(req.method==='HEAD'){res.writeHead(200,headers).end();return;}
        const stream=fs.createReadStream(file);
        await once(stream,'open');
        if(res.destroyed){stream.destroy();return;}
        res.writeHead(200,headers);
        pipeline(stream,res,()=>{});
      }
    }
    serveStatic().catch(error=>{
      if(res.headersSent)res.destroy();
      else if(!res.destroyed)res.writeHead(error.code==='ENOENT'?404:503,{'Cache-Control':'no-store','X-Map-Error-Code':fileErrorCode('FILE',error)}).end('Resource unavailable');
    });
  });
}
