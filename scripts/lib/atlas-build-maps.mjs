import {ATLAS_MAPS} from '../../site/atlas-maps.js';

export function requestedMaps(){
  const index=process.argv.indexOf('--map');
  if(index<0)return Object.values(ATLAS_MAPS);
  const ids=(process.argv[index+1]||'').split(',');
  return ids.map(id=>{
    if(!Object.hasOwn(ATLAS_MAPS,id))throw new Error(`Unknown Atlas map: ${id}`);
    return ATLAS_MAPS[id];
  });
}
