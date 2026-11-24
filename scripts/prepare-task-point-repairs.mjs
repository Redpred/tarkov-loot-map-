import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {createTaskMapIndex} from './lib/task-system-data.mjs';
import {looseCandidates} from '../site/factory-data.js';

const root=path.resolve(import.meta.dirname,'..'),pkg='data/tasks/20261013-901f569';
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const db=`${pkg}/raw/spt/database`,quests=read(`${db}/templates/quests.json`),templates=read(`${db}/templates/items.json`);
const maps=Object.values(ATLAS_MAPS),bases={};
for(const name of fs.readdirSync(path.join(root,db,'locations')))if(fs.existsSync(path.join(root,db,'locations',name,'base.json')))bases[name]=read(`${db}/locations/${name}/base.json`);
const mapIndex=createTaskMapIndex(maps,bases),storyItems=new Set();
function collect(node){if(!node||typeof node!=='object')return;if(node.conditionType==='CompletableItem')for(const id of Array.isArray(node.target)?node.target:[node.target])if(templates[id])storyItems.add(id);for(const value of Object.values(node))if(typeof value==='object')Array.isArray(value)?value.forEach(collect):collect(value);}
Object.values(quests).forEach(q=>collect(q.conditions));
const provenance=read(`${pkg}/reference/spt-loot-input-provenance.json`),sourceFiles=[],storyLoot=[];
for(const input of provenance.completeInputs){
  if(!input.verifiedMatchesLatestCommit||hash(input.projectInputPath)!==input.sha256)throw Error(`Unverified latest task loot: ${input.projectInputPath}`);
  sourceFiles.push({path:input.projectInputPath,sha256:input.sha256,commit:input.commit});
  const mapId=mapIndex.get(input.id.toLowerCase());if(!mapId)continue;
  const loot=read(input.projectInputPath);
  for(const key of ['spawnpoints','spawnpointsForced'])for(const [index,row] of (loot[key]||[]).entries()){
    const candidates=looseCandidates(row).candidates.filter(c=>(c.weight==null||c.weight>0)&&storyItems.has(c.tpl));
    if(!candidates.length)continue;
    storyLoot.push({mapId,kind:'loose',sourceId:row.template.Id,position:row.template.Position,groupPositions:row.template.GroupPositions||[],candidates,
      positionSource:'spt-47965-story',sourceEvidence:{path:input.projectInputPath,pointer:`/${key}/${index}`,sha256:input.sha256,commit:input.commit}});
  }
}
const inspection='work/task-repair-20261013/client-inspection',clientManifest=read(`${inspection}/manifest.json`);
if(clientManifest.version!=='1.2.0.0.47965')throw Error('Wrong client snapshot');
for(const file of clientManifest.files)if(hash(file.path)!==file.sha256)throw Error(`Copied client input changed: ${file.path}`);
sourceFiles.push({path:`${inspection}/manifest.json`,sha256:hash(`${inspection}/manifest.json`)});
const result={schemaVersion:1,source:{packagePath:pkg,sptCommit:provenance.commit,eftBuild:47965,clientSnapshotManifest:`${inspection}/manifest.json`,clientSnapshotManifestSha256:hash(`${inspection}/manifest.json`)},sourceFiles,storyLoot,maps:{}};
const kinds={PlaceItemTrigger:'place_item',ExperienceTrigger:'visit',FlareShootDetectorZone:'flare',QuestTrigger:'quest'};
for(const map of maps){
  const file=`${inspection}/${map.id}.json`,rows=read(file),atlas=read(`${pkg}/raw/eft/maps/${map.id}/gamedata.json`),scene=read(`${pkg}/raw/eft/maps/${map.id}/quest-scenes.json`);
  sourceFiles.push({path:file,sha256:hash(file)});
  const key=(id,kind,p)=>`${id.trim()}:${kind}:${[p.x,p.y,p.z].map(n=>n.toFixed(2)).join(',')}`;
  const existing=new Set([...(atlas.quest_triggers||[]),...(scene.quest_triggers||[])].filter(r=>r.active!==false).map(r=>key(r.name,r.kind,{x:-r.pos[0],y:r.pos[1],z:r.pos[2]})));
  const zones=[],transits=[];
  const evidence=r=>({path:file,level:r.level,componentId:r.componentId,gameObjectId:r.gameObjectId,class:r.class});
  for(const row of rows){
    if(!row.active)continue;
    const kind=kinds[row.class];
    if(kind&&row.zoneId&&!existing.has(key(row.zoneId,kind,row.position))){
      const k=key(row.zoneId,kind,row.position);existing.add(k);
      zones.push({name:row.zoneId,kind,position:row.position,outline:row.outline,active:true,lv:row.level,sourceEvidence:evidence(row)});
    }
    if(row.class==='TransitPoint'){
      const transitId=Buffer.from(row.payloadHex,'hex').readInt32LE(0);
      const definitions=(bases[map.spt]?.transits||[]).filter(t=>t.id===transitId&&t.active!==false);
      if(definitions.length!==1)continue;
      transits.push({name:definitions[0].name,transitId,position:row.position,outline:row.outline,active:true,sourceEvidence:{...evidence(row),definition:`${db}/locations/${map.spt}/base.json`,definitionId:transitId,field:'TransitPoint payload int32@0'}});
    }
  }
  result.maps[map.id]={zones,transits,interactions:[]};
}
const interactionFile='work/task-repair-20261013/verified-interactions.json';
if(fs.existsSync(path.join(root,interactionFile))){sourceFiles.push({path:interactionFile,sha256:hash(interactionFile)});for(const row of read(interactionFile))result.maps[row.mapId].interactions.push(row);}
const out='data/tasks/20261013-901f569-point-repairs';fs.mkdirSync(path.join(root,out),{recursive:true});
fs.writeFileSync(path.join(root,out,'positions.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(root,out,'manifest.json'),JSON.stringify({schemaVersion:1,source:result.source,generatedAt:new Date().toISOString(),files:[{path:'positions.json',sha256:hash(`${out}/positions.json`)}],sourceFiles},null,2));
console.log(JSON.stringify({storyTemplates:storyItems.size,storySpawns:storyLoot.length,maps:Object.fromEntries(Object.entries(result.maps).map(([id,m])=>[id,{zones:m.zones.length,transits:m.transits.length,interactions:m.interactions.length}]))},null,2));
