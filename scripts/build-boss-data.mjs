import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {atlasToUnity} from './lib/factory-data.mjs';
import {roleName,zoneName,isMainRole,configurationProbability,verifiedCandidate,inventoryGroups} from './lib/boss-data.mjs';

const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),out=path.resolve(root,args[args.indexOf('--out')+1]||'work/boss-integration-20261020/staged');
if(args.indexOf('--out')<0&&args.length)throw Error('Use --out <directory>');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),inputs=[];
function read(file){const b=fs.readFileSync(path.join(root,file));inputs.push({path:file,sha256:hash(b)});return JSON.parse(b);}
const source=read('data/spt-source.json'),manifest=read('data/bosses/1ee2b75/manifest.json');
if(source.commit!==manifest.commit||source.eftBuild!==manifest.eftBuild)throw Error('Boss/map source mismatch');
for(const f of manifest.files)if(hash(fs.readFileSync(path.join(root,f.path)))!==f.sha256)throw Error('Modified boss source '+f.path);
const db=source.databasePath,zh=read(`${db}/locales/global/ch.json`),en=read(`${db}/locales/global/en.json`),templates=read(`${db}/templates/items.json`);
const iconManifests=['site/data/icons/factory/manifest.json','site/data/icons/items/manifest.json','site/data/icons/items/spt-extras.json'].map(read);
const iconItems=Object.assign({},...iconManifests.map(m=>m.items)),icons=Object.assign({},...iconManifests.map(m=>m.entries));
const roles={},appearances=[],mapData={},rejected=[];
for(const entry of manifest.files.filter(f=>f.path.includes('/bots/types/'))){
  const id=path.basename(entry.path,'.json'),bot=read(entry.path);
  roles[id]={id,name:roleName(id),primary:isMainRole(id),groups:inventoryGroups(bot),appearanceIds:[],sourceSha256:entry.sha256};
}
const variants={
  factory:[['factory4_day','白天'],['factory4_night','夜间']],
  ground_zero:[['sandbox','普通区域'],['sandbox_high','高等级区域']],
  labs:[['laboratory','实验室常规场景'],['laboratory_dark','实验室停电场景']],
};
for(const map of Object.values(ATLAS_MAPS)){
  const atlas=read(`work/tarkmap/out/${map.atlas}/gamedata.json`),loot=read(`site/${map.data}`),geometry=read(`site/${map.geometry}`);
  if(loot.sources.spt?.commit!==source.commit||loot.sources.atlas?.eftBuild!==source.eftBuild)throw Error('Map source mismatch '+map.id);
  const byId=new Map((atlas.spawn_points||[]).filter(p=>p.id).map(p=>[p.id,p])),points=new Map(),mainIds=new Set();
  for(const [location,variant]of variants[map.id]||[[map.spt,'常规场景']]){
    const base=read(`${db}/locations/${location}/base.json`);
    for(const [index,cfg]of (base.BossLocationSpawn||[]).entries()){
      const role=cfg.BossName.toLowerCase();if(!isMainRole(role))continue;
      if(!roles[role])throw Error('Missing role '+role);
      mainIds.add(role);
      const id=`${location}:${index}`,zones=[...new Set((cfg.BossZone||'').split(',').filter(Boolean))];
      const companions=[];
      if(cfg.BossEscortType&&cfg.BossEscortType.toLowerCase()!==role&&String(cfg.BossEscortAmount).split(',').some(n=>+n>0)){
        companions.push({role:cfg.BossEscortType.toLowerCase(),amounts:[...new Set(String(cfg.BossEscortAmount).split(',').map(Number))].filter(Number.isFinite)});
      }
      for(const s of cfg.Supports||[])if(String(s.BossEscortAmount).split(',').some(n=>+n>0))companions.push({role:s.BossEscortType.toLowerCase(),amounts:[...new Set(String(s.BossEscortAmount).split(',').map(Number))].filter(Number.isFinite)});
      const appearance={id,role,mapId:map.id,mapName:map.name,location,variant,zones:zones.map(z=>({id:z,name:zoneName(z)})),probability:configurationProbability(cfg),
        modes:cfg.SpawnMode||[],time:cfg.Time,randomTime:Boolean(cfg.RandomTimeSpawn),delay:cfg.Delay||0,
        triggered:Boolean(cfg.TriggerName||cfg.TriggerId),karma:Boolean(cfg.DependKarma||cfg.DependKarmaPVE),forceSpawn:Boolean(cfg.ForceSpawn),
        companions,pointIds:[],referenceIds:[],sourceIndex:index};
      roles[role].appearanceIds.push(id);for(const c of companions){if(!roles[c.role])throw Error('Missing escort '+c.role);roles[c.role].appearanceIds.push(id);}
      appearances.push(appearance);
      const attach=(p,isReference=false)=>{
        const key=p.id;
        if(!points.has(key))points.set(key,p);
        const current=points.get(key);
        current.bossRefs.push({appearanceId:id,role,companions:companions.map(c=>c.role)});
        (isReference?appearance.referenceIds:appearance.pointIds).push(key);
      };
      for(const zone of zones){
        let count=0;
        for(const s of base.SpawnPointParams||[]){
          if(s.BotZoneName!==zone||!s.Categories?.some(c=>c==='Boss'||role==='pmcbotblackdiv'&&c==='Bot'))continue;
          const result=verifiedCandidate(s,byId.get(s.Id),{allowBot:role==='pmcbotblackdiv'});
          if(!result.position){rejected.push({mapId:map.id,location,appearanceId:id,spawnId:s.Id,...result});continue;}
          attach({id:`boss-point:${map.id}:${s.Id}`,sourceId:s.Id,kind:'poi',poiTypes:['boss'],icon:'map-spawn_boss',
            label:`${zoneName(zone)} · BOSS 候选点`,position:result.position,bossPoint:true,zone,
            range:result.range,coordinateDelta:result.delta,bossRefs:[]});
          count++;
        }
        if(!count){
          const z=atlas.bot_zones?.find(z=>z.name===zone),position=z&&atlasToUnity(z.pos);
          if(position)attach({id:`boss-region:${map.id}:${zone}`,sourceId:zone,kind:'poi',poiTypes:['boss'],icon:'map-spawn_boss',
            label:`${zoneName(zone)} · 区域参考`,position,bossPoint:true,referenceOnly:true,zone,range:null,bossRefs:[]},true);
        }
      }
    }
  }
  for(const p of points.values()){
    p.bossRefs=[...new Map(p.bossRefs.map(r=>[r.appearanceId,r])).values()];
    p.label=`${[...new Set(p.bossRefs.map(r=>roles[r.role].name))].join(' / ')} · ${zoneName(p.zone)}${p.referenceOnly?'（区域参考）':''}`;
  }
  mapData[map.id]={version:1,mapId:map.id,eftBuild:source.eftBuild,sourceCommit:source.commit,
    geometrySha256:geometry.sourceGeometrySha256||geometry.sha256,
    roleIds:[...mainIds],points:[...points.values()]};
}
const items={};
for(const role of Object.values(roles))for(const group of role.groups)for(const item of group.items){
  const tpl=item.tpl,t=templates[tpl],icon=icons[iconItems[tpl]];
  items[tpl]??={id:tpl,name:zh[tpl+' Name']||en[tpl+' Name']||'未命名物品',en:en[tpl+' Name']||'',icon:icon?.file||null,knownTemplate:Boolean(t)};
}
const catalog={version:1,eftBuild:source.eftBuild,eftVersion:source.eftVersion,sourceCommit:source.commit,roles:Object.values(roles),appearances,items};
fs.mkdirSync(path.join(out,'maps'),{recursive:true});
const write=(name,data)=>{const bytes=Buffer.from(JSON.stringify(data));fs.writeFileSync(path.join(out,name),bytes);return {file:`data/bosses/${name}`,sha256:hash(bytes),bytes:bytes.length};};
const runtimeManifest={version:1,eftBuild:source.eftBuild,sourceCommit:source.commit,catalog:write('catalog.json',catalog),maps:{}};
for(const [id,data]of Object.entries(mapData))runtimeManifest.maps[id]=write(`maps/${id}.json`,data);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(runtimeManifest));
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({inputs,sourceManifest:'data/bosses/1ee2b75/manifest.json',rejected,
  rangeMeaning:'Matching point-associated sphere collider, not a patrol boundary or proof of uniform spawning within the sphere.',
  probabilityPolicy:'Only explicit non-triggered, non-karma, non-forced wave configuration; never per-point or item weights.'},null,2));
console.log(JSON.stringify({roles:catalog.roles.length,appearances:appearances.length,items:Object.keys(items).length,
  maps:Object.fromEntries(Object.entries(mapData).map(([id,m])=>[id,{roles:m.roleIds.length,points:m.points.filter(p=>!p.referenceOnly).length,references:m.points.filter(p=>p.referenceOnly).length,ranges:m.points.filter(p=>p.range).length}])),rejected:rejected.length},null,2));
