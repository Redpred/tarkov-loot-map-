import {ATLAS_MAPS} from './atlas-maps.js';
import {performancePresets} from './atlas-performance.js';
import {validateViewSettings} from './atlas-view-settings.js';
import {readPagePreferences,savePagePreferences} from './atlas-page-session.js';

export const HOME_VIEW_KEY='atlas-home-view-settings-v1';
const sharedKeys=['mode','distance','retain','flySpeed','fov','markerDistance','drawDistance','markerSize','markerStyle',...Object.keys(performancePresets.balanced)];
const mapKey=id=>`${id}-view-settings-v1`;
function storage(){try{return globalThis.localStorage;}catch{return null;}}
const read=readPagePreferences;
export function readHomeViewSettings(preferences=storage()){return validateViewSettings(read(HOME_VIEW_KEY,preferences));}
export function readMapViewSettings(mapId,preferences=storage()){
  return validateViewSettings({...read(HOME_VIEW_KEY,preferences),...read(mapKey(mapId),preferences)});
}
export function saveMapViewSettings(mapId,settings,change,preferences=storage()){
  const valid=validateViewSettings(settings);
  const keys=change==='reset'?Object.keys(valid):change==='preset'?Object.keys(performancePresets.balanced):
    change==='manualPivot'?['pivot','manualPivot']:Object.hasOwn(valid,change)?[change]:[];
  return keys.length>0&&savePagePreferences(mapKey(mapId),Object.fromEntries(keys.map(key=>[key,valid[key]])),preferences);
}
// Home changes apply only to the controls the user changed. Preserve each map's
// camera pivot and other independent preferences; new maps inherit the defaults.
export function saveHomeViewSettings(settings,change,preferences=storage()){
  const keys=change==='reset'?sharedKeys:change==='preset'?Object.keys(performancePresets.balanced):sharedKeys.includes(change)?[change]:[];
  if(!preferences||!keys.length)return false;
  const valid=validateViewSettings(settings),patch=Object.fromEntries(keys.map(key=>[key,valid[key]]));
  try{
    for(const id of Object.keys(ATLAS_MAPS))if(preferences.getItem(mapKey(id))!=null){
      preferences.setItem(mapKey(id),JSON.stringify({...read(mapKey(id),preferences),...patch}));
    }
    preferences.setItem(HOME_VIEW_KEY,JSON.stringify({...read(HOME_VIEW_KEY,preferences),...patch}));
    return true;
  }catch{return false;}
}
