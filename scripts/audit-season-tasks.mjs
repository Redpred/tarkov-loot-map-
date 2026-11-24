import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const pointer=read('data/task-source.json'),base=pointer.packagePath+'/raw/spt/database/';
if(hash(pointer.manifestPath)!==pointer.manifestSha256)throw Error('Task manifest mismatch');
const inputs=['locales/global/en.json','locales/global/ch.json','templates/quests.json','templates/questChains.json','templates/dialogue.json','season/active.json'];
const manifest=read(pointer.manifestPath);
for(const file of inputs){const record=manifest.files.find(entry=>entry.path==='raw/spt/database/'+file);if(!record||hash(base+file)!==record.sha256)throw Error('Source mismatch: '+file);}
const [en,ch,quests,chains,dialogue,active]=inputs.map(f=>read(base+f));
const candidates=Object.entries(en).filter(([key,value])=>/^[a-f\d]{24} name$/.test(key)&&String(value).startsWith('[KORD BREACH]')).map(([key,en])=>{
  const id=key.split(' ')[0];
  return {id,name:ch[key]||null,en,hasTemplate:Boolean(quests[id]),chainIds:Object.entries(chains.elements).filter(([,ids])=>ids.includes(id)).map(([chain])=>chain),
    dialogueReferences:dialogue.elements.filter(d=>JSON.stringify(d).includes(id)).map(d=>({id:d.Id,trader:d.Trader})),
    missing:quests[id]?[]:['confirmedActiveMembership','issuingTrader','prerequisites','objectiveConditions','questImage']};
});
const result={schemaVersion:1,checkedAt:new Date().toISOString(),status:'blocked_by_missing_primary_templates',
  source:{packagePath:pointer.packagePath,sptCommit:pointer.sptCommit,eftBuild:pointer.eftBuild,files:inputs.map(file=>({path:base+file,sha256:hash(base+file)}))},
  seasonId:active.season.id,localizedCandidates:candidates.length,completeTemplates:candidates.filter(c=>c.hasTemplate).length,candidates,
  notes:['Localized names and ordered chain arrays do not establish current availability or exact prerequisites.','Dialogue trader references are not necessarily the issuing trader.','No task runtime catalogue or map layer was changed by this audit.','The holiday eventQuests config is not a PvP season quest roster.'],
  communityCrossCheck:{url:'https://json.tarkov.dev/pvp-season/tasks',activated:false}};
const community='work/ammo-tasks-20261014/community-season-research.json';
if(fs.existsSync(path.join(root,community))){const tasks=read(community).data.tasks;Object.assign(result.communityCrossCheck,{file:community,sha256:hash(community),totalTasks:Object.keys(tasks).length,matchingSeasonCandidates:candidates.filter(c=>tasks[c.id]).length});}
const out=path.join(root,'work/ammo-tasks-20261014/season-audit.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({localizedCandidates:result.localizedCandidates,completeTemplates:result.completeTemplates,community:result.communityCrossCheck},null,2));
