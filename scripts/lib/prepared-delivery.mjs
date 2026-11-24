import fs from 'node:fs';
import path from 'node:path';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream';
import {acceptsGzip,matchesEtag} from './http-resource-cache.mjs';

export const DELIVERY_CHUNK=4*1024*1024;
export async function servePreparedGeometry(root,{version,offset,length,size},req,res){
  if(offset%DELIVERY_CHUNK||length!==Math.min(DELIVERY_CHUNK,size-offset))return false;
  const plain=path.join(root,'data/resource-delivery/chunks',version,`${offset}-${length}`);
  const compressed=acceptsGzip(req.headers['accept-encoding']);
  const file=plain+'.gz';let stat;
  try{stat=await fs.promises.stat(file);}catch{return false;}
  if(!stat.isFile())return false;
  const etag=`W/"prepared-v1-${version}-${offset}-${length}-${stat.size}"`;
  const headers={'Content-Type':'application/json; charset=utf-8','Content-Disposition':'inline','X-Content-Type-Options':'nosniff',
    'Cache-Control':'public, max-age=31536000, immutable','ETag':etag,'Vary':'Accept-Encoding','X-Resource-Delivery':'prepared'};
  if(matchesEtag(req.headers['if-none-match'],etag)){res.writeHead(304,headers).end();return true;}
  if(compressed){headers['Content-Encoding']='gzip';headers['Content-Length']=stat.size;}
  res.writeHead(200,headers);const stream=fs.createReadStream(file);
  // Disconnecting a client must also close the file and decompressor.
  if(compressed)pipeline(stream,res,()=>{});else pipeline(stream,createGunzip(),res,()=>{});return true;
}

// Downloads are immutable prepared ZIPs. Single-range requests let browsers and
// download managers resume an interrupted user-initiated download.
export async function serveResourcePack(root,name,req,res){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const file=path.join(root,'data/resource-delivery/packs',name);
  let stat;try{stat=await fs.promises.stat(file);}catch{res.writeHead(404).end();return;}
  const etag=`"${name.slice(0,-4)}"`,headers={'Content-Type':'application/zip','Content-Disposition':'attachment',
    'Cache-Control':'public, max-age=31536000, immutable','ETag':etag,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
  if(matchesEtag(req.headers['if-none-match'],etag)){res.writeHead(304,headers).end();return;}
  let start=0,end=stat.size-1,status=200;
  const range=req.headers.range;
  if(range&&(!req.headers['if-range']||req.headers['if-range']===etag)){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
    else start=Math.max(0,stat.size-Number(match[2]));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);
  if(req.method==='HEAD'){res.end();return;}
  pipeline(fs.createReadStream(file,{start,end}),res,()=>{});
}
