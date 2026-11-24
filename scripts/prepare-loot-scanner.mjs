import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const root=path.resolve(import.meta.dirname,'..');
const read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const source=await read('data/spt-source.json');
const recognitionSource=await read('data/loot-scanner/source.json').catch(()=>null);
const currentItems=new Map((recognitionSource?.items||[]).map(i=>[i.id,i]));
const [templates,zh,en,icons]=await Promise.all([
  read(source.databasePath+'/templates/items.json'),read(source.databasePath+'/locales/global/ch.json'),
  read(source.databasePath+'/locales/global/en.json'),read('site/data/icons/items/manifest.json')]);
const output=path.join(root,'site/data/loot-scanner');
await fs.mkdir(output,{recursive:true});
const items=[];let skipped=0;
for(const entry of Object.values(icons.entries)){
  if(!/^[a-f0-9]{24}$/.test(entry.tpl)){skipped++;continue;}
  const item=templates[entry.tpl],p=item?._props,current=currentItems.get(entry.tpl),width=current?.width||p?.Width,height=current?.height||p?.Height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1){skipped++;continue;}
  const extension=current?.gridImageLink?path.extname(new URL(current.gridImageLink).pathname):'.webp';
  const grid=path.join(root,'work/image-loot-20261016/grid-icons',entry.tpl+extension),hasGrid=Boolean(await fs.stat(grid).catch(()=>null));
  const pixels=await sharp(hasGrid?grid:path.join(root,'site',entry.file)).resize(16,16,{fit:hasGrid?'contain':'fill',background:'#181818'}).flatten({background:'#181818'}).removeAlpha().raw().toBuffer();
  items.push({id:entry.tpl,name:zh[entry.tpl+' Name']||entry.name,en:en[entry.tpl+' Name']||entry.en,
    aliases:[...new Set([entry.shortName,zh[entry.tpl+' ShortName'],en[entry.tpl+' ShortName'],entry.name,entry.en].filter(Boolean))],
    width,height,stackMax:Math.max(1,current?.stackMaxSize||p?.StackMaxSize||1),types:current?.types||[],
    icon:entry.file,reference:hasGrid?'grid':'icon',signature:pixels.toString('base64')});
}
const catalog={schemaVersion:1,generatedAt:new Date().toISOString(),source:{eftVersion:source.eftVersion,sptCommit:source.commit,iconsRetrievedAt:icons.retrievedAt,recognitionInput:recognitionSource?{source:recognitionSource.source,input:recognitionSource.input,sha256:recognitionSource.sha256}:null},items};
await fs.writeFile(path.join(output,'catalog.json'),JSON.stringify(catalog));
const vendor=path.join(root,'site/vendor/ocr');await fs.mkdir(vendor,{recursive:true});
const copied=[];
async function copy(from,to){const b=await fs.readFile(path.join(root,from));await fs.writeFile(path.join(vendor,to),b);copied.push({file:to,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
for(const file of ['tesseract.min.js','worker.min.js'])await copy('node_modules/tesseract.js/dist/'+file,file);
for(const file of await fs.readdir(path.join(root,'node_modules/tesseract.js-core'))){
  if(/^tesseract-core.*\.wasm(?:\.js)?$/.test(file))await copy('node_modules/tesseract.js-core/'+file,file);
}
for(const lang of ['eng','chi_sim'])await copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`${lang}.traineddata.gz`);
await copy('node_modules/tesseract.js/LICENSE.md','LICENSE-tesseract.txt');
await copy('node_modules/tesseract.js-core/LICENSE','LICENSE-core.txt');
await fs.writeFile(path.join(vendor,'manifest.json'),JSON.stringify({tesseract:'7.0.0',languages:{eng:'@tesseract.js-data/eng@1.0.0',chi_sim:'@tesseract.js-data/chi_sim@1.0.0'},files:copied},null,2));
console.log(JSON.stringify({items:items.length,skipped,vendorFiles:copied.length,vendorBytes:copied.reduce((n,x)=>n+x.bytes,0)}));
