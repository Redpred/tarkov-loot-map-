import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SEASON_PACKAGE='data/tasks/20261019-season-flow';
export function loadSeasonSupplement(root){
  const file=path.join(root,SEASON_PACKAGE,'manifest.json');
  if(!fs.existsSync(file))return null;
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
  for(const entry of [...manifest.inputs,...manifest.files.map(f=>({...f,path:`${SEASON_PACKAGE}/${f.path}`}))]){
    if(sha(entry.path)!==entry.sha256)throw Error(`Season source hash mismatch: ${entry.path}`);
  }
  return {data:JSON.parse(fs.readFileSync(path.join(root,SEASON_PACKAGE,'supplement.json'),'utf8')),manifestSha256:sha(`${SEASON_PACKAGE}/manifest.json`)};
}

export function applySeasonSupplement(catalog,mapLayers,loaded){
  if(!loaded)return {catalog,mapLayers};
  const {data,manifestSha256}=loaded;
  if(catalog.source.eftBuild!==data.source.positionEftBuild)throw Error('Season position/base client version mismatch');
  const ids=new Set(data.tasks.map(t=>t.id));
  if(ids.size!==data.tasks.length)throw Error('Duplicate season task IDs');
  const replacement=new Map(data.tasks.map(t=>[t.id,t]));
  // Replace by real quest ID, never append a duplicate record or rename progress keys.
  const tasks=catalog.tasks.map(t=>replacement.get(t.id)||t);
  for(const task of data.tasks)if(!catalog.tasks.some(t=>t.id===task.id))tasks.push(task);
  const source={...catalog.source,supplements:[...(catalog.source.supplements||[]).filter(s=>s.id!==data.id),{id:data.id,packagePath:SEASON_PACKAGE,manifestSha256,...data.source}]};
  const next={...catalog,source,tasks,items:{...catalog.items,...data.items}};
  const layers={...mapLayers};
  for(const mapId of new Set(data.points.map(p=>p.mapId))){
    const layer=mapLayers[mapId];if(!layer)throw Error(`Missing season map layer ${mapId}`);
    if(layer.sources?.spt?.eftBuild!==data.source.positionEftBuild)throw Error(`Season map version mismatch ${mapId}`);
    const previous=layer.points.filter(p=>p.seasonSupplement===data.id),retained=layer.points.filter(p=>p.seasonSupplement!==data.id);
    const additions=data.points.filter(p=>p.mapId===mapId).map(p=>p.point);
    if(additions.some(p=>retained.some(old=>old.id===p.id)))throw Error('Season point ID collision');
    const quests=[...layer.quests];
    for(const p of additions)for(const ref of p.questObjectives)if(!quests.some(q=>q.id===ref.questId))quests.push({id:ref.questId,name:ref.name,en:ref.en,trader:ref.trader});
    layers[mapId]={...layer,points:[...retained,...additions],quests,sources:{...layer.sources,seasonSupplement:{id:data.id,manifestSha256,eftBuild:data.source.positionEftBuild}},stats:{...layer.stats,points:retained.length+additions.length,quests:quests.length,clientPoints:layer.stats.clientPoints-previous.length+additions.length}};
  }
  return {catalog:next,mapLayers:layers};
}
