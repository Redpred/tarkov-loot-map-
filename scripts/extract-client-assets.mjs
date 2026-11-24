import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {verifyClientSnapshot} from './lib/client-snapshot.mjs';
import {assertNoLinks} from './lib/desktop-offline-profile.mjs';
const root=path.resolve(import.meta.dirname,'..'),atlas=path.join(root,'work/atlas');
const revision='5779530d9a45654df0027b6876bc1060e03cef94';
const folders={factory:'Factory_Rework',streets:'City',customs:'Custom',woods:'Woods',shoreline:'shorline',interchange:'Shopping_Mall',reserve:'Reserve_Base',labs:'Laboratory',ground_zero:'Sandbox',labyrinth:'Labyrinth',terminal:'Terminal',icebreaker:'Icebreaker',lighthouse:'Lighthouse'};
const {values}=parseArgs({options:{snapshot:{type:'string'},out:{type:'string'},map:{type:'string',default:'factory'},jobs:{type:'string',default:'3'},plan:{type:'boolean'},prepare:{type:'boolean'},icons:{type:'boolean'},match:{type:'string',default:'.*'},help:{type:'boolean'}}});
if(values.help){console.log('extract-client-assets.mjs --snapshot=work/<verified-copy> --out=work/<new-export> [--map=factory,streets|all] [--jobs=3] [--plan] [--prepare]\nUse --icons [--match=<regex>] to export Unity Texture2D/Sprite images instead of maps. --prepare installs the pinned Atlas/Python tools. Output never replaces site/data.');process.exit(0);}
assert(values.snapshot&&values.out,'--snapshot and --out are required');
const snapshot=await assertNoLinks(path.resolve(root,values.snapshot)),output=await assertNoLinks(path.resolve(root,values.out));
for(const directory of [snapshot,output])assert(directory.startsWith(path.join(root,'work')+path.sep),'Use project work/ paths');
assert(output!==snapshot&&!output.startsWith(snapshot+path.sep)&&!snapshot.startsWith(output+path.sep),'Use independent snapshot and export directories');
await assert.rejects(fs.access(output),{code:'ENOENT'});
const jobs=Number(values.jobs);assert(Number.isInteger(jobs)&&jobs>=1&&jobs<=8,'Use 1–8 extraction workers');
const maps=values.map==='all'?Object.keys(folders):values.map.split(',');assert(maps.every(id=>Object.hasOwn(folders,id)),'Unknown map');
const manifest=await verifyClientSnapshot(snapshot);
const env={...process.env,EFT_GAME_DATA:path.join(snapshot,'EscapeFromTarkov_Data'),EFT_ASSETS_ROOT:path.join(output,'atlas-assets'),EFT_TARKMAP_ROOT:path.join(output,'tarkmap'),EFT_GAMEDATA_OFFLINE:'1',PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'};
async function run(executable,args,capture=false){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env,windowsHide:true,stdio:capture?['ignore','pipe','inherit']:'inherit'});let text='';if(capture)child.stdout.on('data',data=>{text+=data;if(text.length>32*2**20)child.kill();});try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}child.on('error',reject);child.on('exit',code=>code===0?resolve(text.trim()):reject(Error(`Tool failed (${code}): ${path.basename(executable)}`)));});}
const python=(...args)=>run(process.execPath,['scripts/run-atlas-python.mjs',...args]);
if(values.prepare){
  await assertNoLinks(atlas);
  if(!await fs.stat(path.join(atlas,'.git')).catch(()=>null)){await run('git',['clone','--no-checkout','https://github.com/ConocoFieldsForever/atlas.git',atlas]);await run('git',['-C',atlas,'checkout',revision]);}
  assert.equal(await run('git',['-C',atlas,'rev-parse','HEAD'],true),revision,'Atlas checkout differs from the tested revision');
  await run(process.execPath,['scripts/setup-atlas-python.mjs']);
  await python('-m','pip','install','-r','scripts/requirements-atlas-tls.txt','-r',path.join(atlas,'extraction/requirements.txt'));
}
assert.equal(await run('git',['-C',atlas,'rev-parse','HEAD'],true),revision,'Run --prepare to install the pinned tools');
if(values.icons){await python('scripts/extract-client-icons.py','--snapshot',snapshot,'--out',output,'--match',values.match);process.exit(0);}
await python('scripts/patch-atlas-extractor.py',atlas);
const files=new Set(manifest.files.map(e=>e.path));
const plan=[];
for(const id of maps){
  const levels=JSON.parse(await run(process.execPath,['scripts/run-atlas-python.mjs',path.join(atlas,'tools/gen_maps.py'),'--levels-for',folders[id]],true));
  assert(Array.isArray(levels)&&levels.length>0&&levels.every(Number.isInteger),'No scenes found in this copied client version');
  plan.push({id,folder:folders[id],dataset:id==='factory'?'factory_rework':id,levels,missingLevels:levels.filter(level=>!files.has('EscapeFromTarkov_Data/level'+level))});
}
await fs.mkdir(output);
await fs.writeFile(path.join(output,'extraction-plan.json'),JSON.stringify({schemaVersion:1,atlasRevision:revision,snapshotManifest:'client-snapshot.json',maps:plan},null,2)+'\n');
if(values.plan){console.log(JSON.stringify(plan.map(({id,levels,missingLevels})=>({id,levels:levels.length,missingLevels:missingLevels.length}))));process.exit(0);}
assert(plan.every(map=>map.missingLevels.length===0),'Snapshot lacks required scenes; inspect extraction-plan.json and create a complete snapshot');
for(const map of plan){
  const levels=map.levels.join(',');
  await python(path.join(atlas,'extraction/unity/extract_parallel.py'),'--levels',levels,'--name',map.dataset,'--jobs',String(jobs));
  await python(path.join(atlas,'extraction/intel/extract_gamedata.py'),map.dataset,'--levels='+levels);
  const target=path.join(output,'site/data/atlas',map.id==='factory'?'':map.id);
  await python('scripts/export-atlas-geometry.py','--atlas',atlas,'--dataset',path.join(env.EFT_ASSETS_ROOT,map.dataset),'--out',target,'--name',map.id);
  if(map.id!=='factory')await python('scripts/split-atlas-sectors.py','--directory',target,'--name',map.id);
}
console.log(JSON.stringify({maps:maps.length,output,siteUnchanged:true}));
