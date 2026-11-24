import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {buildTaskCatalog} from './lib/task-system-data.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const folder='data/tasks/20261019-season-flow';
const input='work/season-complete-flow-20261019/complete-flow-records.json';
const rows=read(input).rows,byLabel=new Map(rows.map(r=>[r.label,r]));
const id=label=>byLabel.get(label).gameId;
const inputs=read('work/season-complete-flow-20261019/source-inputs.json');
for(const entry of inputs.files)assert.equal(hash(entry.localPath),entry.sha256);
assert.equal(hash(inputs.communityFile.path),inputs.communityFile.sha256);
const sourceFile=p=>inputs.files.find(x=>x.relativePath===p).localPath;
const fullQuests=read(sourceFile('database/templates/quests.json'));
const locales={ch:read(sourceFile('database/locales/global/ch.json')),en:read(sourceFile('database/locales/global/en.json'))};
const base='data/tasks/20261013-901f569/raw/spt/database';
const templates=read(base+'/templates/items.json');
const current=read('site/data/tasks/catalog.json');
const icons=Object.fromEntries(Object.entries(current.items).map(([key,x])=>[key,x.icon]));
const locationBases=Object.fromEntries(fs.readdirSync(path.join(root,base,'locations')).flatMap(name=>{
  const p=`${base}/locations/${name}/base.json`;return fs.existsSync(path.join(root,p))?[[name,read(p)]]:[];
}));
const traders=Object.fromEntries(current.traders.map(t=>[t.en||t.name,t.id]));
const sptQuests=Object.fromEntries(rows.filter(r=>r.spt).map(r=>[r.gameId,fullQuests[r.gameId]]));
const spt=buildTaskCatalog({quests:sptQuests,templates,locales,maps:Object.values(ATLAS_MAPS),locationBases,icons}).catalog;
const mapNames={'海岸线':'shoreline','街区':'streets','中心区':'ground_zero','海关':'customs','森林':'woods','实验室':'labs','立交桥':'interchange','灯塔':'lighthouse','储备站':'reserve'};
const mapList=(...names)=>[...new Set(names.flat().filter(Boolean))];
const derivedId=(label,kind,index)=>`season:${label.toLowerCase()}:${kind}:${index+1}`;
const items={...spt.items};
function register(item){
  if(!/^[a-f0-9]{24}$/.test(item.id))return;
  const t=templates[item.id];
  items[item.id]={name:locales.ch[`${item.id} Name`]||item.localizedName||item.name,en:locales.en[`${item.id} Name`]||item.name||'',icon:icons[item.id]||null,questItem:!!t?._props?.QuestItem};
}
for(const row of rows)for(const item of row.community.requirements.items||[])for(const value of item.members||[item])register(value);
const itemOptions=item=>(item?.members||[item]).filter(Boolean).map(x=>x.id).filter(x=>/^[a-f0-9]{24}$/.test(x));
const armor=itemOptions(byLabel.get('A04').community.requirements.items[0]);
function objective(row,index,{text=row.community.objectives[index],maps=[],type='Manual',count=1,itemIds=[],foundInRaid=false,details=[],raw={},preparation=[]}={}){
  const objectiveId=row.label==='A02'?'6a4f54977f8bf26ebdf5efd0':derivedId(row.label,'goal',index);
  return {id:objectiveId,type,index,text,en:'',textSource:'reviewed-community',originalText:row.community.objectives[index],textMissing:false,count,showCount:true,details,optional:false,foundInRaid,itemIds,mapIds:maps,unmappedLocations:[],locationScope:maps.length?'specific':'unspecified',
    raw:{id:objectiveId,conditionType:type,value:count,onlyFoundInRaid:foundInRaid,...(itemIds.length?{target:itemIds}:{}),...raw},sourceQuestId:row.gameId,parentConditions:[],preparation};
}
const kill=(count,target='AnyPmc',extras={})=>({type:'CounterCreator',count,raw:{counter:{conditions:[{conditionType:'Kills',target,...extras}]}}});
const tasks=[];
for(const row of rows){
  let task;
  if(row.spt){
    task=spt.tasks.find(t=>t.id===row.gameId);
    // Same IDs are retained for existing tasks and their checklists.
    if(row.label==='B09')task.objectives[0].text='上交 3 个等级至少 30 的 PMC 狗牌（不要求战局中找到）';
    const mapOverrides={B01:[['labs'],['labs'],['labs']],B02:[['customs'],['customs'],['customs'],['customs']],B03:[[]],B04:[['woods'],['woods'],['woods','customs'],['customs'],['customs','shoreline'],['shoreline']],B05:[[]],B06:[[]],B07:[[]],B08:[['labs']],B09:[[]],B10:[['reserve'],['streets'],['customs']],B11:[['lighthouse'],[],[],['lighthouse']]};
    task.objectives.forEach((o,i)=>{o.mapIds=mapOverrides[row.label][i];o.locationScope=o.mapIds.length?'specific':'nonspatial';});
    if(row.label==='B06'){task.objectives[0].relatedTaskIds=[id('B07')];task.notes=['先接取本任务，再向维和者完成“一败涂地”，最后回来完成本任务。'];}
    if(row.label==='B01')task.notes=['藏匿硬盘后必须同局从通风管道撤离；使用其他主要撤离口或放置后死亡、转移会触发失败条件。','剧情入口：在 Tour 故事章节了解终点站情况后，与机械师谈及和灯塔商人合作。'];
    if(row.label==='B04')task.notes=['森林 → 海关 → 海岸线，按顺序在同一场连续转移战局中完成。'];
    if(row.label==='B10')task.notes=['储备站和街区各选一处任务认可的符号房；海关为宿舍 314。按选定房间准备钥匙。'];
    if(row.label==='B11')task.notes=['在灯塔污水处理厂寻找 V3 U 盘，在情报中心处理收发器；完成后进入灯塔小岛。','灯塔商人声望不高于 0 会触发任务失败。'];
  }else{
    const community=row.community,objectives=community.objectives.map((_,i)=>objective(row,i));
    task={id:row.gameId,name:row.name,en:row.english,traderId:traders[community.merchant],group:'core',groupUnspecified:false,groupSource:'reviewed-season-flow',tierAccessory:null,loyaltyLevel:community.requireLoyalty||null,level:null,description:'',imageKey:row.gameId,prerequisites:[],dependencies:[],objectives,mapIds:[],isStoryQuest:false,side:'Pmc',chainIds:[],conditions:{},rewards:{},communityRewards:community.rewards,nameSource:'versioned-spt-name',notes:[]};
    assert.ok(task.traderId,community.merchant);
    const set=(i,settings)=>objectives[i]=objective(row,i,settings);
    const handover=(i,item)=>set(i,{type:'HandoverItem',count:Number(item.quantity)||1,itemIds:itemOptions(item),foundInRaid:!!item.foundInRaid});
    switch(row.label){
      case 'A01':set(0,{maps:['shoreline']});task.notes=['军事装备箱候选位置：东侧红白铁塔下的小屋、气象站二楼、水电站二楼。成功带出后交给 BTR 司机。'];break;
      case 'A02':set(0,{maps:['woods','streets']});break;
      case 'A03':case 'A05':objectives.forEach((o,i)=>set(i,{maps:[['shoreline','streets','ground_zero'][Math.floor(i/2)]],...(row.label==='A03'?{type:'LeaveItemAtLocation',itemIds:itemOptions(community.requirements.items[0])}:{})}));break;
      case 'A04':case 'A06':case 'A07':case 'A08':handover(0,community.requirements.items[0]);break;
      case 'A09':objectives.forEach((o,i)=>set(i,{maps:[['shoreline','streets','ground_zero'][i]],...kill(6,'Savage'),preparation:[{kind:'穿戴装备',options:armor.map(x=>[x]),quantity:1,consumed:false,label:'黑色军团插板胸挂'}]}));break;
      case 'A10':set(0,{maps:['streets']});task.notes=['交付分支：将笔记本交给 Fence，或接取“决断的后果”后交给机械师。任一分支完成后可继续“绝望反击”。'];break;
      case 'A11':task.notes=['使用一级情报中心解密并阅读数据；将笔记本交给机械师。这是“最后冲刺”的另一交付分支。'];break;
      case 'A12':set(0,{maps:['labs'],...kill(15,'Savage')});break;
      case 'A13':objectives.forEach((o,i)=>set(i,{maps:[i<2?'customs':'woods'],type:'CounterCreator'}));break;
      case 'A14':set(0,{type:'Manual'});task.notes=['使用一级情报中心处理黑色军团加固手提电脑，再上交其中的数据。'];break;
      case 'P01':objectives.forEach((o,i)=>set(i,{maps:['ground_zero'],details:['需要在同一次战局中完成']}));objectives[0].preparation=[{kind:'放置物品',options:[],quantity:1,consumed:true,label:'任务信件'}];break;
      case 'P02':community.requirements.items.forEach((item,i)=>handover(i,item));break;
      case 'P03':objectives.forEach((o,i)=>set(i,{maps:['shoreline'],type:'LeaveItemAtLocation',itemIds:itemOptions(community.requirements.items[0])}));break;
      case 'C01':{
        const route=['shoreline','lighthouse','reserve','woods'],texts=['从海岸线转移到灯塔','从灯塔转移到储备站','从储备站转移到森林','途中消灭 10 个非黑色军团目标'];
        objectives.forEach((o,i)=>set(i,{text:texts[i],maps:i<3?route.slice(i,i+2):route,details:['需要在同一场连续转移战局中完成'],...(i===3?kill(10,'Any'): {})}));task.notes=['到灯塔地图当面找灯塔商人接取。路线：海岸线 → 灯塔 → 储备站 → 森林。'];break;
      }
      case 'C02':{
        const texts=['在立交桥 20:00–08:00 消灭 3 个任意目标','找到 Burger Spot 洗手间的隐藏门禁卡面板','找到隐藏的 TerraGroup 安全室','在集装箱内取得箱子','从立交桥转移到街区','在酒店大楼三楼阳台藏匿箱子','在街区污水河撤离点附近发射黄色信号弹'];
        objectives.forEach((o,i)=>set(i,{text:texts[i],maps:i<4?['interchange']:i===4?['interchange','streets']:['streets'],details:['需要在同一场连续转移战局中完成'],...(i===0?kill(3,'Any',{daytime:{from:20,to:8}}):{})}));
        objectives[6].preparation=[{kind:'信号弹',options:[],quantity:1,consumed:true,label:'黄色信号弹'}];task.notes=['箱子在集装箱内取得。'];break;
      }
      case 'C03':{
        const places=['海关宿舍 314 符号房','森林废弃村庄仪式房','街区 8 号公寓二楼仪式房'];
        objectives.forEach((o,i)=>set(i,{maps:[['customs','woods','streets'][Math.floor(i/2)]],...(i%2===0?{...kill(3,'AnyPmc',{daytime:{from:22,to:8}}),text:`在${['海关','森林','街区'][i/2]} 22:00–08:00 击杀 3 名 PMC`}:{text:`在${places[Math.floor(i/2)]}藏匿 3 个狗牌`,preparation:[{kind:'放置物品',options:[],quantity:3,consumed:true,label:'PMC 狗牌'}]})}));task.notes=['完成本任务后，本赛季任务流程结束。'];break;
      }
    }
  }
  task.seasonFlowId='kord-breach';task.seasonStage=row.label[0];task.flowOrder=rows.indexOf(row);task.flowLabel=row.label;
  if(!row.spt)task.seasonId='kord-breach';
  task.mapAssociation='verified-only';task.mapIds=mapList(task.objectives.flatMap(o=>o.mapIds));
  task.source={kind:row.spt?'spt':'reviewed-supplement',sptCommit:row.spt?inputs.sptCommit:null,eftBuild:row.spt?48146:null,record:row.label};
  tasks.push(task);
}
const byId=new Map(tasks.map(t=>[t.id,t]));
function prerequisite(label,previous,{accepted=false,any=false,delay=0,details=[]}={}){
  const task=byId.get(id(label)),taskIds=(Array.isArray(previous)?previous:[previous]).map(id),status=[accepted?2:4];
  const text=`${accepted?'接取':'完成'}${taskIds.map(x=>`“${byId.get(x).name}”`).join(any?'或':'及')}${delay?`后等待 ${delay/60} 分钟`:''}`;
  task.prerequisites.push({id:derivedId(label,'pre',task.prerequisites.length),type:'Quest',taskId:taskIds[0],taskIds,status,match:any?'any':'all',positiveDependency:true,text,details,raw:{conditionType:'Quest',target:taskIds,status,availableAfter:delay},textSource:'reviewed-flow'});
}
for(const [label,prev,opts] of [['A02','A01',{accepted:true}],['A03','A02'],['A04','A03'],['A05','A04'],['A06','A05'],['A07','A06'],['A08','A07'],['A09','A08'],['A10','A09'],['A11','A10',{accepted:true}],['A12',['A10','A11'],{any:true}],['A13','A12'],['A14','A13'],['P01','A01',{accepted:true}],['P02','A05'],['P03','A12',{accepted:true}],['C01',['A14','B11']],['C02','C01'],['C03','C02']])prerequisite(label,prev,opts);
const manualPre=(label,text)=>byId.get(id(label)).prerequisites.push({id:derivedId(label,'note',1),type:'Manual',text,details:[],raw:{}});
manualPre('A01','需要赛季模式');
byId.get(id('A01')).prerequisites.push({id:'season:a01:loyalty',type:'TraderLoyalty',text:'Prapor 信任度至少 2',details:[],raw:{target:traders.Prapor,value:2,compareMethod:'>='}});
manualPre('A05','完成前置后等待 0–1 小时');
byId.get(id('A06')).level=20;manualPre('A06','角色等级至少 20');
manualPre('C01','进入灯塔地图，当面找灯塔商人接取');
for(const t of tasks){t.dependencies=[...new Set(t.prerequisites.filter(p=>p.positiveDependency).flatMap(p=>p.taskIds||[]))];}
const evidencePath='work/season-inspection-20261014/season-evidence.json',evidence=read(evidencePath);
const target=byId.get(id('A13')),points=[];
for(const [i,e] of [...evidence.taskObjects].sort((a,b)=>a.objectId.localeCompare(b.objectId)).entries()){
  assert.equal(e.taskId,target.id);assert.equal(e.class,'ShootableQuestLocationObject');
  target.objectives[i].id=e.conditionId;target.objectives[i].raw.id=e.conditionId;
  const o=target.objectives[i];
  points.push({mapId:e.map,point:{id:`quest:season:${e.objectId}`,sourceId:e.objectId,kind:'poi',quest:true,poiTypes:['quest_zone'],position:e.position,outline:[],positionSource:'eft-47965-direct-task-object',icon:'map-quest_objective',sceneVariants:[e.scene],candidate:false,
    questObjectives:[{questId:target.id,name:target.name,en:target.en,trader:'Mechanic',objectiveId:o.id,index:i,text:o.text,conditionType:o.type,count:1,plantTime:0,items:[],locations:[e.map]}],label:`打破锁链 · 无线电中继器`,note:'摧毁无线电中继器',searchText:`打破锁链 Break the Chain ${o.text}`,seasonSupplement:'20261019-season-flow'},evidence:{path:evidencePath,taskId:e.taskId,conditionId:e.conditionId,objectId:e.objectId,componentId:e.componentId,scene:e.scene,eftBuild:47965}});
}
const sourceFiles=[input,'work/season-spt-priority-20261019/user-corrections.json','work/season-user-review-20261019-1792398768411/user-corrections.json',evidencePath,base+'/templates/items.json',...inputs.files.map(x=>x.localPath),inputs.communityFile.path];
const supplement={schemaVersion:1,id:'20261019-season-flow',source:{sptCommit:inputs.sptCommit,eftBuild:48146,positionEftBuild:47965,policy:'SPT structured conditions take precedence; user-confirmed flow; community fills missing fields only',metadataItemBuild:47965},tasks,items,points};
fs.mkdirSync(path.join(root,folder),{recursive:true});
fs.writeFileSync(path.join(root,folder,'supplement.json'),JSON.stringify(supplement));
fs.writeFileSync(path.join(root,folder,'manifest.json'),JSON.stringify({schemaVersion:1,id:supplement.id,source:supplement.source,inputs:sourceFiles.map(p=>({path:p,sha256:hash(p)})),files:[{path:'supplement.json',sha256:hash(folder+'/supplement.json')}],counts:{tasks:tasks.length,sptTasks:11,communitySupplementTasks:20,verifiedPoints:points.length}},null,2)+'\n');
console.log(JSON.stringify({folder,tasks:tasks.length,objectives:tasks.reduce((n,t)=>n+t.objectives.length,0),points:points.length}));
