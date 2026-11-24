import fs from 'node:fs';
import path from 'node:path';
import {requestedMaps} from './lib/atlas-build-maps.mjs';
import {buildAtlasPois} from './lib/atlas-pois.mjs';
import {SPT_DB,SPT_SOURCE,hasMapLoot} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'..'),db=SPT_DB;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const locales={ch:read(path.join(db,'locales/global/ch.json')),en:read(path.join(db,'locales/global/en.json'))};
for(const map of requestedMaps()){
  const atlas=read(path.join(root,`work/tarkmap/out/${map.atlas}/gamedata.json`)),base=hasMapLoot(map)?read(path.join(db,`locations/${map.spt}/base.json`)):{};
  const data=buildAtlasPois(atlas,base,locales,SPT_SOURCE);fs.writeFileSync(path.join(root,`site/data/${map.id}-pois.json`),JSON.stringify(data));
  console.log(map.id,data.points.length,'special points',data.skipped);
}
