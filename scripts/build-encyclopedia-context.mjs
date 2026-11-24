import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {plainLocale} from '../site/encyclopedia-explain.js';
const root=path.resolve(import.meta.dirname,'..'),arg=n=>process.argv.includes(n)?process.argv[process.argv.indexOf(n)+1]:null;
const out=path.resolve(root,arg('--out')||'');
if(!out.startsWith(path.join(root,'work')+path.sep))throw Error('Use a separate work/ output directory');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8'));
const catalog=path.resolve(root,arg('--catalog')||'site/data/encyclopedia'),manifest=read(path.join(catalog,'manifest.json'));
const source=read('data/spt-source.json'),localeBytes=fs.readFileSync(path.resolve(root,source.databasePath,'locales/global/ch.json')),locale=JSON.parse(localeBytes);
const enBytes=fs.readFileSync(path.resolve(root,source.databasePath,'locales/global/en.json')),en=JSON.parse(enBytes);
const taskPath='work/eft-ru-slow-task-market-20261020/parsed/task-definitions.json',taskBytes=fs.readFileSync(path.resolve(root,taskPath)),tasks=JSON.parse(taskBytes);
if(tasks.provenance.requestedGameVersion!==manifest.eftVersion)throw Error('Task association version mismatch');
const section=id=>{const info=manifest.sections.find(s=>s.id===id).resource;const bytes=fs.readFileSync(path.join(catalog,path.basename(info.file)));if(hash(bytes)!==info.sha256||bytes.length!==info.bytes)throw Error('Section fingerprint mismatch');return JSON.parse(bytes);};
const names={},subtitles={},craftTasks={};
for(const tape of section('media'))for(const s of tape.detail.subtitles||[]){const text=locale[s.id]||en[s.id];if(text)subtitles[s.id]={text:plainLocale(text),language:locale[s.id]?'ch':'en'};}
for(const t of tasks.tasks){const text=locale[t.name]||en[t.name];if(text)names[t._id]=plainLocale(text);}
for(const [alias,key] of Object.entries({Standard:'standard',LeftBehind:'left_behind',PrepareForEscape:'prepare_for_escape',EdgeOfDarkness:'edge_of_darkness',Unheard:'eod_tue_edition'})){
  const text=locale['EProfileVersion/'+key]||locale[key]||en['EProfileVersion/'+key];if(text){names[alias]=plainLocale(text);names[key]=plainLocale(text);}
}
for(const craft of section('crafts')){
  if(!(craft.detail.requirements||[]).some(r=>r.type==='QuestComplete'))continue;
  const matches=[];
  for(const t of tasks.tasks)for(const reward of t.rewards?.Success||[]){
    if(reward.type!=='ProductionScheme')continue;
    const item=(reward.items||[]).find(i=>i._id===reward.target);
    if(item?._tpl===craft.detail.endProduct&&reward.traderId===craft.detail.areaType&&(craft.detail.requirements||[]).some(r=>r.type==='Area'&&r.areaType===reward.traderId&&r.requiredLevel===reward.loyaltyLevel))
      matches.push({taskId:t._id,name:names[t._id]||null,gameMode:reward.gameMode??null,editions:reward.availableInGameEditions??null});
  }
  if(matches.length)craftTasks[craft.id]=matches;
}
const data={version:1,provenance:{eftVersion:manifest.eftVersion,localeVersion:source.eftVersion||source.eftBuild,localeSha256:hash(localeBytes),englishLocaleSha256:hash(enBytes),taskDefinitionsSha256:hash(taskBytes),taskCaptureId:tasks.provenance.captureId,taskScope:'Saved task templates from one regular profile; not a complete global task list. Reward associations do not fill missing recipe condition IDs.'},names,subtitles,craftTasks};
fs.mkdirSync(out,{recursive:true});const bytes=Buffer.from(JSON.stringify(data)+'\n');fs.writeFileSync(path.join(out,'reader-context.json'),bytes);
manifest.readerContext={file:'data/encyclopedia/reader-context.json',sha256:hash(bytes),bytes:bytes.length};manifest.presentationVersion=4;
for(const s of manifest.sections)if(s.id==='prestige'){s.title='转生与奖励';s.note='查看转生条件、奖励及可转移内容；模式与版本限制分别列出。';}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest)+'\n');
console.log(JSON.stringify({out,subtitles:Object.keys(subtitles).length,taskNames:Object.keys(names).length,craftAssociations:Object.keys(craftTasks).length,bytes:bytes.length}));
