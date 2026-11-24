import fs from 'node:fs';
import path from 'node:path';
import {ATLAS_MAPS} from '../site/atlas-maps.js';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const source=read('data/spt-source.json'),catalog=read('site/data/atlas-catalog.json'),previews=read('site/previews/manifest.json');
const maps=Object.values(ATLAS_MAPS).map(map=>{
  const issues=[],entry=catalog.maps.find(m=>m.id===map.id),preview=previews.maps[map.id];
  let geometry;
  try{geometry=read('site/'+map.geometry);}catch(error){issues.push('模型清单不可读: '+error.message);}
  for(const file of [map.data,`data/${map.id}-pois.json`,`data/${map.id}-quests.json`,`data/${map.id}-regions.json`]){
    if(!fs.existsSync(path.join(root,'site',file)))issues.push('缺少 '+file);
  }
  if(!entry?.ready)issues.push('首页地图未就绪');
  if(!preview||!fs.existsSync(path.join(root,'site',preview.file)))issues.push('缺少预览');
  else if(geometry){
    if(preview.geometrySha256!==(geometry.sourceGeometrySha256||geometry.sha256))issues.push('预览模型版本已过期');
    if(preview.band!=='all'||preview.recipeVersion!==4)issues.push('预览拍摄方案已过期');
    if(preview.heightRange?.[0]!==geometry.bounds.min[1]-1||preview.heightRange?.[1]!==geometry.bounds.max[1]+1)issues.push('预览高度不完整');
    if(entry?.preview?.sha256!==preview.sha256||entry?.preview?.geometrySha256!==preview.geometrySha256)issues.push('首页目录需重新生成');
  }
  return {id:map.id,name:map.name,ready:issues.length===0,sceneryPolicy:geometry?.sceneryCull?.policyVersion??null,
    sectors:map.streamed?geometry?.sectors?.length:1,previewRecipe:preview?.recipeVersion??null,issues};
});
const result={checkedAt:new Date().toISOString(),root,source:{version:source.version,eftBuild:source.eftBuild,commit:source.commit},
  online:'https://tarkovlootmap.com/',maps,ok:maps.every(m=>m.ready)};
if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
else{
  console.log(`塔科夫物资地图 | EFT build ${source.eftBuild} | SPT ${source.version} (${source.commit.slice(0,7)})`);
  console.table(maps.map(m=>({地图:m.name,状态:m.ready?'就绪':m.issues.join('；'),场外规则:m.sceneryPolicy??'无',分区:m.sectors,预览方案:m.previewRecipe})));
  console.log('本地维护文档（如有）：docs/DEVELOPMENT.md\n这是本地清单检查；不校验全部模型二进制，也不检查线上部署。');
}
if(!result.ok)process.exitCode=1;
