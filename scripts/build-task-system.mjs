import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {buildAtlasQuests} from './lib/atlas-quests.mjs';
import {buildTaskCatalog,createTaskMapIndex,createMapTaskQuests} from './lib/task-system-data.mjs';
import {loadSeasonSupplement,applySeasonSupplement} from './lib/season-task-supplement.mjs';
import {rebindTaskVolumes} from './lib/task-volume-binding.mjs';

const root=path.resolve(import.meta.dirname,'..');
const catalogOnly=process.argv.includes('--catalog-only');
const packagePath='data/tasks/20261013-901f569',pkg=path.join(root,packagePath),db=path.join(pkg,'raw/spt/database');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest=read(path.join(pkg,'manifest.json')),pointer=read(path.join(root,'data/task-source.json'));
if(pointer.packagePath!==packagePath||hash(path.join(pkg,'manifest.json'))!==pointer.manifestSha256)throw Error('Pinned task manifest mismatch');
// Verify the immutable prepared package before deriving published data.
for(const entry of manifest.files){const file=path.join(pkg,entry.path);if(hash(file)!==entry.sha256)throw Error(`Task source hash mismatch: ${entry.path}`);}
const source={packagePath,manifestSha256:pointer.manifestSha256,sptCommit:manifest.spt.commit,version:manifest.spt.version,eftBuild:manifest.eft.build,localization:'SPT game ch dictionary; quest-local text precedes global text',grouping:'tierAccessory 0 = core, 1..4 = loyalty groups; absent fields flagged, not inferred',coordinateSystem:'Unity XYZ; existing renderer flips Z once'};
const quests=read(path.join(db,'templates/quests.json')),templates=read(path.join(db,'templates/items.json'));
const locales={ch:read(path.join(db,'locales/global/ch.json')),en:read(path.join(db,'locales/global/en.json'))};
const maps=Object.values(ATLAS_MAPS),locationBases={};
for(const name of fs.readdirSync(path.join(db,'locations'))){const file=path.join(db,'locations',name,'base.json');if(fs.existsSync(file))locationBases[name]=read(file);}
const mapIndex=createTaskMapIndex(maps,locationBases),traderBases={};
for(const name of fs.readdirSync(path.join(db,'traders'))){const file=path.join(db,'traders',name,'base.json');if(fs.existsSync(file))traderBases[name]=read(file);}
const visibleQuests=createMapTaskQuests(quests,locales);
const questLoot=read(path.join(pkg,'derived/spt-quest-loot.json')),mapLayers={},mapAudit=[];
const repairPath='data/tasks/20261013-901f569-point-repairs',repairManifest=read(path.join(root,repairPath,'manifest.json'));
for(const file of repairManifest.files)if(hash(path.join(root,repairPath,file.path))!==file.sha256)throw Error(`Task repair hash mismatch: ${file.path}`);
for(const file of repairManifest.sourceFiles)if(hash(path.join(root,file.path))!==file.sha256)throw Error(`Task repair input mismatch: ${file.path}`);
const repairs=read(path.join(root,repairPath,'positions.json'));
if(repairs.source.sptCommit!==source.sptCommit||repairs.source.eftBuild!==source.eftBuild)throw Error('Task repair version mismatch');
if(hash(path.join(root,repairs.source.clientSnapshotManifest))!==repairs.source.clientSnapshotManifestSha256)throw Error('Copied client manifest mismatch');
source.positionSupplement={path:repairPath,manifestSha256:hash(path.join(root,repairPath,'manifest.json'))};
for(const map of maps){
  if(catalogOnly){
    const layer=read(path.join(root,`site/data/tasks/maps/${map.id}.json`));
    const prior=layer.sources?.spt;
    if(layer.sources?.taskPackage!==packagePath||prior?.sptCommit!==source.sptCommit||prior?.manifestSha256!==source.manifestSha256||prior?.eftBuild!==source.eftBuild||prior?.positionSupplement?.manifestSha256!==source.positionSupplement.manifestSha256)throw Error(`Existing task map source mismatch: ${map.id}`);
    mapLayers[map.id]=layer;mapAudit.push({id:map.id,...layer.stats});continue;
  }
  const pointRecords=questLoot.records.filter(record=>mapIndex.get(record.location.toLowerCase())===map.id);
  const points=pointRecords.map(record=>{
    const raw=record.raw,template=raw.template,rows=template.Items||[];
    return {kind:'loose',id:record.id,sourceId:template.Id,position:template.Position,groupPositions:template.GroupPositions||[],positionSource:`spt-${source.eftBuild}`,
      candidates:record.questItemTemplateIds.map(tpl=>({tpl,weight:rows.some(item=>item._tpl===tpl)?1:0}))};
  });
  const atlas=read(path.join(pkg,`raw/eft/maps/${map.id}/gamedata.json`)),questScenes=read(path.join(pkg,`raw/eft/maps/${map.id}/quest-scenes.json`));
  const mapIds=[...mapIndex.entries()].filter(([,id])=>id===map.id).map(([alias])=>alias);
  points.push(...repairs.storyLoot.filter(p=>p.mapId===map.id));
  const layer=buildAtlasQuests({quests:visibleQuests,templates,locales,mapIds,sptSource:source,atlas,questScenes,positionSupplement:repairs.maps[map.id],loot:{points,sources:{spt:source}}});
  layer.sources.taskPackage=packagePath;layer.sources.positions='Same-build copied EFT task triggers and pinned SPT quest-item candidates; no inferred kill coordinates';
  mapLayers[map.id]=layer;mapAudit.push({id:map.id,...layer.stats});
}
const icons={};
for(const file of ['site/data/icons/items/manifest.json','site/data/icons/items/spt-extras.json']){
  const doc=read(path.join(root,file));
  for(const [key,entry] of Object.entries(doc.entries||{})){const id=entry.tpl||key.replace(/^item-/,'');if(entry.file&&fs.existsSync(path.join(root,'site',entry.file)))icons[id]=entry.file;}
}
const taskAssetsPath=path.join(root,'site/data/tasks/assets/manifest.json');
if(fs.existsSync(taskAssetsPath))for(const [id,entry] of Object.entries(read(taskAssetsPath).items||{}))if(entry.file&&fs.existsSync(path.join(root,'site',entry.file)))icons[id]=entry.file;
const built=buildTaskCatalog({quests,templates,locales,maps,locationBases,traderBases,icons,mapLayers,questVariables:read(path.join(db,'templates/questVariables.json')),questChains:read(path.join(db,'templates/questChains.json')),dialogue:read(path.join(db,'templates/dialogue.json')),production:read(path.join(db,'hideout/production.json')),source});
const supplemented=applySeasonSupplement(built.catalog,mapLayers,loadSeasonSupplement(root));
const catalog=supplemented.catalog,audit=built.audit;
if(catalogOnly)for(const map of maps)if(JSON.stringify(mapLayers[map.id])!==JSON.stringify(supplemented.mapLayers[map.id]))throw Error('Season map supplement needs updating first: npm run tasks:season');
Object.assign(mapLayers,supplemented.mapLayers);
Object.assign(audit.counts,{tasks:catalog.tasks.length,objectives:catalog.tasks.reduce((n,t)=>n+t.objectives.length,0),items:Object.keys(catalog.items).length,
  groups:Object.fromEntries(['core','1','2','3','4'].map(g=>[g,catalog.tasks.filter(t=>t.group===g).length])),
  unassignedGroups:catalog.tasks.filter(t=>t.groupUnspecified).length,collectionOrUnspecified:catalog.tasks.filter(t=>!t.mapIds.length).length});
