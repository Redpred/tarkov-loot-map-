import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const input=path.join(root,'work/high-value-loot-20261016-0032/research/regular-items.json');
const bytes=await fs.readFile(input),raw=JSON.parse(bytes),out=path.join(root,'work/image-loot-20261016/grid-icons');
await fs.mkdir(out,{recursive:true});await fs.mkdir(path.join(root,'data/loot-scanner'),{recursive:true});
const source={source:'https://json.tarkov.dev/regular/items',input:path.relative(root,input).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),items:Object.values(raw.data.items).map(i=>({id:i.id,width:i.width,height:i.height,stackMaxSize:i.stackMaxSize,types:i.types,gridImageLink:i.gridImageLink,updated:i.updated}))};
await fs.writeFile(path.join(root,'data/loot-scanner/source.json'),JSON.stringify(source));
const failures=[];let cursor=0,done=0,cached=0,totalBytes=0;
async function worker(){
 while(cursor<source.items.length){
  const item=source.items[cursor++];if(!/^[a-f0-9]{24}$/.test(item.id))continue;
  const url=new URL(item.gridImageLink),extension=path.extname(url.pathname);
  if(url.hostname!=='assets.tarkov.dev'||url.protocol!=='https:'||!['.webp','.jpg','.jpeg','.png'].includes(extension)){failures.push({id:item.id,error:'Invalid asset source'});continue;}
  const file=path.join(out,item.id+extension);
  if(await fs.stat(file).catch(()=>false)){cached++;done++;continue;}
  let error;
  for(let retry=0;retry<2;retry++)try{
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('HTTP '+response.status);
    const b=Buffer.from(await response.arrayBuffer());
    const valid=b.subarray(8,12).toString()==='WEBP'||b[0]===255&&b[1]===216&&b[2]===255||b.subarray(0,8).toString('hex')==='89504e470d0a1a0a';
    if(b.length>4e6||!valid)throw new Error('Invalid grid image');
    await fs.writeFile(file,b);totalBytes+=b.length;error=null;break;
  }catch(e){error=e.message;}
  if(error)failures.push({id:item.id,error});done++;if(done%500===0)console.log(JSON.stringify({done,total:source.items.length,cached,failures:failures.length}));
 }
}
await Promise.all(Array.from({length:8},worker));
const assets=[];
for(const item of source.items){
 if(!/^[a-f0-9]{24}$/.test(item.id))continue;
 const name=item.id+path.extname(new URL(item.gridImageLink).pathname),b=await fs.readFile(path.join(out,name)).catch(()=>null);
 if(b)assets.push({id:item.id,file:name,url:item.gridImageLink,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
}
await fs.writeFile(path.join(out,'assets.json'),JSON.stringify({sourceSHA256:source.sha256,assets},null,2));
await fs.writeFile(path.join(out,'download.json'),JSON.stringify({source:source.source,sourceSHA256:source.sha256,downloadedAt:new Date().toISOString(),total:source.items.length,cached,totalBytes,failures},null,2));
console.log(JSON.stringify({done,cached,totalBytes,failures:failures.length}));
