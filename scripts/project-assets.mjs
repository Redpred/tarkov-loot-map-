import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyProjectAssets, packProjectAssets, restoreProjectAssets, refreshProjectAssetLock} from './lib/project-assets.mjs';
import {downloadProjectAssets} from './lib/project-assets-download.mjs';
import {assertNoLinks} from './lib/desktop-offline-profile.mjs';
const root=path.resolve(import.meta.dirname,'..');
const {positionals,values}=parseArgs({allowPositionals:true,options:{from:{type:'string'},download:{type:'boolean'},out:{type:'string'},changes:{type:'string'},group:{type:'string',default:'all'},help:{type:'boolean'}}});
if(values.help){console.log('project-assets.mjs verify [--group=runtime|inputs|all]\nproject-assets.mjs lock --out=work/<new-lock.json> [--changes=<JSON with add/remove path arrays>]\nproject-assets.mjs pack --out=dist/<new-folder>\nproject-assets.mjs restore (--download | --from=<bundle-folder>) [--group=runtime|inputs|all]');process.exit(0);}
assert(positionals.length === 1 && ['runtime','inputs','all'].includes(values.group),'Specify one command and a valid group');
const lock=JSON.parse(await fs.readFile(path.join(root,'resources/project-assets.lock.json'),'utf8'));
let result;
if(positionals[0]==='verify') result=await verifyProjectAssets(root,lock,values.group);
else if(positionals[0]==='lock'){
  assert(values.out,'--out is required; review the candidate before replacing the source lock');
  const output=path.resolve(root,values.out);
  assert(['work','dist'].some(dir=>output.startsWith(path.join(root,dir)+path.sep)),'Write the candidate lock under work or dist');
  const changes=values.changes?JSON.parse(await fs.readFile(path.resolve(root,values.changes),'utf8')):{};
  assert(changes && Object.keys(changes).every(key=>['add','remove'].includes(key)),'Only add/remove arrays are supported');
  const candidate=await refreshProjectAssetLock(root,lock,changes);
  await assertNoLinks(output); await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(candidate.lock,null,2)+'\n',{flag:'wx'});
  result={output,lockId:candidate.lockId,files:candidate.lock.files.length,changes:candidate.changes};
}
else if(positionals[0]==='pack'){
  assert(values.out,'--out is required');const output=path.resolve(root,values.out);
  assert(output.startsWith(path.join(root,'dist')+path.sep),'Use a new folder under dist');
  result=await packProjectAssets(root,lock,output);
  const sources=['NOTICE','THIRD_PARTY_NOTICES.txt','data/regions/tarkov-dev-LICENSE','data/spt/5.0.0-1ee2b75/LICENSE.txt','data/tasks/20261013-901f569/raw/spt/LICENSE'];
  const notices=(await Promise.all(sources.map(async file=>`===== ${file} =====\n${await fs.readFile(path.join(root,file),'utf8')}`))).join('\n\n');
  await fs.writeFile(path.join(output,'THIRD_PARTY_NOTICES.txt'),notices,{flag:'wx'});
  await fs.appendFile(path.join(output,'SHA256SUMS.txt'),`${createHash('sha256').update(notices).digest('hex')}  THIRD_PARTY_NOTICES.txt\n`);
} else if(positionals[0]==='restore'){
  assert(Boolean(values.from)!==Boolean(values.download),'Specify exactly one of --download or --from');
  const descriptor=JSON.parse(await fs.readFile(path.join(root,'resources/project-assets-release.json'),'utf8'));
  let from=values.from&&path.resolve(root,values.from),download;
  if(values.download){
    from=path.join(root,'work/project-assets-download',createHash('sha256').update(JSON.stringify(lock)).digest('hex'));
    download=await downloadProjectAssets({lock,release:descriptor,cache:from,group:values.group});
  }
  result={...await restoreProjectAssets(root,lock,descriptor,from,values.group),...(download?{download}:{})};
} else throw Error('Use verify, lock, pack, or restore; see --help');
console.log(JSON.stringify(result));
