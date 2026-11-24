import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const selected=path.join(root,'data/spt-source.json');
const fallback={version:'4.1.2',eftBuild:40743,eftVersion:'0.16.9.5.40743',archive:'SPT-4.1.2-40743-cf04a11.7z',databasePath:'data/extracted/SPT_Runtime/SPT_Data/database'};
const source=fs.existsSync(selected)?JSON.parse(fs.readFileSync(selected,'utf8').replace(/^\uFEFF/,'')):fallback;
export const SPT_DB=path.resolve(root,source.databasePath);
if(!SPT_DB.startsWith(root+path.sep))throw new Error('SPT database must stay inside the project');
export const SPT_SOURCE=Object.fromEntries(Object.entries(source).filter(([key])=>!['files','databasePath'].includes(key)));
export const SPT_LABEL=`SPT ${source.version}`;
export const hasMapLoot=map=>Boolean(map.spt&&source.eftBuild>=(map.minLootBuild||0)&&['looseLoot','staticContainers','staticLoot','statics'].every(file=>fs.existsSync(path.join(SPT_DB,'locations',map.spt,file+'.json'))));
