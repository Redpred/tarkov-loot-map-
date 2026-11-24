// The current inventory catalogue excludes quest items and some retired SPT
// templates. Check the same public asset naming convention for those IDs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {SPT_DB} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=async p=>JSON.parse((await fs.readFile(path.resolve(root,p),'utf8')).replace(/^\uFEFF/,''));
const db=SPT_DB;
const [templates,zh,en,catalog]=await Promise.all([read(`${db}/templates/items.json`),read(`${db}/locales/global/ch.json`),read(`${db}/locales/global/en.json`),read('data/atlas/item-icon-catalog.json')]);
const known=new Set(catalog.items.map(i=>i.id));
const pending=Object.values(templates).filter(i=>i._type==='Item'&&!known.has(i._id));
const entries={},items={},unavailable=[],errors=[];let cursor=0,done=0;
await Promise.all(Array.from({length:10},async()=>{
  while(cursor<pending.length){
    const it=pending[cursor++],id=it._id,key=`item-${id}`,file=`data/icons/items/${id}.webp`,url=`https://assets.tarkov.dev/${id}-icon.webp`;
    let bytes,reason;
    try{bytes=await fs.readFile(path.join(root,'site',file));await sharp(bytes).metadata();}catch{
      for(let attempt=0;attempt<3;attempt++)try{
        const r=await fetch(url,{signal:AbortSignal.timeout(20000)});
        if(r.status===404){reason='not-published';break;}
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        bytes=Buffer.from(await r.arrayBuffer());const meta=await sharp(bytes).metadata();
        if(!meta.width||!meta.height)throw new Error('Invalid image');
        await fs.writeFile(path.join(root,'site',file),bytes);reason=null;break;
      }catch(e){reason=e.message;bytes=null;}
    }
    if(bytes){
      const name=zh[`${id} Name`]||en[`${id} Name`]||it._name;
      entries[key]={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source:'tarkov.dev-spt-extra',name,en:en[`${id} Name`]||it._name,tpl:id,representative:name,url};items[id]=key;
    }else (reason==='not-published'?unavailable:errors).push({id,name:zh[`${id} Name`]||it._name,reason});
    done++;if(done%100===0)console.log(`${done}/${pending.length}; available=${Object.keys(items).length}; not published=${unavailable.length}; errors=${errors.length}`);
  }
}));
const result={schemaVersion:1,generatedAt:new Date().toISOString(),checked:pending.length,downloaded:Object.keys(items).length,entries,items,unavailable,errors};
await fs.writeFile(path.join(root,'site/data/icons/items/spt-extras.json'),JSON.stringify(result));
console.log(JSON.stringify({checked:pending.length,downloaded:result.downloaded,notPublished:unavailable.length,errors}));
if(errors.length)process.exitCode=1;
