// Build a map only after extraction has committed its current-client metadata.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {SPT_SOURCE} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
const pending=new Set(Object.keys(ATLAS_MAPS));
while(pending.size){
  for(const id of [...pending]){
    const meta=read(`data/atlas/${id}-source.json`);
    if(meta?.eftBuild!==SPT_SOURCE.eftBuild)continue;
    const map=ATLAS_MAPS[id],data=read('site/'+map.data);
    const current=data?.sources.spt?.commit===SPT_SOURCE.commit&&data?.sources.atlas?.clientVersion===meta.clientVersion&&data?.sources.atlas?.clientFingerprint===meta.clientFingerprint;
    const complete=['pois','quests','regions'].every(s=>fs.existsSync(path.join(root,`site/data/${id}-${s}.json`)));
    if(!current||!complete){
      console.log(`[${id}] build current data`);
      execFileSync(process.execPath,['scripts/build-atlas-data.mjs','--map',id],{cwd:root,stdio:'inherit',windowsHide:true});
    }
    execFileSync(process.execPath,['scripts/audit-atlas-alignment.mjs','--map',id],{cwd:root,stdio:'inherit',windowsHide:true});
    pending.delete(id);console.log(`Ready ${Object.keys(ATLAS_MAPS).length-pending.size}/${Object.keys(ATLAS_MAPS).length}; remaining: ${[...pending].join(', ')}`);
  }
  if(pending.size)await setTimeout(10000);
}
execFileSync(process.execPath,['scripts/build-atlas-catalog.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
console.log('All Atlas datasets updated.');
