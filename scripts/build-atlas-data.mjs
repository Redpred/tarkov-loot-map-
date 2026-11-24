import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {requestedMaps} from './lib/atlas-build-maps.mjs';
const root=path.resolve(import.meta.dirname,'..');
const maps=requestedMaps();
execFileSync(process.execPath,['scripts/build-loot-categories.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
for(const map of maps)for(const script of ['build-factory','build-atlas-pois','build-atlas-quests','build-atlas-regions']){
  execFileSync(process.execPath,[`scripts/${script}.mjs`,'--map',map.id],{cwd:root,stdio:'inherit',windowsHide:true});
}
execFileSync(process.execPath,['scripts/build-atlas-catalog.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,['scripts/build-icon-types.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
