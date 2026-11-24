import fs from 'node:fs';
import path from 'node:path';
import {loadSeasonSupplement,applySeasonSupplement} from './lib/season-task-supplement.mjs';
import {rebindTaskVolumes} from './lib/task-volume-binding.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const catalog=read('site/data/tasks/catalog.json');
const layers=Object.fromEntries(catalog.maps.map(m=>[m.id,read(`site/data/tasks/maps/${m.id}.json`)]));
const loaded=loadSeasonSupplement(root);if(!loaded)throw Error('Prepare the season supplement first');
const next=applySeasonSupplement(catalog,layers,loaded),changed=[];
const volumes=[];
for(const [id,layer] of Object.entries(next.mapLayers)){
  const file=`site/data/tasks/volumes/${id}.json`;
  if(JSON.stringify(layer)!==JSON.stringify(layers[id])&&fs.existsSync(path.join(root,file)))volumes.push([file,rebindTaskVolumes(read(file),layers[id],layer)]);
}
for(const [file,value] of [['site/data/tasks/catalog.json',next.catalog],...Object.entries(next.mapLayers).map(([id,layer])=>[`site/data/tasks/maps/${id}.json`,layer]),...volumes]){
  const text=JSON.stringify(value);if(fs.readFileSync(path.join(root,file),'utf8')===text)continue;
  fs.writeFileSync(path.join(root,file),text);changed.push(file);
}
console.log(JSON.stringify({tasks:next.catalog.tasks.length,flowTasks:loaded.data.tasks.length,verifiedNewPoints:loaded.data.points.length,changed},null,2));
