// Read only the versioned task package and the project's existing SPT Git objects.
// No installed EFT files or community task records are used by this collector.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {parseArgs} from 'node:util';

const exec=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const {values}=parseArgs({options:{repository:{type:'string',default:'work/spt5-source'},out:{type:'string',default:'site/data/tasks/assets'},audit:{type:'string',default:'work/task-system-20261013'},help:{type:'boolean'}}});
if(values.help){console.log('prepare-task-assets.mjs [--repository=work/spt5-source] [--out=work/task-images] [--audit=work/task-image-audit]\nRequires restored task inputs and the SPT Git commit pinned by data/task-source.json. Default output updates current site assets; prefer a new work/ output for inspection.');process.exit(0);}
const output=projectPath(values.out),auditDirectory=projectPath(values.audit),repository=projectPath(values.repository);
function assetFile(file){if(!file.startsWith('data/tasks/assets/')||file.includes('..'))throw Error('Invalid generated asset path');return path.join(output,file.slice('data/tasks/assets/'.length));}
const repositoryUrl='https://github.com/SP-Tushonka/server-csharp';
const imageRoot='Libraries/SPTushonka.Server.Assets/SPT_Data/images';
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJson=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
function projectPath(relative){
  const resolved=path.resolve(root,relative);
  if(!resolved.startsWith(root+path.sep))throw new Error('Input must stay inside the project');
  return resolved;
}
async function git(args){
  const {stdout}=await exec('git',['-C',repository,...args],{encoding:'buffer',maxBuffer:32*1024*1024,windowsHide:true});
  return stdout;
}
async function writeJson(file,value){await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');}

const source=await readJson(projectPath('data/task-source.json'));
const commit=source.sptCommit;
if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Task package requires a pinned SPT commit');
const packageRoot=projectPath(source.packagePath);
const database=path.join(packageRoot,'raw/spt/database');
const questFile=path.join(database,'templates/quests.json');
const questBytes=await fs.readFile(questFile);
const quests=JSON.parse(questBytes);
const globalEnglish=await readJson(path.join(database,'locales/global/en.json'));
const traders={};
for(const id of await fs.readdir(path.join(database,'traders'))){
  const record=await readJson(path.join(database,'traders',id,'base.json'));
  traders[id]=record;
}
const treeText=(await git(['ls-tree','-r',commit,'--',imageRoot+'/quest/icon',imageRoot+'/trader/avatar'])).toString('utf8');
const files=new Map(),stems=new Map();
for(const line of treeText.trim().split('\n')){
  const match=line.match(/^\d+ blob ([a-f0-9]{40})\t(.+)$/);
  if(!match)continue;
  const assetPath=match[2].slice(imageRoot.length);
  const entry={assetPath,repositoryPath:match[2],gitBlob:match[1]};
  files.set(assetPath,entry);
  const stem=assetPath.replace(/\.[^.]+$/,'');
  stems.set(stem,[...(stems.get(stem)||[]),entry]);
}
function resolveImage(requestedPath){
  if(typeof requestedPath!=='string'||!/^\/files\/(quest\/icon|trader\/avatar)\/[a-z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(requestedPath))return null;
  const assetPath=requestedPath.replace(/^\/files/,'');
  if(files.has(assetPath))return {...files.get(assetPath),resolution:'exact-path'};
  const candidates=stems.get(assetPath.replace(/\.[^.]+$/,''))||[];
  // Some base.json avatar paths name JPG while this pinned repository stores
  // the same avatar ID as PNG. Never use another directory or another ID.
  return candidates.length===1?{...candidates[0],resolution:'same-directory-and-id-extension'}:null;
}

await fs.mkdir(output,{recursive:true});
await fs.mkdir(path.join(output,'quests'),{recursive:true});
await fs.mkdir(path.join(output,'traders'),{recursive:true});
await fs.mkdir(auditDirectory,{recursive:true});
const generatedAt=new Date().toISOString();
const audit={schemaVersion:1,generatedAt,repository:repositoryUrl,commit,packagePath:source.packagePath,questSourceSha256:sha256(questBytes),sourceTreeImageCount:files.size,entries:[],missing:[],validationErrors:[]};
const manifest={schemaVersion:1,generatedAt,source:{repository:repositoryUrl,commit,packagePath:source.packagePath},traders:{},quests:{},fallback:{},stats:{},missing:[]};
const cache=new Map();
async function imageEntry(kind,id,requestedPath){
  const resolved=resolveImage(requestedPath);
  if(!resolved){
    const missing={kind,id,requestedPath:requestedPath||null,reason:requestedPath?'image-not-present-at-pinned-commit':'no-image-path'};
    audit.missing.push(missing);manifest.missing.push(missing);return null;
  }
  const cacheKey=kind+':'+resolved.gitBlob;
  let entry=cache.get(cacheKey);
  if(!entry){
    const original=await git(['cat-file','blob',resolved.gitBlob]);
    const blobHash=crypto.createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');
    if(blobHash!==resolved.gitBlob)throw new Error(`Git object mismatch: ${resolved.repositoryPath}`);
    const meta=await sharp(original,{failOn:'error'}).metadata();
    if(!meta.width||!meta.height)throw new Error(`Invalid source image: ${resolved.repositoryPath}`);
    const basename=path.posix.basename(resolved.repositoryPath).replace(/\.[^.]+$/,'');
    const file=`data/tasks/assets/${kind}/${basename}-${resolved.gitBlob.slice(0,10)}.webp`;
    const size=kind==='traders'?256:960;
    const bytes=await sharp(original,{failOn:'error'}).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:84,effort:5}).toBuffer();
    await fs.writeFile(assetFile(file),bytes);
    const decoded=await sharp(bytes,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});
    const imageSha=sha256(bytes);
    entry={file,sha256:imageSha,bytes:bytes.length,width:decoded.info.width,height:decoded.info.height,source:'spt-pinned-git-object',sourceUrl:`${repositoryUrl}/blob/${commit}/${resolved.repositoryPath}`,sourceCommit:commit,sourcePath:resolved.repositoryPath,sourceSha256:sha256(original),sourceBytes:original.length,gitBlob:resolved.gitBlob};
    cache.set(cacheKey,entry);audit.entries.push({...entry,kind,sourceFormat:meta.format,sourceWidth:meta.width,sourceHeight:meta.height,decoded:true});
  }
  return {...entry,requestedPath,resolution:resolved.resolution,isSourceDefault:/\/default\./.test(requestedPath)};
}

