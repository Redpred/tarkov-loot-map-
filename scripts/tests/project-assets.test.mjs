import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assetHash,validateProjectAssets,verifyProjectAssets,packProjectAssets,restoreProjectAssets,refreshProjectAssetLock} from '../lib/project-assets.mjs';
import {downloadProjectAssets} from '../lib/project-assets-download.mjs';
import {copyClientSnapshot,verifyClientSnapshot} from '../lib/client-snapshot.mjs';

async function workspace(t) {
  const root=path.resolve('work');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'asset-tools-test-'));
  t.after(async()=>{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true});});
  return directory;
}
async function fixture(t) {
  const directory=await workspace(t),source=path.join(directory,'source'),target=path.join(directory,'target'),out=path.join(directory,'bundle');
  const files=[];
  for(const [file,group,text] of [['site/data/tasks/test.json','runtime','{"synthetic":true}'],['site/previews/test.webp','runtime','fake image bytes'],['data/tasks/test.json','inputs','{"syntheticInput":true}']]){
    const bytes=Buffer.from(text);await fs.mkdir(path.dirname(path.join(source,file)),{recursive:true});await fs.writeFile(path.join(source,file),bytes);files.push({path:file,group,bytes:bytes.length,sha256:assetHash(bytes)});
  }
  const lock={schemaVersion:1,files},descriptor=await packProjectAssets(source,lock,out);return {directory,source,target,out,lock,descriptor};
}
test('resource bundles restore only the selected group and resume with matching existing files',async t=>{
  const f=await fixture(t);assert.equal((await restoreProjectAssets(f.target,f.lock,f.descriptor,f.out,'runtime')).restored,2);
  await assert.rejects(fs.access(path.join(f.target,'data/tasks/test.json')),{code:'ENOENT'});
  assert.deepEqual(await restoreProjectAssets(f.target,f.lock,f.descriptor,f.out),{restored:1,reused:2,lockId:validateProjectAssets(f.lock)});
  assert.equal((await verifyProjectAssets(f.target,f.lock)).files,3);
});
test('resource restore refuses corrupted archives and preserves existing user files',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.out,'project-assets-runtime.zip'),'damaged');
  await assert.rejects(restoreProjectAssets(f.target,f.lock,f.descriptor,f.out));await assert.rejects(fs.access(f.target),{code:'ENOENT'});
  const existing=path.join(f.target,f.lock.files[0].path);await fs.mkdir(path.dirname(existing),{recursive:true});await fs.writeFile(existing,'user file');
  await assert.rejects(restoreProjectAssets(f.target,f.lock,f.descriptor,f.out),/Existing asset differs/);assert.equal(await fs.readFile(existing,'utf8'),'user file');
});
test('resource locks and destinations reject traversal and redirected directories',async t=>{
  const f=await fixture(t);for(const value of ['site/data/../../private','data/x:stream','data/./x','data/x\\y'])assert.throws(()=>validateProjectAssets({...f.lock,files:[{...f.lock.files[0],path:value}]}));
  const alias=path.join(f.directory,'alias');await fs.symlink(f.source,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(restoreProjectAssets(alias,f.lock,f.descriptor,f.out),/Links are not accepted/);
});
test('client snapshots copy first, remain independent and detect later tampering',async t=>{
  const directory=await workspace(t),source=path.join(directory,'game'),output=path.join(directory,'snapshot');await fs.mkdir(path.join(source,'EscapeFromTarkov_Data'),{recursive:true});
  const input=path.join(source,'EscapeFromTarkov_Data/resources.assets');await fs.writeFile(input,'synthetic resources');await fs.writeFile(path.join(source,'EscapeFromTarkov.exe'),'synthetic executable');
  const copied=await copyClientSnapshot({source,output});assert.equal(copied.files.length,2);await fs.writeFile(input,'changed source');assert.equal((await verifyClientSnapshot(output)).files.length,2);
  await assert.rejects(copyClientSnapshot({source,output}));await fs.writeFile(path.join(output,'EscapeFromTarkov_Data/resources.assets'),'tampered');await assert.rejects(verifyClientSnapshot(output));
});
test('snapshot selection cannot follow links or escape the client data paths',async t=>{
  const directory=await workspace(t),source=path.join(directory,'game'),outside=path.join(directory,'outside');await fs.mkdir(source);await fs.mkdir(outside);await fs.writeFile(path.join(outside,'test'),'private');
  await fs.symlink(outside,path.join(source,'EscapeFromTarkov_Data'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(copyClientSnapshot({source,output:path.join(directory,'copy'),include:['EscapeFromTarkov_Data/test']}),/Links are not accepted/);
  await assert.rejects(copyClientSnapshot({source,output:path.join(directory,'copy'),include:['EscapeFromTarkov_Data/../outside/test']}),/Invalid client snapshot path/);
});

test('lock refresh is stable and only changes explicitly selected files',async t=>{
  const f=await fixture(t),initial=JSON.stringify(f.lock);
  const same=await refreshProjectAssetLock(f.source,f.lock);assert.equal(same.lockId,validateProjectAssets(f.lock));
  assert.deepEqual(same.changes,{added:[],removed:[],changed:[]});
  const added='site/data/tasks/new.json';await fs.writeFile(path.join(f.source,added),'new synthetic asset');
  await fs.writeFile(path.join(f.source,f.lock.files[0].path),'changed synthetic asset');
  const next=await refreshProjectAssetLock(f.source,f.lock,{add:[added],remove:[f.lock.files[1].path]});
  assert.deepEqual(next.changes,{added:[added],removed:[f.lock.files[1].path],changed:[f.lock.files[0].path]});
  assert.equal(JSON.stringify(f.lock),initial);assert.equal(next.lock.files.length,3);
  await fs.access(path.join(f.source,f.lock.files[1].path)); // Removal changes the list, not disk assets.
  for(const add of [['data/../../secret'],[f.lock.files[0].path],[added,added]])await assert.rejects(refreshProjectAssetLock(f.source,f.lock,{add}));
});

test('download follows approved redirects, verifies streams, selects groups and reuses the cache',async t=>{
  const f=await fixture(t),cache=path.join(f.directory,'cache'),requests=[];
  const fetcher=async(url,options)=>{
    requests.push(url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);
    const parsed=new URL(url),name=path.basename(parsed.pathname);
    if(parsed.hostname==='github.com')return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/'+name+'?signed=example'}});
    const bytes=await fs.readFile(path.join(f.out,name));return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
  };
  const first=await downloadProjectAssets({lock:f.lock,release:f.descriptor,cache,group:'runtime',fetcher});
  assert.deepEqual(first.downloaded,['project-assets-index.json','project-assets-runtime.zip']);assert.equal(requests.length,4);
  assert.equal((await restoreProjectAssets(f.target,f.lock,f.descriptor,cache,'runtime')).restored,2);
  const second=await downloadProjectAssets({lock:f.lock,release:f.descriptor,cache,group:'all',fetcher});
  assert.deepEqual(second.downloaded,['project-assets-inputs.zip']);assert.equal(requests.length,6);
  assert.equal((await restoreProjectAssets(f.target,f.lock,f.descriptor,cache,'all')).restored,1);
  await fs.writeFile(path.join(cache,'project-assets-runtime.zip'),'user file');
  await assert.rejects(downloadProjectAssets({lock:f.lock,release:f.descriptor,cache,fetcher}),/Cached asset differs/);
  assert.equal(requests.length,6);assert.equal(await fs.readFile(path.join(cache,'project-assets-runtime.zip'),'utf8'),'user file');
});

test('download rejects unsafe redirects, missing releases, truncated, oversized and tampered data',async t=>{
  const f=await fixture(t),index=await fs.readFile(path.join(f.out,'project-assets-index.json'));
  const responses=[
    [()=>new Response(null,{status:302,headers:{location:'http://github.com/unsafe'}}),/approved HTTPS/],
    [()=>new Response(null,{status:302,headers:{location:'https://example.org/unsafe'}}),/approved HTTPS/],
    [()=>new Response(null,{status:302,headers:{location:'https://github.com/loop'}}),/excessive/],
    [()=>new Response(null,{status:404}),/not publicly available/],
    [()=>new Response(index.subarray(1)),/checksum or size/],
    [()=>new Response(Buffer.concat([index,Buffer.from('x')])),/exceeds/],
    [()=>new Response(Buffer.alloc(index.length)),/checksum or size/],
    [()=>new Response(index,{headers:{'content-length':String(index.length+1)}}),/size does not match/],
  ];
  for(let n=0;n<responses.length;n++){
    const cache=path.join(f.directory,'bad-'+n),[fetcher,error]=responses[n];
    await assert.rejects(downloadProjectAssets({lock:f.lock,release:f.descriptor,cache,fetcher}),error);
    assert.deepEqual(await fs.readdir(cache),[]);
  }
  let requested=false;const fetcher=()=>{requested=true;throw Error('unexpected network')};
  await assert.rejects(downloadProjectAssets({lock:f.lock,release:{...f.descriptor,lockId:'0'.repeat(64)},cache:path.join(f.directory,'invalid'),fetcher}));
  const alias=path.join(f.directory,'alias');await fs.symlink(f.out,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(downloadProjectAssets({lock:f.lock,release:f.descriptor,cache:alias,fetcher}),/Links are not accepted/);assert.equal(requested,false);
});
