import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {labelField} from '../site/encyclopedia-data.js';
import {bossName,bossFamily,bossVariant,bossContext} from '../site/boss-presentation.js';

// Offline-only derivation. Never pass client installations or credentials here.
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(root,process.argv[process.argv.indexOf('--out')+1]||'work/encyclopedia-20261020/staged');
if(!process.argv.includes('--out'))throw Error('Specify an independent --out directory');
if(!out.startsWith(path.join(root,'work')+path.sep))throw Error('Output must be under work/');
fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const inventory=read('work/eft-collector/data-catalog-20261020-extended.json');
const source={},provenance=[];
for(const entry of inventory.datasets){
  const bytes=fs.readFileSync(path.join(root,entry.file));
  if(sha(bytes)!==entry.sha256)throw Error('Source changed: '+entry.endpoint);
  const response=JSON.parse(bytes);if(response.err!==0)throw Error('Unsuccessful source');
  source[entry.endpoint]=response.data;
  provenance.push({id:entry.endpoint,version:entry.requestedGameVersion,capturedAt:entry.captureTime,sha256:entry.sha256,counts:entry.counts});
}
const sourceManifest=read('data/spt-source.json');
const localeFiles=['ch','en'].map(code=>`${sourceManifest.databasePath}/locales/global/${code}.json`);
const [zh,en]=localeFiles.map(read);
const bossManifest=read('site/data/bosses/manifest.json'),bossCatalog=read('site/'+bossManifest.catalog.file);
const bossMaps=Object.fromEntries(Object.entries(bossManifest.maps).map(([id,m])=>[id,read('site/'+m.file)]));
const items=source.items,handbook=source.handbook,priceMap=new Map(handbook.Items.map(i=>[i.Id,i]));
const name=id=>String(zh[id+' Name']||zh[id]||en[id+' Name']||items[id]?._name||id||'').trim();
const icons=new Map(read('site/data/loot-scanner/catalog.json').items.map(i=>[i.id,i.icon]));
const roleName=bossName;
const files={},sections=[];
function write(file,data){
  const bytes=Buffer.from(JSON.stringify(data)+'\n');
  fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),bytes);
  return files[file]={file:'data/encyclopedia/'+file,sha256:sha(bytes),bytes:bytes.length};
}
function section(id,title,note,rows,sources){
  rows=rows.map(r=>({...r,search:[r.name,r.id,r.group,r.subtitle,r.search].filter(Boolean).join(' ').toLocaleLowerCase()}));
  const info=write(id+'.json',rows);
  sections.push({id,title,note,count:rows.length,sources,resource:info});
}
const row=(id,title,group,detail,extra={})=>({id:String(id),name:title,group,detail,...extra});
const category=id=>{const value=name(priceMap.get(id)?.ParentId||items[id]?._parent||'');return /^[a-f0-9]{24}$/.test(value)?'未命名分类':({ArmorPlate:'防弹插板',BuiltInInserts:'内置防护插板',CultistAmulet:'邪教护符',DialogItem:'对话物品',HideoutAreaContainer:'藏身处容器',Keycard:'钥匙卡',KeyMechanical:'机械钥匙',Other:'其他',RandomLootContainer:'随机物资容器',Rocket:'火箭弹',SortingTable:'整理台',CylinderMagazine:'转轮弹仓',FaceCover:'面部装备',Headwear:'头部装备','Battle Pass documents':'赛季文件'})[value]||value||'其他';};
const itemSummary=(id,t)=>({id,name:name(id),en:en[id+' Name']||'',icon:icons.get(id)||null,group:t._type==='Node'?'分类模板':category(id),subtitle:t._type==='Node'?'分类模板':t._props?.Caliber||'',price:priceMap.get(id)?.Price??null,quest:t._props?.QuestItem===true,ammo:Number.isFinite(t._props?.Damage)&&Boolean(t._props?.Caliber),internal:/DO.?NOT.?USE/i.test(name(id)),market:t._props?.CanSellOnRagfair??null,type:t._type,search:[name(id),en[id+' Name'],t._name,id,t._props?.Caliber].join(' ').toLocaleLowerCase()});
const itemIndex=Object.entries(items).map(([id,t])=>itemSummary(id,t));
for(const item of itemIndex){
  const p=items[item.id]._props||{};
  item.facts=item.ammo?[['伤害',p.Damage],['穿透',p.PenetrationPower]]:p.armorClass?[['护甲等级',p.armorClass],['耐久',p.MaxDurability]]:p.MaxHpResource?[['治疗资源',p.MaxHpResource],['重量',p.Weight+' kg']]:[['重量',p.Weight+' kg'],['占格',p.Width+' × '+p.Height]];
}
const chunks={};
for(const [id,t] of Object.entries(items)){
  const bucket=id.slice(0,2);(chunks[bucket]??={})[id]={...itemSummary(id,t),description:zh[id+' Description']||en[id+' Description']||'',internalName:t._name,parent:t._parent,detail:t._props};
}
const itemChunks=Object.fromEntries(Object.entries(chunks).map(([bucket,rows])=>[bucket,write(`items/${bucket}.json`,rows)]));
section('items','物品与弹药','物品属性、手册基准价与交易标志，含内部模板。基准价不是实时跳蚤价；名称沿用已收录的中文对照。',itemIndex,['items','handbook']);
// Item details stay in lazy-loaded buckets; do not ship 31 MB at page startup.
const mapIds={factory4_day:'factory',factory4_night:'factory',bigmap:'customs',woods:'woods',shoreline:'shoreline',interchange:'interchange',rezervbase:'reserve',tarkovstreets:'streets',lighthouse:'lighthouse',laboratory:'labs',laboratory_dark:'labs',sandbox:'ground_zero',sandbox_high:'ground_zero',sandbox_start:'ground_zero',labyrinth:'labyrinth',terminal:'terminal',terminal_ui:'terminal',icebreaker:'icebreaker'};
const variants={factory4_day:'白天',factory4_night:'夜间',laboratory_dark:bossVariant('laboratory_dark'),laboratory:bossVariant('laboratory'),sandbox:'常规',sandbox_high:'高等级',sandbox_start:'开场',terminal:'剧情场景',terminal_ui:'地图场景'};
const mapSnapshot={version:1,eftVersion:'1.2.5.0.48146',capturedAt:'2026-10-20T06:21:14Z',sourceHash:provenance.find(p=>p.id==='locations').sha256,modeScope:'pvp-gateway',bindings:{},locations:[],waves:[]};
for(const [id,m] of Object.entries(bossManifest.maps))mapSnapshot.bindings[id]={bossMapSha256:m.sha256,geometrySha256:bossMaps[id].geometrySha256};
const bindingAudit=[];
for(const l of Object.values(source.locations.locations)){
  const key=l.Id.toLowerCase(),mapId=mapIds[key]||null,mapName=ATLAS_MAPS[mapId]?.name||l.Name,variant=variants[key]||'常规';
  const publicLocation={id:l.Id,mapId,name:mapName,variant,enabled:l.Enabled,spawns:l.SpawnPointParams.length,bossWaves:l.BossLocationSpawn.length,exits:l.exits?.length||0,transits:l.transits?.length||0};
  mapSnapshot.locations.push(publicLocation);
  for(const [index,w] of l.BossLocationSpawn.entries()){
    const zones=(w.BossZone||'').split(',').map(s=>s.trim()).filter(Boolean),role=w.BossName.toLowerCase();
    const points=[];
    for(const p of bossMaps[mapId]?.points||[]){
      if(p.referenceOnly||!zones.includes(p.zone)||!p.bossRefs.some(r=>r.role===role&&bossCatalog.appearances.find(a=>a.id===r.appearanceId)?.location.toLowerCase()===key))continue;
      const s=l.SpawnPointParams.find(s=>s.Id===p.sourceId);
      const delta=s?Math.hypot(...['x','y','z'].map(axis=>s.Position[axis]-p.position[axis])):null;
      const accepted=Boolean(s&&s.Categories.includes('Boss')&&s.BotZoneName===p.zone&&delta<=0.05);
      bindingAudit.push({location:l.Id,wave:index,point:p.id,delta,accepted});
      if(accepted)points.push({id:p.id,sourceId:p.sourceId,position:s.Position,delta,zone:p.zone});
    }
    mapSnapshot.waves.push({id:`${l.Id}:${index}`,location:l.Id,mapId,mapName,variant,enabled:l.Enabled,role,name:roleName(w.BossName),chance:w.BossChance,modes:w.SpawnMode||[],zones,points,trigger:w.TriggerName||'',triggerId:w.TriggerId||'',time:w.Time,delay:w.Delay,randomTime:w.RandomTimeSpawn,force:w.ForceSpawn,escort:w.BossEscortType,escortAmount:w.BossEscortAmount,supports:w.Supports,raw:w});
  }
}
for(const w of mapSnapshot.waves)w.context=bossContext(w);
write('map-snapshot.json',mapSnapshot);
section('bosses','BOSS 与特殊敌人','按角色合并浏览。常规配置、赛季条件和旧活动分别标注；波次条数不等于 BOSS 数量。',mapSnapshot.waves.map(w=>row(w.id,w.name,w.mapName,w.raw,{subtitle:`${w.mapName} · ${w.variant}`,variant:w.variant,chance:w.chance,enabled:w.enabled,mapId:w.mapId,role:w.role,context:w.context,hasInventory:bossCatalog.roles.some(r=>r.id===w.role),points:w.points,location:w.location,modes:w.modes,search:[w.zones.join(' '),w.role,w.context.label,bossCatalog.roles.find(r=>r.id===w.role)?.name].filter(Boolean).join(' ')})),['locations']);
section('maps','地图规则与撤离','24 个配置条目包含内部与未启用场景，不能等同于 24 张可玩地图。',Object.values(source.locations.locations).map(l=>row(l.Id,ATLAS_MAPS[mapIds[l.Id.toLowerCase()]]?.name||l.Name,l.Enabled?'已启用配置':'未启用配置',{
  Id:l.Id,Enabled:l.Enabled,MinPlayers:l.MinPlayers,MaxPlayers:l.MaxPlayers,EscapeTimeLimit:l.EscapeTimeLimit,DisabledForScav:l.DisabledForScav,RequiredPlayerLevelMin:l.RequiredPlayerLevelMin,RequiredPlayerLevelMax:l.RequiredPlayerLevelMax,exits:l.exits,secretExits:l.secretExits,transits:l.transits,waves:l.waves,SpawnPointParams:l.SpawnPointParams,AirdropParameters:l.AirdropParameters,paths:source.locations.paths.filter(p=>p.Source===l._Id||p.Destination===l._Id)
},{subtitle:variants[l.Id.toLowerCase()]||l.Id,mapId:mapIds[l.Id.toLowerCase()]||null,search:JSON.stringify(l.exits)})),['locations']);
const areas=Object.fromEntries(Object.entries(zh).filter(([k])=>/^hideout_area_\d+_name$/.test(k)).map(([k,v])=>[k.split('_')[2],v]));
const recipes=source['hideout-recipes'];
const duration=s=>`${Math.floor(s/60)} 分${s%60?' '+Math.round(s%60)+' 秒':''}`;
section('crafts','藏身处制作','材料、工具、解锁要求和制作时间。加密配方及只有 ID 的配方不补造产物。',Object.entries(recipes).flatMap(([type,rs])=>rs.map((r,i)=>row(r._id||r.id||String(r),typeof r==='object'&&r.endProduct?name(r.endProduct):type==='cultistRecipes'?'邪教配方记录':`Scav 配方 ${i+1}`,type==='recipes'?(areas[r.areaType]||`设施 ${r.areaType}`):type==='scavRecipes'?'Scav 宝箱':'邪教祭坛',r,{subtitle:r.productionTime!=null?duration(r.productionTime):'未提供制作时间',product:r.endProduct||null,icon:icons.get(r.endProduct)||null,search:typeof r==='object'?(r.requirements||[]).map(v=>name(v.templateId)||v.type).join(' '):''}))),['hideout-recipes']);
section('hideout','藏身处与训练','5 项藏身处参数与 1 组训练。训练包含 15 步；概率与单位未确认的字段按原参数显示。',[
  ...Object.entries(source['hideout-settings']).map(([k,v])=>row(k,({generatorSpeedWithoutFuel:'无燃料运转系数',generatorFuelFlowRate:'发电机燃料消耗参数',airFilterUnitFlowRate:'空气过滤消耗参数',gpuBoostRate:'显卡加成参数',cultistAmuletBonusPercent:'邪教护符加成参数'})[k],'藏身处参数',{[k]:v})),
  ...source['hideout-qte'].map(r=>row(r.id,'健身房训练','训练',r,{subtitle:`${r.quickTimeEvents.length} 步`}))
],['hideout-settings','hideout-qte']);
section('prestige','转生与奖励','查看等级、任务、设施、技能条件及奖励。占位奖励不视为可领取内容。',source.prestige.elements.map((r,i)=>row(r.id,`转生记录 ${i+1}`,'转生',r,{subtitle:`${r.conditions.length} 项条件 · ${r.rewards.length} 项奖励`,search:JSON.stringify(r)})),['prestige']);
section('customization','外观','已收录的服装与部件属性；未提供外观图片和商店售价。',Object.values(source.customization).map(r=>row(r._id,name(r._id)===r._id?r._name:name(r._id),r._type==='Node'?'分类模板':({Body:'上装',Feet:'下装',Hands:'手部',Head:'头部'})[r._props.BodyPart]||'其他部件',r._props,{subtitle:(r._props.Side||[]).join(' · ')})),['customization']);
section('mechanics','机制参数','120 项全局设置及 AI 参数。活动配置存在不代表活动正在启用。',[
  ...Object.entries(source.globals.config).map(([k,v])=>row(k,labelField(k),typeof v==='object'?'参数组':'单项参数',{[k]:v})),
  ...source.globals.bot_presets.map((r,i)=>row(`bot-${i}`,roleName(r.Role||r.name||`AI 预设 ${i+1}`),'AI 参数',r,{subtitle:r.Difficulty||r.BotDifficulty||'',search:JSON.stringify(r)})),
  ...source.globals.BotWeaponScatterings.map((r,i)=>row(`scatter-${i}`,`武器散布 ${i+1}`,'AI 参数',r))
],['globals']);
section('presets','武器与装备预设','按物品 ID 关联预设中的武器、装备和配件。',Object.values(source.globals.ItemPresets).map(r=>{
  const id=r._encyclopedia||r._items.find(i=>i._id===r._parent)?._tpl;
  return row(r._id,name(id)||r._name,'物品组合',r,{subtitle:r._name,icon:icons.get(id)||null,search:r._items.map(i=>name(i._tpl)).join(' ')});
}),['globals']);
const parsed='work/eft-collector/parsed-task-market-20261020-1630/';
const parsedSummary=read(parsed+'summary.json'),derivedSources=[];
for(const file of ['task-item-references.json','task-reference-index.json']){
  const bytes=fs.readFileSync(path.join(root,parsed,file)),info=parsedSummary.files[file];
  if(bytes.length!==info.bytes||sha(bytes)!==info.sha256)throw Error('Derived source changed: '+file);
  derivedSources.push({file,sha256:info.sha256,bytes:info.bytes});
}
section('market','跳蚤规则','交易规则与等级限制。手册基准价不是实时行情；尚未取得实时挂单与价格。',Object.entries(source.globals.config.RagFair).map(([k,v])=>row(k,labelField(k),'交易规则',{[k]:v})),['globals','items','handbook']);
section('handbook','手册分类','90 个手册类别及各类交易等级参数。具体物品的基准价在“物品与弹药”中查看。',handbook.Categories.map(c=>row(c.Id,name(c.Id),c.ParentId?name(c.ParentId):'顶级分类',{Id:c.Id,ParentId:c.ParentId,RagfairLevelToTrade:c.RagfairLevelToTrade,Order:c.Order},{subtitle:c.RagfairLevelToTrade==null?'未单独设定交易等级':`分类交易等级 ${c.RagfairLevelToTrade}`})),['handbook']);
const notes=source['main-quest-notes'];
section('story','主线与任务关联','包含章节、笔记和关联索引，尚未取得完整任务正文、目标与奖励；笔记没有正文。',[
  ...source['main-quests'].chapters.map((r,i)=>row(r.ChapterId,`主线章节记录 ${i+1}`,'章节',r,{subtitle:`${notes.filter(n=>n.chapterId===r.ChapterId).length} 条笔记`})),
  ...notes.map((r,i)=>row(r.id,`主线笔记 ${i+1}`,'笔记',r,{subtitle:r.chapterId,search:JSON.stringify(r)})),
  ...read(parsed+'task-item-references.json').map(r=>row(r.templateId,name(r.templateId),'任务物品',r,{icon:icons.get(r.templateId)||null})),
  ...read(parsed+'task-reference-index.json').map(r=>row(r.questId,zh[r.questId+' name']||r.questId,'任务引用',r,{subtitle:`${r.references.length} 条关联`}))
],['main-quests','main-quest-notes','items','prestige']);
section('media','磁带与字幕','磁带时间轴与字幕；可用的官方文本由阅读资料补充，不提供音频播放。',[
  ...source.tapes.map((r,i)=>row(r.id,`磁带 ${i+1}`,'磁带',r,{subtitle:`${r.subtitles.length} 段时间轴`})),
  ...source['subtitle-tracks'].map((r,i)=>row(r.id,`字幕轨道 ${i+1}`,'字幕',r,{subtitle:`${r.subtitles.length} 段时间轴`}))
],['tapes','subtitle-tracks']);
section('languages','语言与提示','20 种支持语言和 24 条中文菜单提示，尚无完整中文语言包。',[
  ...Object.entries(source.languages).map(([k,v])=>row(k,v,'支持语言',{code:k,name:v})),
  ...Object.entries(source['menu-locale-ch'].menu).map(([k,v])=>row(k,v,'中文提示',{original:k,text:v}))
],['languages','menu-locale-ch']);
const countRoles=new Set(mapSnapshot.waves.map(w=>bossFamily(w.role))).size;
const metrics={
  items:[[itemIndex.filter(i=>i.type==='Item').length,'件物品'],[itemIndex.filter(i=>i.ammo&&i.type==='Item').length,'种弹药'],[itemIndex.filter(i=>i.type==='Node').length,'个分类模板']],
  bosses:[[countRoles,'类敌人'],[mapSnapshot.waves.length,'条生成波次'],[mapSnapshot.waves.filter(w=>w.context.kind==='history').length,'条旧活动记录']],
  maps:[[Object.keys(ATLAS_MAPS).length,'张三维地图'],[mapSnapshot.locations.length,'个配置场景'],[mapSnapshot.locations.filter(l=>!l.enabled).length,'个未启用场景']],
  crafts:[[recipes.recipes.length,'个普通配方'],[recipes.scavRecipes.length,'个 Scav 配方'],[recipes.cultistRecipes.length,'条祭坛记录']],
  hideout:[[Object.keys(source['hideout-settings']).length,'项设施设置'],[source['hideout-qte'].length,'组训练'],[source['hideout-qte'].reduce((n,q)=>n+q.quickTimeEvents.length,0),'个训练步骤']],
  prestige:[[source.prestige.elements.length,'条转生记录'],[source.prestige.elements.reduce((n,r)=>n+r.conditions.length,0),'项条件'],[source.prestige.elements.reduce((n,r)=>n+r.rewards.length,0),'条奖励']],
  customization:[[Object.values(source.customization).filter(c=>c._type!=='Node').length,'个外观部件'],[Object.values(source.customization).filter(c=>c._type==='Node').length,'个分类模板']],
  mechanics:[[Object.keys(source.globals.config).length,'项全局设置'],[source.globals.bot_presets.length,'组 AI 预设'],[source.globals.BotWeaponScatterings.length,'组散布参数']],
  presets:[[Object.keys(source.globals.ItemPresets).length,'组物品预设']],
  market:[[Object.keys(source.globals.config.RagFair).length,'项交易规则'],[handbook.Items.length,'条手册基准价'],[0,'条实时行情']],
  handbook:[[handbook.Categories.length,'个手册类别']],
  story:[[source['main-quests'].chapters.length,'个章节索引'],[notes.length,'条笔记索引'],[read(parsed+'task-reference-index.json').length,'个任务引用']],
  media:[[source.tapes.length,'条磁带时间轴'],[source['subtitle-tracks'].length,'条字幕轨道']],
  languages:[[Object.keys(source.languages).length,'种语言'],[Object.keys(source['menu-locale-ch'].menu).length,'条中文提示']],
};
for(const s of sections){s.metrics=metrics[s.id];s.displayCount=metrics[s.id][0][0];s.unit=metrics[s.id][0][1].replace(/^(件|种|个|条|类|张|组|项)/,'');}
write('manifest.json',{version:1,presentationVersion:2,eftVersion:'1.2.5.0.48146',date:'2026-10-20',sections,itemChunks,mapSnapshot:files['map-snapshot.json'],sources:provenance,
  counts:{templates:itemIndex.length,items:itemIndex.filter(i=>i.type==='Item').length,ammo:itemIndex.filter(i=>i.type==='Item'&&i.ammo).length,categories:handbook.Categories.length,handbookPrices:handbook.Items.length,bossWaves:mapSnapshot.waves.length,bossIdentities:countRoles,spawnConfigs:mapSnapshot.locations.reduce((n,l)=>n+l.spawns,0),recipes:recipes.recipes.length,scavRecipes:recipes.scavRecipes.length,customizations:Object.keys(source.customization).length,presets:Object.keys(source.globals.ItemPresets).length,notes:notes.length,prestige:source.prestige.elements.length,taskItems:read(parsed+'task-item-references.json').length,taskIds:read(parsed+'task-reference-index.json').length},
  derivedSources,areas,displayNames:{eftVersion:sourceManifest.eftVersion,files:localeFiles.map(file=>({sha256:sha(fs.readFileSync(path.join(root,file)))}))}});
fs.writeFileSync(path.join(out,'../binding-audit.json'),JSON.stringify({checks:bindingAudit,accepted:bindingAudit.filter(r=>r.accepted).length,uniquePoints:new Set(bindingAudit.filter(r=>r.accepted).map(r=>r.point)).size},null,2));
console.log(JSON.stringify({out,sections:sections.map(s=>({id:s.id,count:s.count})),files:Object.keys(files).length,verifiedPoints:new Set(bindingAudit.filter(r=>r.accepted).map(r=>r.point)).size}));
