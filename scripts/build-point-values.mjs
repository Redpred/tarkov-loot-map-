import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {SPT_DB,SPT_SOURCE} from './lib/spt-source.mjs';
import {looseCandidates} from './lib/factory-data.mjs';
import {positive,normalized,roundEven,adjustedStaticWeight,forcedCapPlan,groupedContainerProbability,ungroupedContainerProbabilities,looseSelectionProbabilities,containerContents} from './lib/point-value-model.mjs';

const root=path.resolve(import.meta.dirname,'..'),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const commit='1ee2b758d2584958f103316ba3f3155f8fbe103e';
if(SPT_SOURCE.commit!==commit)throw new Error('Point model rules require the pinned 1ee2b75 source');
const configDir=path.join(root,'data/point-values/1ee2b75'),config=read(path.join(configDir,'location.json')),itemConfig=read(path.join(configDir,'item.json')),season=read(path.join(configDir,'seasonalevents.json'));
const lootConfig=read(path.join(configDir,'loot.json'));
if(Object.values(lootConfig.looseLoot).some(rows=>rows.length))throw new Error('Custom loose additions require a new source adapter');
const templates=read(path.join(SPT_DB,'templates/items.json')),globals=read(path.join(configDir,'globals.json'));
for(const preset of itemConfig.customItemGlobalPresets||[])if(!globals.ItemPresets[preset._id])globals.ItemPresets[preset._id]=preset;
const itemConstants=fs.readFileSync(path.join(configDir,'ItemTpl.cs'),'utf8'),seasonCode=fs.readFileSync(path.join(configDir,'SeasonalEventService.cs'),'utf8');
const inactive=new Set();
for(const block of seasonCode.matchAll(/(?:Christmas|Halloween)EventItems\s*=\s*\[([\s\S]*?)\]/g))for(const match of block[1].matchAll(/ItemTpl\.(\w+)/g)){
  const line=itemConstants.split('\n').find(line=>line.includes(' '+match[1]+' '));const tpl=line?.match(/"([a-f0-9]{24})"/)?.[1];if(!tpl)throw new Error('Missing seasonal constant: '+match[1]);inactive.add(tpl);
}
const blocked=new Set([...inactive,...itemConfig.lootableItemBlacklist]),christmasContainers=new Set(season.christmasContainerIds);
const bases={money:'543be5dd4bdc2deb348b4569',ammo:'5485a8684bdc2da71d8b4567',box:'543be5cb4bdc2deb348b4568',mag:'5448bc234bdc2d3c308b4569',weapon:'5422acb9af1c889c16000029'};
function is(tpl,base){const seen=new Set();while(tpl&&!seen.has(tpl)){if(tpl===base)return true;seen.add(tpl);tpl=templates[tpl]?._parent;}return false;}
const presets=new Map();for(const p of Object.values(globals.ItemPresets||{}))if(p._encyclopedia)presets.set(p._encyclopedia,p._items);
const itemCache=new Map();
function itemModel(candidate,kind){
  const {tpl}=candidate,key=JSON.stringify([candidate,kind]);if(itemCache.has(key))return itemCache.get(key);
  const props=templates[tpl]?._props,result={tpl,width:props?.Width,height:props?.Height,money:is(tpl,bases.money),coefficients:[],issues:[]};
  if(!props){result.issues.push('missing-template');return result;}
  let tree=[{tpl,count:candidate.count??1},...(candidate.included||[])];
  if(is(tpl,bases.money)||is(tpl,bases.ammo)){
    const count=props.StackMaxSize===1?1:(props.StackMinRandom+props.StackMaxRandom)/2;
    if(!Number.isFinite(count)||count<1)result.issues.push('unknown-stack');else result.coefficients.push([tpl,count]);
  }else if(is(tpl,bases.box)){
    // The disposable box is not separately sold; quote the generated cartridges.
    const slot=props.StackSlots?.[0],ammo=slot?._props?.filters?.[0]?.Filter?.[0],count=slot?._max_count;
    if(ammo&&count>0)result.coefficients.push([ammo,count]);else result.issues.push('unknown-ammo-box');
  }else{
    if(kind==='container'&&presets.has(tpl))tree=presets.get(tpl).map(i=>({tpl:i._tpl,count:i.upd?.StackObjectsCount??1}));
    if(config.tplsToStripChildItemsFrom.includes(tpl))tree=tree.slice(0,1);
    const assembly=is(tpl,bases.weapon)||tree.length>1||kind==='container'&&(props.Slots?.length>0&&['Headwear','Vest','Armor'].some(name=>{let id=tpl;const seen=new Set();while(id&&!seen.has(id)){seen.add(id);if(templates[id]?._name===name)return true;id=templates[id]?._parent;}return false;}));
    if(assembly){
      // The market endpoint does not specify which preset is included in a root
      // quote. Keep this branch explicitly incomplete, never add both prices.
      result.issues.push('assembly-price');
    }else if(props.QuestItem){result.issues.push('quest-only');}
    else result.coefficients.push([tpl,candidate.count??1]);
    if(kind==='loose'&&is(tpl,bases.mag))result.issues.push('magazine-ammo');
    if(kind==='container'&&is(tpl,bases.weapon)){
      const extra={Up:0,Down:0,Left:0,Right:0},forced={...extra};
      for(const item of tree){const p=templates[item.tpl]?._props;if(!p){result.issues.push('unknown-size');continue;}for(const side of Object.keys(extra)){if(p.ExtraSizeForceAdd)forced[side]+=p['ExtraSize'+side]||0;else extra[side]=Math.max(extra[side],p['ExtraSize'+side]||0);}}
      result.width+=extra.Left+extra.Right+forced.Left+forced.Right;result.height+=extra.Up+extra.Down+forced.Up+forced.Down;
    }
  }
  itemCache.set(key,result);return result;
}
const outDir=path.join(root,'site/data/point-values');fs.mkdirSync(outDir,{recursive:true});
const mapArg=process.argv.indexOf('--map'),maps=mapArg<0?Object.values(ATLAS_MAPS):[ATLAS_MAPS[process.argv[mapArg+1]]];
const report=[];
for(const map of maps){
  if(!map)throw new Error('Unknown map');
  const dataFile=path.join(root,'site',map.data),data=read(dataFile),loc=path.join(SPT_DB,'locations',map.spt),sourceFiles={};
  for(const name of ['looseLoot.json','staticContainers.json','staticLoot.json','statics.json']){
    const file=path.join(loc,name);if(fs.existsSync(file)){sourceFiles[name]=sha(file);if(data.sources.spt?.files[name]!==sourceFiles[name])throw new Error(`${map.id}: stale atlas input ${name}`);}
  }
  const raw=Object.keys(sourceFiles).length?read(path.join(loc,'looseLoot.json')):{spawnpoints:[],spawnpointsForced:[]};
  const rawStatics=Object.keys(sourceFiles).length?read(path.join(loc,'statics.json')):{containers:{}};
  const loose=data.points.filter(p=>p.kind==='loose').map(p=>({...p,disabled:/^christmas/i.test(p.sourceId)||!p.forced&&!p.alwaysSpawn&&(config.looseLootBlacklist[map.spt]||[]).includes(p.sourceId)}));
  for(const [id,chance] of Object.entries(lootConfig.looseLootSpawnPointAdjustments[map.spt]||{})){const p=loose.find(p=>!p.forced&&p.sourceId===id);if(p)p.sourceWeight=chance;}
  const selection=looseSelectionProbabilities(loose,{...data.spawnpointCount,multiplier:config.looseLootMultiplier[map.spt]??config.looseLootMultiplier.default,samples:4096});
  const containers=data.points.filter(p=>p.kind==='container'),randomGroups=new Map(),containerP=new Map(),settings=config.containerRandomisationSettings;
  for(const p of containers){
    if(!p.pool){containerP.set(p.id,null);continue;}
    if(christmasContainers.has(p.sourceId)){containerP.set(p.id,0);continue;}
    if(p.sourceWeight===1||p.alwaysSpawn||settings.containerTypesToNotRandomise.includes(p.containerTpl)||!settings.enabled||!Object.hasOwn(settings.maps,map.spt)){containerP.set(p.id,1);continue;}
    const mapping=rawStatics.containers[p.sourceId];if(!mapping){containerP.set(p.id,null);continue;}
    const group=mapping.groupId||'',rows=randomGroups.get(group)||[];if(!rows.some(row=>row.sourceId===p.sourceId))rows.push(p);randomGroups.set(group,rows);
  }
  for(const [id,points] of randomGroups){
    const weights=points.map(p=>p.sourceWeight);if(!id){const probabilities=ungroupedContainerProbabilities(weights);points.forEach((p,i)=>containerP.set(p.id,probabilities[i]));continue;}
    const group=data.containerGroups?.[id];if(!group){points.forEach(p=>containerP.set(p.id,0));continue;}
    const min=roundEven(group.minContainers*settings.containerGroupMinSizeMultiplier),max=roundEven(group.maxContainers*settings.containerGroupMaxSizeMultiplier);
    points.forEach(p=>containerP.set(p.id,groupedContainerProbability(p.sourceWeight,weights,min,max)));
  }
  const models={},modelKeys=new Map(),points={},limits=config.lootMaxSpawnLimits[map.spt]||{};
  const staticLimited=new Set(containers.flatMap(p=>[...(data.pools[p.pool]?.items||[]),...(p.forcedItems||[])].filter(c=>Object.hasOwn(limits,c.tpl)&&!blocked.has(c.tpl)).map(c=>c.tpl)));
  const capPlan=forcedCapPlan(loose.map(p=>({...p,rootTpl:(p.forced?raw.spawnpointsForced:raw.spawnpoints)[Number(p.id.split(':')[1])]?.template?.Items?.[0]?._tpl})),limits,staticLimited);
  const intern=(key,build)=>{if(modelKeys.has(key))return modelKeys.get(key);const id=String(modelKeys.size),model=build();models[id]=model;modelKeys.set(key,id);return id;};
  for(const p of data.points){
    if(!['container','loose'].includes(p.kind))continue;
    let model,probability,error=0,issues=[];
    if(p.kind==='container'){
      probability=containerP.get(p.id)??null;const pool=data.pools[p.pool];
      if(!pool){points[p.id]={probability:null,issues:['missing-content']};continue;}
      const candidates=pool.items.map(c=>({...c,weight:adjustedStaticWeight(c.weight,lootConfig.staticItemWeightAdjustment[map.spt]?.[c.tpl])})).filter(c=>!blocked.has(c.tpl)&&positive(c.weight));
      const capped=candidates.some(c=>Object.hasOwn(limits,c.tpl));if(capped)issues.push('global-limit');
      model=intern(JSON.stringify(['container',p.pool,p.forcedItems]),()=>{
        const grid=templates[p.containerTpl]?._props?.Grids?.[0]?._props;
        return containerContents({items:candidates.map(c=>({...itemModel(c,'container'),weight:c.weight})),counts:pool.countDistribution,width:grid?.cellsH,height:grid?.cellsV,
          forced:(p.forcedItems||[]).map(c=>itemModel(c,'container')),multiplier:config.staticLootMultiplier[map.spt]??config.staticLootMultiplier.default,allowDuplicates:config.allowDuplicateItemsInStaticContainers,fitAttempts:config.fitLootIntoContainerAttempts});
      });
    }else{
      ({probability,error}=selection.get(p.id)||{probability:null});
      let candidates=p.candidates||[];
      if(p.forced||p.alwaysSpawn){const source=(p.forced?raw.spawnpointsForced:raw.spawnpoints)[Number(p.id.split(':')[1])];const item=source?.template?.Items?.[0];if(item){const copy={...source,itemDistribution:[],template:{...source.template,Root:item._id}};candidates=looseCandidates(copy).candidates;}}
      candidates=candidates.filter(c=>!blocked.has(c.tpl));
      const forced=p.forced||p.alwaysSpawn,cap=capPlan.allowed.get(p.id);
      if(forced&&cap===false)probability=0;
      if(forced&&cap===null||!forced&&candidates.some(c=>Object.hasOwn(limits,c.tpl)&&!capPlan.exhausted.has(c.tpl)))issues.push('global-limit');
      if(!forced)candidates=candidates.map(c=>({...c,suppressed:capPlan.exhausted.has(c.tpl)}));
      model=intern(JSON.stringify(['loose',candidates]),()=>{
        if(candidates.length>1&&candidates.some(c=>c.weight==null))return {stock:null,coefficients:[],issues:['missing-weights']};
        const rows=normalized(candidates.map(c=>({...c,weight:c.weight??(candidates.length===1?1:0)}))),coefficients=new Map(),reasons=new Set();
        let stock=0;for(const row of rows){if(row.suppressed)continue;stock+=row.weight;const generated=itemModel(row,'loose');for(const [tpl,q] of generated.coefficients)coefficients.set(tpl,(coefficients.get(tpl)||0)+q*row.weight);generated.issues.forEach(code=>reasons.add(code));}
        return {stock:Math.min(1,stock),roots:stock,coefficients:[...coefficients],issues:[...reasons]};
      });
    }
    // Shared caps couple maps and contents. Until that branch is calibrated,
    // affected points have no claimed final probability or ordinary price tier.
    if(issues.includes('global-limit'))probability=null;
    points[p.id]={model,probability,error,issues};
  }
  const payload={schemaVersion:1,map:map.id,generatedAt:new Date().toISOString(),source:{commit,eftBuild:SPT_SOURCE.eftBuild,atlasSHA256:sha(dataFile),templatesSHA256:sha(path.join(SPT_DB,'templates/items.json')),modelSHA256:sha(new URL('./lib/point-value-model.mjs',import.meta.url)),builderSHA256:sha(new URL(import.meta.url)),files:sourceFiles,configs:Object.fromEntries(fs.readdirSync(configDir).map(f=>[f,sha(path.join(configDir,f))])),season:'inactive',containerMultiplicity:'one-physical-container',selectionSamples:4096,contentSamples:8192},models,points};
  // Stable significant digits keep sparse derived files compact, preserving tiny tails.
  const json=JSON.stringify(payload,(_,v)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(10)):v);
  fs.writeFileSync(path.join(outDir,map.id+'.json'),json);
  const stat={map:map.id,points:Object.keys(points).length,models:Object.keys(models).length,bytes:Buffer.byteLength(json),incomplete:Object.values(points).filter(p=>p.probability==null||p.issues.length||models[p.model]?.issues.length).length};report.push(stat);console.log(JSON.stringify(stat));
}
fs.mkdirSync(path.join(root,'work/point-value-20261016'),{recursive:true});fs.writeFileSync(path.join(root,'work/point-value-20261016/build-report.json'),JSON.stringify(report,null,2));
