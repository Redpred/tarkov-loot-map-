import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { FAMILIES, CONTAINERS, LEGACY_LOOT_FAMILIES } from '../site/factory-marker-rules.js';

const root=path.resolve(import.meta.dirname,'..');
const cacheArg=process.argv.indexOf('--cache');
const cache=cacheArg>=0?process.argv[cacheArg+1]:path.join(process.env.LOCALAPPDATA,'Temp/Battlestate Games/EscapeFromTarkov/Icon Cache/live');
const source=JSON.parse(await fs.readFile(path.join(root,'data/atlas/factory-icon-sources.json'),'utf8'));
const archive=path.join(root,'work/atlas-item-icons');
const out=path.join(root,'site/data/icons/factory');
await fs.mkdir(archive,{recursive:true});await fs.mkdir(out,{recursive:true});
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const tile=96,columns=8,entries={},items={},layers=[];

async function add(key,input,meta){
  // These are UI thumbnails, not generated replacements for game artwork.
  const png=await sharp(input).trim().resize(80,80,{fit:'contain',background:'#00000000'}).extend({top:8,bottom:8,left:8,right:8,background:'#00000000'}).png().toBuffer();
  const extension=meta.sourceFile?.endsWith('.svg')?'svg':'webp';
  const bytes=extension==='svg'?input:await sharp(png).webp({quality:92,alphaQuality:100}).toBuffer();
  await fs.writeFile(path.join(out,`${key}.${extension}`),bytes);
  const i=layers.length,x=i%columns*tile,y=Math.floor(i/columns)*tile;
  entries[key]={file:`data/icons/factory/${key}.${extension}`,rect:[x,y,tile,tile],sha256:hash(bytes),...meta};
  layers.push({input:png,left:x,top:y});
}
for(const icon of source.icons){
  const saved=path.join(archive,`${icon.sha256}.png`);
  let bytes;
  try{bytes=await fs.readFile(saved);}catch{
    bytes=await fs.readFile(path.join(cache,icon.cacheFile));
    if(hash(bytes)!==icon.sha256)throw new Error(`${icon.cacheFile}: cache changed; visually verify before updating the source mapping`);
    await fs.writeFile(saved,bytes);
  }
  if(hash(bytes)!==icon.sha256)throw new Error(`Archived source integrity failure: ${icon.key}`);
  await add(icon.key,bytes,{source:'game-icon-cache',sourceSha256:icon.sha256,representative:icon.representative});
  if(icon.tpl)items[icon.tpl]=icon.key;
}


