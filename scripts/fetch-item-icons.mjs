import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'site/data/icons/items');
const snapshot=path.join(root,'data/atlas/item-icon-catalog.json');
await fs.mkdir(out,{recursive:true});
let catalog;
if(process.argv.includes('--refresh') || !(await fs.stat(snapshot).catch(()=>null))){
  const lists=await Promise.all(['zh','en'].map(async lang=>{
    const r=await fetch(`https://api.tarkov.dev/api/v1/items?lang=${lang}`,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error(`Item catalog: HTTP ${r.status}`);
    const value=await r.json();if(!Array.isArray(value)||value.length<1000)throw new Error('Invalid item catalog');return value;
  }));
  const en=new Map(lists[1].map(it=>[it.uid,it]));
  catalog={source:'https://api.tarkov.dev/api/v1/items',retrievedAt:new Date().toISOString(),items:lists[0].map(it=>({id:it.uid,name:it.name,shortName:it.shortName,en:en.get(it.uid)?.name||'',url:it.icon,tags:it.tags}))};
  await fs.writeFile(snapshot,JSON.stringify(catalog));
}else catalog=JSON.parse(await fs.readFile(snapshot,'utf8'));
const entries={},items={},failures=[];let cursor=0,done=0,cached=0;
async function worker(){
  while(cursor<catalog.items.length){
    const it=catalog.items[cursor++],key=`item-${it.id}`;
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(it.id)||new URL(it.url).hostname!=='assets.tarkov.dev')throw new Error(`Invalid icon source: ${it.id}`);
    const file=path.join(out,`${it.id}.webp`);let bytes,error;
    try{bytes=await fs.readFile(file);await sharp(bytes).metadata();cached++;}catch{
      for(let attempt=0;attempt<3;attempt++)try{
        const r=await fetch(it.url,{signal:AbortSignal.timeout(20000)});
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        bytes=Buffer.from(await r.arrayBuffer());
        const meta=await sharp(bytes).metadata();if(!meta.width||!meta.height)throw new Error('Invalid image');
        await fs.writeFile(file,bytes);error=null;break;
      }catch(e){error=e;bytes=null;}
    }
    if(!bytes)failures.push({id:it.id,name:it.name,url:it.url,error:error?.message});
    else{
      entries[key]={file:`data/icons/items/${it.id}.webp`,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source:'tarkov.dev',name:it.name,shortName:it.shortName,en:it.en,tpl:it.id,representative:it.name,tags:it.tags};
      items[it.id]=key;
    }
    done++;if(done%250===0)console.log(`${done}/${catalog.items.length}; failures=${failures.length}; cached=${cached}`);
  }
}
await Promise.all(Array.from({length:10},worker));
const result={schemaVersion:1,source:catalog.source,retrievedAt:catalog.retrievedAt,generatedAt:new Date().toISOString(),total:catalog.items.length,downloaded:Object.keys(items).length,entries,items,failures};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(result));
console.log(JSON.stringify({total:result.total,downloaded:result.downloaded,failures}));
if(failures.length)process.exitCode=1;
