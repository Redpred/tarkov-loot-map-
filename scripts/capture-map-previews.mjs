import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createSiteServer} from './lib/site-server.mjs';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
const root=path.resolve(import.meta.dirname,'..'),site=path.join(root,'site'),directory=path.join(site,'previews');
const port=4182,origin=`http://127.0.0.1:${port}`;
fs.mkdirSync(directory,{recursive:true});
const manifestFile=path.join(directory,'manifest.json');
const previews=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{schemaVersion:1,maps:{}};
const app=createSiteServer(site),serve=app.listeners('request')[0];app.removeAllListeners('request');
app.on('request',(req,res)=>{
  const url=new URL(req.url,origin);
  if(url.pathname==='/__capture'||url.pathname==='/__capture.js'){
    const html=url.pathname==='/__capture';res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    res.end(fs.readFileSync(path.join(import.meta.dirname,'preview',html?'capture.html':'capture.js')));return;
  }
  if(url.pathname==='/__capture/existing'){
    const ready=Object.keys(previews.maps).filter(id=>{
      if(!ATLAS_MAPS[id]||!fs.existsSync(path.join(site,previews.maps[id].file)))return false;
      const geometry=JSON.parse(fs.readFileSync(path.join(site,ATLAS_MAPS[id].geometry),'utf8'));
      return previews.maps[id].recipeVersion===4&&previews.maps[id].band==='all'&&previews.maps[id].geometrySha256===(geometry.sourceGeometrySha256||geometry.sha256);
    });
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(ready));return;
  }
  if(url.pathname==='/__capture/save'){
    const id=url.searchParams.get('map');
    if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='image/webp'||!Object.hasOwn(ATLAS_MAPS,id)){res.writeHead(403).end();return;}
    (async()=>{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('截图过大');chunks.push(chunk);}
      const data=Buffer.concat(chunks),info=await sharp(data).metadata();
      if(info.format!=='webp'||info.width!==1440||info.height!==960)throw new Error('截图格式或尺寸错误');
      const sha256=crypto.createHash('sha256').update(data).digest('hex');
      const map=ATLAS_MAPS[id],geometry=JSON.parse(fs.readFileSync(path.join(site,map.geometry),'utf8'));
      const entry={file:`previews/${id}.webp`,sha256,bytes:data.length,width:info.width,height:info.height,recipeVersion:4,heading:180,band:'all',heightRange:[geometry.bounds.min[1]-1,geometry.bounds.max[1]+1],sceneSha256:geometry.sceneSha256,geometrySha256:geometry.sourceGeometrySha256||geometry.sha256,capturedAt:new Date().toISOString()};
      fs.writeFileSync(path.join(site,entry.file)+'.tmp',data);fs.renameSync(path.join(site,entry.file)+'.tmp',path.join(site,entry.file));
      previews.maps[id]=entry;fs.writeFileSync(manifestFile,JSON.stringify(previews,null,2)+'\n');
      console.log(`Saved ${id}: ${Math.round(data.length/1024)} KiB`);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(entry));
    })().catch(error=>{console.error(error);if(!res.headersSent)res.writeHead(400);res.end(error.message);});return;
  }
  serve(req,res);
});
app.listen(port,'127.0.0.1',()=>console.log(`Preview capture: ${origin}/__capture`));
