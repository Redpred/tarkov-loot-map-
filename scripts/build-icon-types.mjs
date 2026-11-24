import fs from 'node:fs';
import path from 'node:path';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {classifyPointMarker} from '../site/factory-marker-rules.js';
import {typeSettingKey} from '../site/factory-icon-settings.js';
import {POI_TYPES} from '../site/atlas-point-types.js';
import {mergeMapData} from '../site/atlas-runtime.js';
const root=path.resolve(import.meta.dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifests=['factory/manifest','items/manifest','items/spt-extras'].map(p=>read(`site/data/icons/${p}.json`));
const icons={items:Object.assign({},...manifests.map(m=>m.items))},types=new Map();
for(const map of Object.values(ATLAS_MAPS)){
  const data=mergeMapData(read('site/'+map.data),read(`site/data/${map.id}-pois.json`),read(`site/data/tasks/maps/${map.id}.json`));
  for(const p of data.points){
    if(!p.position||p.outsideClientEnvelope)continue;
    const descriptor=p.kind==='poi'?{mode:'poi',key:p.icon,label:p.poiTypes.map(t=>POI_TYPES[t][0]).join(' / ')}:classifyPointMarker(p,data,icons);
    const key=typeSettingKey(p,descriptor);
    if(!types.has(key))types.set(key,{key,label:descriptor.label,icon:descriptor.key,group:p.kind==='container'?'container':p.kind==='poi'?'poi':descriptor.mode==='item'?'item':'loose',maps:{}});
    const type=types.get(key);type.maps[map.id]=(type.maps[map.id]||0)+1;
  }
}
const output={version:1,types:[...types.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'))};
fs.writeFileSync(path.join(root,'site/data/atlas-icon-types.json'),JSON.stringify(output));
console.log(`Icon editor: ${output.types.length} types across ${Object.keys(ATLAS_MAPS).length} maps`);
