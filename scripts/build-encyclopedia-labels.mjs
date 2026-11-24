import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const output=process.argv[process.argv.indexOf('--out')+1];
if(!process.argv.includes('--out')||!path.resolve(output).startsWith(path.join(root,'work')+path.sep))throw Error('Use a separate work/ output directory');
const read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8'));
const source=read('data/spt-source.json');
const localePath=path.join(source.databasePath,'locales/global/ch.json');
const catalogArg=process.argv.includes('--catalog')?process.argv[process.argv.indexOf('--catalog')+1]:'site/data/encyclopedia';
const catalog=path.resolve(root,catalogArg),locale=read(localePath),manifest=read(path.join(catalog,'manifest.json'));
const tokens=new Set();
function visit(v){if(typeof v==='string')tokens.add(v);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){tokens.add(k);visit(x);}}
for(const info of [...manifest.sections.map(s=>s.resource),...Object.values(manifest.itemChunks)]){
  if(!info.file.startsWith('data/encyclopedia/'))throw Error('Unexpected encyclopedia resource');
  const filename=path.resolve(catalog,info.file.slice('data/encyclopedia/'.length));
  if(!filename.startsWith(catalog+path.sep))throw Error('Resource outside catalog');
  const bytes=fs.readFileSync(filename);
  if(bytes.length!==info.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==info.sha256)throw Error('Resource fingerprint mismatch: '+info.file);
  visit(JSON.parse(bytes));
}
const names={};
for(const t of tokens){
  for(const key of [t+' Name',t+' name',t]){
    const value=locale[key];
    if(typeof value==='string'&&value.length<180&&/[\u3400-\u9fff]/.test(value)&&!/<[^>]+>/.test(value)){names[t]=value;break;}
  }
}
const data={localeVersion:source.eftVersion||source.eftBuild,localeSha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root,localePath))).digest('hex'),names};
fs.mkdirSync(output,{recursive:true});
const bytes=Buffer.from(JSON.stringify(data)+'\n');
fs.writeFileSync(path.join(output,'reader-names.json'),bytes);
manifest.readerNames={file:'data/encyclopedia/reader-names.json',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
manifest.presentationVersion=Math.max(3,manifest.presentationVersion||0);
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest)+'\n');
console.log(JSON.stringify({names:Object.keys(names).length,output}));
