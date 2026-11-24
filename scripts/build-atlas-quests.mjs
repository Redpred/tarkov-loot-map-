import fs from 'node:fs';
import path from 'node:path';
import {requestedMaps} from './lib/atlas-build-maps.mjs';
import {buildAtlasQuests} from './lib/atlas-quests.mjs';
import {SPT_DB,SPT_SOURCE,hasMapLoot} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'..'),db=SPT_DB;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const quests=read(path.join(db,'templates/quests.json')),templates=read(path.join(db,'templates/items.json'));
const locales={ch:read(path.join(db,'locales/global/ch.json')),en:read(path.join(db,'locales/global/en.json'))};
for(const map of requestedMaps()){
  const basePath=path.join(db,`locations/${map.spt}/base.json`),base=fs.existsSync(basePath)?read(basePath):{};
  const mapIds=[base.Id,base._Id,map.spt,map.atlas].filter(Boolean);
  for(const alias of map.sptAliases||[]){const b=read(path.join(db,`locations/${alias}/base.json`));mapIds.push(alias,b.Id,b._Id);}
  if(map.id==='factory'){const night=read(path.join(db,'locations/factory4_night/base.json'));mapIds.push(night.Id,night._Id);}
  const data=buildAtlasQuests({quests,templates,locales,mapIds,sptSource:SPT_SOURCE,
    atlas:read(path.join(root,`work/tarkmap/out/${map.atlas}/gamedata.json`)),
    questScenes:read(path.join(root,`work/tarkmap/out/${map.atlas}/quest-scenes.json`)),
    loot:read(path.join(root,'site',map.data))});
  if(!hasMapLoot(map))data.sources.positions='仅匹配当前客户端任务触发器与任务物品；没有补入旧物资坐标。';
  fs.writeFileSync(path.join(root,`site/data/${map.id}-quests.json`),JSON.stringify(data));
  console.log(map.id,data.stats);
}
