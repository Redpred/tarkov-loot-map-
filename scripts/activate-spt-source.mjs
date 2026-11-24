import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {looseCandidates} from './lib/factory-data.mjs';
const root=path.resolve(import.meta.dirname,'..');
const arg=process.argv.indexOf('--source'),file=arg>=0?path.resolve(root,process.argv[arg+1]):null;
if(!file?.startsWith(root+path.sep))throw new Error('Pass --source with a verified source.json inside this project');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),source=read(file),db=path.resolve(root,source.databasePath);
if(!db.startsWith(root+path.sep)||!source.files||!Number.isInteger(source.eftBuild))throw new Error('Invalid source manifest');
for(const [name,expected] of Object.entries(source.files)){
  const target=path.resolve(db,name);if(!target.startsWith(db+path.sep))throw new Error('Invalid database member');
  const bytes=fs.readFileSync(target);
  if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error(`Database hash mismatch: ${name}`);
  read(target);
}
const templates=read(path.join(db,'templates/items.json')),quests=read(path.join(db,'templates/quests.json')),maps={};
for(const map of fs.readdirSync(path.join(db,'locations'))){
  const file=path.join(db,'locations',map,'looseLoot.json');if(!fs.existsSync(file))continue;
  const loot=read(file),rows=[...loot.spawnpointsForced,...loot.spawnpoints];
  let missing=0,unresolved=0;
  for(const row of rows){
    if(!row.template?.Position||!['x','y','z'].every(k=>Number.isFinite(row.template.Position[k])))throw new Error(`Invalid position in ${map}`);
    const parsed=looseCandidates(row);unresolved+=parsed.unresolved.length;
    missing+=parsed.candidates.filter(c=>!templates[c.tpl]).length;
  }
  if(unresolved||missing)throw new Error(`${map}: ${unresolved} unresolved candidates, ${missing} missing templates`);
  maps[map]={loose:loot.spawnpoints.length,forced:loot.spawnpointsForced.length};
}
const report={source:source.version,commit:source.commit,eftVersion:source.eftVersion,files:Object.keys(source.files).length,items:Object.keys(templates).length,quests:Object.keys(quests).length,maps};
fs.writeFileSync(path.join(root,'data/spt-audit.json'),JSON.stringify(report,null,2));
fs.copyFileSync(file,path.join(root,'data/spt-source.json'));
console.log(JSON.stringify(report,null,2));