for(const [id,trader] of Object.entries(traders)){
  const entry=await imageEntry('traders',id,trader.avatar);
  if(entry)manifest.traders[id]=entry;
}
let done=0;
for(const [id,quest] of Object.entries(quests)){
  const entry=await imageEntry('quests',id,quest.image);
  if(entry)manifest.quests[id]=entry;
  if(++done%100===0)console.log(`Task images: ${done}/${Object.keys(quests).length}; unique files=${cache.size}`);
}

// Neutral original line icons explicitly serve only as missing-image placeholders.
for(const kind of ['trader','quest']){
  const drawing=kind==='trader'?'<circle cx="96" cy="65" r="21"/><path d="M54 133v-13c0-22 19-35 42-35s42 13 42 35v13"/>':'<path d="M63 35h49l20 20v103H63zM112 35v23h20M77 82h41M77 99h41M77 116h27"/>';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" fill="#171913"/><g fill="none" stroke="#8c7b50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`;
  const bytes=await sharp(Buffer.from(svg)).webp({quality:90}).toBuffer();
  const file=`data/tasks/assets/placeholder-${kind}.webp`;await fs.writeFile(assetFile(file),bytes);manifest.fallback[kind]=file;
  audit.entries.push({kind:'placeholder',file,sha256:sha256(bytes),bytes:bytes.length,width:192,height:192,source:'project-neutral-line-icon',decoded:Boolean((await sharp(bytes).raw().toBuffer()).length)});
}
const namedVisible=Object.entries(quests).filter(([id,q])=>!q.notDisplayedQuest&&Boolean(globalEnglish[q.name]||q.localization?.en?.[q.name]||q.localization?.en?.[`${id} name`]));
manifest.stats={traderRecords:Object.keys(traders).length,traderImages:Object.keys(manifest.traders).length,questRecords:Object.keys(quests).length,questImages:Object.keys(manifest.quests).length,namedVisibleQuests:namedVisible.length,namedVisibleWithImages:namedVisible.filter(([id])=>manifest.quests[id]).length,uniqueSourceImages:cache.size,questImagesUsingSourceDefault:Object.values(manifest.quests).filter(entry=>entry.isSourceDefault).length,generatedFiles:audit.entries.length,totalBytes:audit.entries.reduce((sum,entry)=>sum+entry.bytes,0),missing:manifest.missing.length};
audit.stats=manifest.stats;
// Check every published path and hash after writing, including shared mappings.
for(const entry of audit.entries){
  const bytes=await fs.readFile(assetFile(entry.file));
  if(sha256(bytes)!==entry.sha256)audit.validationErrors.push({file:entry.file,reason:'sha256-mismatch'});
  await sharp(bytes,{failOn:'error'}).raw().toBuffer();
}
if(audit.validationErrors.length)throw new Error('Asset read-back validation failed');
await writeJson(path.join(output,'manifest.json'),manifest);
await writeJson(path.join(auditDirectory,'assets-audit.json'),audit);
await writeJson(path.join(auditDirectory,'assets-source-index.json'),{schemaVersion:1,generatedAt,repository:repositoryUrl,commit,imageRoot,entries:[...files.values()]});
console.log(JSON.stringify(manifest.stats,null,2));
