import fs from 'node:fs';
import path from 'node:path';
import {ATLAS_MAPS,atlasMapHref} from '../site/atlas-maps.js';
import {SPT_SOURCE} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'../site');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const previews=fs.existsSync(path.join(root,'previews/manifest.json'))?read('previews/manifest.json').maps:{};
const maps=Object.values(ATLAS_MAPS).map(map=>{
  const files=[map.data,map.geometry,`data/${map.id}-pois.json`,`data/${map.id}-quests.json`,`data/${map.id}-regions.json`];
  const exists=files.every(file=>fs.existsSync(path.join(root,file)));
  const data=exists?read(map.data):null,quests=exists?read(files[3]):null;
  const ready=exists&&data.sources.atlas.eftBuild===SPT_SOURCE.eftBuild&&data.sources.spt?.commit===SPT_SOURCE.commit;
  return {id:map.id,name:map.name,en:map.en,href:atlasMapHref(map.id),preview:previews[map.id]||null,ready,
    stats:data?.stats,quests:quests?.stats.quests||0,clientOnly:data?.sources.clientOnly??Boolean(map.clientOnly),
    note:data?.sources.note||'',spt:data?.sources.spt,client:data?.sources.atlas.clientVersion};
});
fs.writeFileSync(path.join(root,'data/atlas-catalog.json'),JSON.stringify({generatedAt:new Date().toISOString(),maps},null,2));
console.log('Atlas maps ready:',maps.filter(m=>m.ready).length,'/',maps.length);