// Supplied map symbols retain their provenance; inventory icons and world
// container symbols are intentionally separate kinds of resource.
const mapNames={
 'container_buried-barrel-cache':'埋藏桶','container_cash-register':'收银机','container_crate':'物资箱',
 'container_dead-scav':'尸体','container_drawer':'抽屉','container_duffle-bag':'旅行包',
 'container_grenade-box':'手榴弹箱','container_jacket':'夹克','container_medbag':'医疗包',
 'container_medcase':'医疗箱','container_pc-block':'电脑主机','container_plastic-suitcase':'塑料行李箱',
 'container_safe':'保险箱','container_toolbox':'工具箱','container_weapon-box':'武器箱',
 'container_wooden-ammo-box':'木制弹药箱','container_wooden-crate':'木箱',
 btr_stop:'BTR 停靠点',extract_pmc:'PMC 撤离点',extract_scav:'Scav 撤离点',extract_shared:'共用撤离点',extract_transit:'转移点',
 hazard:'危险区域',lock:'上锁',loose_loot:'散落物资',quest_item:'任务物品',quest_objective:'任务目标',
 spawn_boss:'Boss 出生点',spawn_pmc:'PMC 出生点',spawn_scav:'Scav 出生点',spawn_sniper_scav:'狙击 Scav',stationarygun:'固定机枪'
};
const supplied={};
for(const file of (await fs.readdir(path.join(root,'icon'))).filter(f=>/\.(png|webp)$/i.test(f)).sort()){
 const stem=path.parse(file).name,key='map-'+stem,bytes=await fs.readFile(path.join(root,'icon',file));
 await add(key,bytes,{source:'user-tarkov.dev-map',sourceFile:'icon/'+file,sourceSha256:hash(bytes),name:mapNames[stem]||stem,representative:mapNames[stem]||stem});
 supplied[stem]=key;
}
const replacements={crate:'container_wooden-crate','technical-crate':'container_crate',safe:'container_safe',duffle:'container_duffle-bag',jacket:'container_jacket',medbag:'container_medbag','grenade-box':'container_grenade-box',toolbox:'container_toolbox',drawer:'container_drawer','weapon-box':'container_weapon-box',body:'container_dead-scav',mixed:'其他',other:'loose_loot'};
for(const [key,stem] of Object.entries(replacements)){
 if(!entries[supplied[stem]])throw new Error('Missing supplied icon: '+stem);
 entries[key]={...entries[supplied[stem]]};
}
// Retain game representatives as inventory artwork. A single-root point must
// not turn into a category symbol just because its representative key is shared.
for(const [tpl,key] of Object.entries(items)){entries['game-'+key]={...entries[key]};items[tpl]='game-'+key;}
const activeSymbols=new Set([...Object.keys(FAMILIES),'mixed',...Object.values(CONTAINERS).map(([key])=>key),'crate']);
for(const key of activeSymbols){
 const sourceFile=`icon/symbols/${key}.svg`,bytes=await fs.readFile(path.join(root,sourceFile));
 const name=FAMILIES[key]?.[0]||Object.values(CONTAINERS).find(([id])=>id===key)?.[1]||(key==='mixed'?'混合物资':'容器');
 await add('symbol-'+key,bytes,{source:'project-svg-symbol',sourceFile,sourceSha256:hash(bytes),name,representative:name});
 entries[key]={...entries['symbol-'+key]};
}
// Preserve existing user settings that refer to the original supplied symbols.
for(const [key,target] of Object.entries(LEGACY_LOOT_FAMILIES)){
 entries[key]={...entries[target]};
 entries['symbol-'+key]={...entries[target]};
}
const legacySymbols={...Object.fromEntries(Object.entries(replacements).map(([key,stem])=>['map-'+stem,key])),
 'map-贵重物品':'valuable','map-医疗物资':'medical','map-注射器':'stim','map-情报物品':'intel','map-赛季文件':'season_document','map-饮品':'drink','map-电子产品':'electronics','map-能源物品':'battery','map-易燃物品':'fuel','map-电子卡':'keycard','map-钥匙':'key','map-容器':'crate'};
// A supplied/legacy alias can share an active container's key. The active
// design takes precedence; otherwise a supply crate becomes a technical crate.
for(const [key,target] of Object.entries(legacySymbols))if(!activeSymbols.has(key))entries[key]={...entries[target]};
for(const [key,entry] of Object.entries(entries))entry.name ||= FAMILIES[key]?.[0]||entry.representative||key;
for(const key of Object.keys(FAMILIES))if(!entries[key])throw new Error('Missing family icon: '+key);
const height=Math.ceil(layers.length/columns)*tile,width=columns*tile;
const atlas=await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite(layers).png().toBuffer();
await fs.writeFile(path.join(out,'atlas.png'),atlas);
const manifest={schemaVersion:2,generatedAt:new Date().toISOString(),atlas:{file:'data/icons/factory/atlas.png',width,height,tile,sha256:hash(atlas)},entries,items,
 note:'Single-root points use verified inventory artwork. Multi-root categories and world containers use project SVG symbols; valuable diamond follows the supplied user symbol. Item pool semantics are unchanged.'};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest));
console.log(JSON.stringify({gameRepresentatives:source.icons.length,suppliedMapIcons:Object.keys(supplied).length,exactItemMappings:Object.keys(items).length,atlasBytes:atlas.length}));
