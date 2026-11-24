import fs from 'node:fs/promises';
import path from 'node:path';
import {createMarketPriceService,MARKET_MODES} from './lib/market-prices.mjs';

const root=path.resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const staging=path.join(root,'work','market-seeds-'+stamp),target=path.join(root,'site/data/market');
await fs.mkdir(staging,{recursive:true});await fs.mkdir(target,{recursive:true});
const service=createMarketPriceService({avatarManifest:path.join(root,'site/data/tasks/assets/manifest.json')});
for(const mode of MARKET_MODES){
  const result=await service.get(mode);
  if(result.value.stale)throw new Error('Refusing a stale initial snapshot');
  await fs.writeFile(path.join(staging,mode+'.json'),JSON.stringify(result.value));
}
for(const mode of MARKET_MODES){
  const name=mode+'.json',file=path.join(target,name);
  try{await fs.copyFile(file,path.join(staging,'previous-'+name));}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.copyFile(path.join(staging,name),file+'.next');await fs.rename(file+'.next',file);
}
console.log(JSON.stringify({modes:MARKET_MODES,staging,ready:true}));
