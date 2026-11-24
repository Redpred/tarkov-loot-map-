import {ATLAS_MAPS} from './atlas-maps.js';

// Derive ownership from stable resource URLs, including caches saved before
// map grouping existed. No geometry or image bytes need to be opened.
export function cacheOwner(identity){
  if(String(identity).startsWith('geometry-chunk:'))return {...cacheOwner('geometry:'+String(identity).slice(15).replace(/:\d+:\d+$/,'')),kind:'partial'};
  let match=String(identity).match(/^geometry:\/api\/([a-z_]+)-geometry(?:\/(medium|low))?(?:\/simple)?(?:\/s_-?\d+_-?\d+)?$/);
  if(match&&Object.hasOwn(ATLAS_MAPS,match[1]))return {mapId:match[1],kind:'geometry',quality:match[2]||'original'};
  match=String(identity).match(/^texture:\/data\/model-quality\/([a-z_]+)\/(medium|low)\//);
  if(match&&Object.hasOwn(ATLAS_MAPS,match[1]))return {mapId:match[1],kind:'texture',quality:match[2]};
  match=String(identity).match(/^texture:\/data\/atlas\/(?:(\w+)\/)?textures\//);
  if(match&&Object.hasOwn(ATLAS_MAPS,match[1]||'factory'))return {mapId:match[1]||'factory',kind:'texture',quality:'original'};
  match=String(identity).match(/^runtime:(?:map|spatial):([a-z_]+)(?::|$)/);
  if(match&&Object.hasOwn(ATLAS_MAPS,match[1]))return {mapId:match[1],kind:'auxiliary',quality:'shared'};
  return {mapId:'other',kind:'auxiliary',quality:'shared'};
}
