import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createScreenshotAccess} from '../../desktop/screenshot-access.mjs';
import {createScreenshotDirectoryAccess} from '../../site/atlas-screenshot-directory.js';
import {createScreenshotWatcher} from '../../site/atlas-screenshot-location.js';

const filename = (x=1, minute='30') => `2026-11-04[12-${minute}]_${x},2,3_0,0,0,1.png`;
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tarkov-screenshot-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const documents=path.join(root,'redirected-documents'), fallback=path.join(root,'Documents');
  const screenshots=path.join(documents,'Escape from Tarkov','Screenshots'), settingsFile=path.join(root,'profile','screenshot-directory.json');
  let selection=null;
  const options={documentsPaths:[documents,fallback],settingsFile,selectDirectory:async()=>selection};
  const service=createScreenshotAccess(options);
  return {root,documents,fallback,screenshots,settingsFile,options,service,select:folder=>{selection=folder;}};
}
test('finds redirected Documents automatically and restores the selected path across launches',async t=>{
  const f=await fixture(t);await fs.mkdir(f.screenshots,{recursive:true});
  const info=await f.service.info();assert.equal(info.path,f.screenshots);
  assert.equal((await createScreenshotAccess(f.options).info()).path,f.screenshots);
});
test('falls back to ordinary Documents, but never creates a missing game folder',async t=>{
  const f=await fixture(t);assert.equal(await f.service.info(),null);
  await assert.rejects(fs.stat(f.documents),{code:'ENOENT'});
  const folder=path.join(f.fallback,'Escape from Tarkov','Screenshots');await fs.mkdir(folder,{recursive:true});
  assert.equal((await f.service.detect()).path,folder);
});
test('manual directory, cancellation, disconnect and explicit rediscovery preserve screenshot files',async t=>{
  const f=await fixture(t);await fs.mkdir(f.screenshots,{recursive:true});
  const custom=path.join(f.root,'custom');await fs.mkdir(custom);await fs.writeFile(path.join(custom,filename()),'original');
  f.select(custom);const selected=await f.service.choose();assert.equal((await f.service.info()).path,custom);
  f.select(null);assert.equal(await f.service.choose(),null);assert.equal((await f.service.info()).id,selected.id);
  await f.service.forget();assert.equal(await createScreenshotAccess(f.options).info(),null);
  assert.equal(await fs.readFile(path.join(custom,filename()),'utf8'),'original');
  assert.equal((await f.service.detect()).path,f.screenshots);
});
test('enumerates only game image filenames; directory tokens prevent arbitrary paths and stale reads',async t=>{
  const f=await fixture(t);await fs.mkdir(f.screenshots,{recursive:true});
  await fs.writeFile(path.join(f.screenshots,filename()),'unchanged');
  await fs.writeFile(path.join(f.screenshots,'private.txt'),'private');
  await fs.mkdir(path.join(f.screenshots,filename(2)));
  const info=await f.service.info(), entries=await f.service.list(info.id);
  assert.deepEqual(entries.map(e=>e.name),[filename()]);assert.ok(entries[0].lastModified>0);
  assert.deepEqual(Object.keys(entries[0]).sort(),['lastModified','name']);
  await assert.rejects(f.service.list(f.root),{name:'NotFoundError'});
  await f.service.detect();await assert.rejects(f.service.list(info.id),{name:'NotFoundError'});
  assert.equal(await fs.readFile(path.join(f.screenshots,filename()),'utf8'),'unchanged');
});
test('a removed screenshot directory reports a recoverable missing-directory error',async t=>{
  const f=await fixture(t);await fs.mkdir(f.screenshots,{recursive:true});const info=await f.service.info();
  await fs.rmdir(f.screenshots);await assert.rejects(f.service.list(info.id),{name:'NotFoundError'});
});
test('corrupt settings can be recovered by explicitly choosing a folder',async t=>{
  const f=await fixture(t);await fs.mkdir(path.dirname(f.settingsFile),{recursive:true});await fs.writeFile(f.settingsFile,'invalid');
  await assert.rejects(f.service.info(),/设置/);f.select(f.root);
  assert.equal((await f.service.choose()).path,f.root);assert.equal((await f.service.info()).path,f.root);
});
test('native directory adapter drives manual and automatic location without reading image bytes',async t=>{
  const f=await fixture(t);await fs.mkdir(f.screenshots,{recursive:true});await fs.writeFile(path.join(f.screenshots,filename()),'not-an-image');
  const desktop={screenshots:async(action,id)=>{try{return {ok:true,value:await f.service[action](id)};}catch(error){return {ok:false,name:error.name,message:error.message};}}};
  const access=createScreenshotDirectoryAccess({desktop}), directory=await access.restore(), located=[], errors=[];
  const watcher=createScreenshotWatcher({onLocate:shot=>located.push(shot),onError:e=>errors.push(e),schedule:()=>0,cancel:()=>{}});
  watcher.connect(directory);watcher.setSuspended(false);await watcher.read();assert.equal(located[0].position.x,1);
  await watcher.setAutomatic(true);await fs.writeFile(path.join(f.screenshots,filename(42,'31')),'not-an-image');
  await watcher.poll();assert.equal(located[1].position.x,42);await watcher.poll();assert.equal(located.length,2);
  await access.forget();await watcher.poll();assert.equal(watcher.automatic,false);assert.equal(errors[0].name,'NotFoundError');watcher.dispose();
});
test('browser picker uses a granted Documents directory to find the existing screenshot child',async()=>{
  const shots={name:'Screenshots'},eft={getDirectoryHandle:async name=>{assert.equal(name,'Screenshots');return shots;}};
  const documents={getDirectoryHandle:async name=>{assert.equal(name,'Escape from Tarkov');return eft;}};
  let saved;
  const access=createScreenshotDirectoryAccess({desktop:null,picker:async options=>{assert.equal(options.startIn,'documents');assert.equal(options.mode,'read');return documents;},store:{read:async()=>saved,write:async value=>{saved=value;}}});
  assert.equal(await access.choose(),shots);await access.save(shots);assert.equal(await access.restore(),shots);await access.forget();assert.equal(saved,null);
});
test('browser keeps an explicitly selected screenshot folder when known children are absent',async()=>{
  const folder={name:'Screenshots',getDirectoryHandle:async()=>{throw new DOMException('missing','NotFoundError');}};
  const access=createScreenshotDirectoryAccess({desktop:null,picker:async()=>folder});assert.equal(await access.choose(),folder);
});
