import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {requestedMaps} from './lib/atlas-build-maps.mjs';
const root=path.resolve(import.meta.dirname,'..');
for(const map of requestedMaps()){
  console.log(`\nValidating ${map.name} (${map.id}) geometry, materials and source matrices`);
  const args=map.streamed?['scripts/tests/streets-geometry.test.py','--map',map.id]:['scripts/tests/atlas-geometry.test.py'];
  execFileSync(process.execPath,['scripts/run-atlas-python.mjs',...args],{cwd:root,stdio:'inherit',windowsHide:true});
}