const volumeUpdates=[];
if(!catalogOnly)for(const [id,layer] of Object.entries(mapLayers)){
  const baseFile=path.join(root,`site/data/tasks/maps/${id}.json`),volumeFile=path.join(root,`site/data/tasks/volumes/${id}.json`);
  if(fs.existsSync(baseFile)&&fs.existsSync(volumeFile))volumeUpdates.push([volumeFile,rebindTaskVolumes(read(volumeFile),read(baseFile),layer)]);
}
const output=path.join(root,'site/data/tasks'),auditDir=path.join(root,'work/task-system-20261013');
fs.mkdirSync(path.join(output,'maps'),{recursive:true});fs.mkdirSync(auditDir,{recursive:true});
fs.writeFileSync(path.join(output,'catalog.json'),JSON.stringify(catalog));
if(!catalogOnly)for(const [id,layer] of Object.entries(mapLayers))fs.writeFileSync(path.join(output,`maps/${id}.json`),JSON.stringify(layer));
for(const [file,value] of volumeUpdates)fs.writeFileSync(file,JSON.stringify(value));
for(const row of mapAudit)Object.assign(row,mapLayers[row.id].stats);
const report={source:catalog.source,counts:audit.counts,groupingEvidence:{labels:Object.fromEntries(Object.entries(locales.ch).filter(([key])=>key.startsWith('UI/Quests/TraderAccessoryGroup/'))),nullableModel:'reference/spt-code/Libraries/SPTushonka.Server.Core/Models/Eft/Common/Tables/Quest.cs:145; int? TierAccessory; no initializer',policy:source.grouping},maps:mapAudit,omitted:audit.omitted,warnings:audit.warnings,missingIcons:Object.keys(catalog.items).filter(id=>!catalog.items[id].icon),sourceFilesVerified:manifest.files.length,generatedFiles:[path.join(output,'catalog.json'),...maps.map(m=>path.join(output,`maps/${m.id}.json`))].map(file=>({file:path.relative(root,file).replaceAll('\\','/'),sha256:hash(file)}))};
fs.writeFileSync(path.join(auditDir,'catalog-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({counts:audit.counts,maps:mapAudit,missingIcons:report.missingIcons.length,sourceFilesVerified:manifest.files.length},null,2));
