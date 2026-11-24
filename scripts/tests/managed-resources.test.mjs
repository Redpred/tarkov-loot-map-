import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {IDBFactory} from 'fake-indexeddb';
import {createManagedResources,MANAGED_DIRECTORY,managedResources} from '../../site/atlas-managed-resources.js';
import {localResources} from '../../site/atlas-local-resources.js';
import {createResourceCache,sha256,loadCachedTexture} from '../../site/atlas-resource-cache.js';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';

const identity='geometry:/api/factory-geometry/low',texture='texture:/data/model-quality/factory/medium/test.webp';
const quality={geometry:'low',texture:'medium',scenery:'full'},CHUNK=4*2**20;
// Real files in a fresh test directory, with browser-shaped handles. Permission
// prompts and persistence are simulated; this is not native-browser acceptance.
class Directory {
  constructor(location,control){this.location=location;this.control=control;this.name=path.basename(location);this.kind='directory';}
  check(){if(this.control.permission!=='granted')throw new DOMException('permission','NotAllowedError');}
  async queryPermission(options){this.control.modes.push(options.mode);return this.control.permission;}
  async requestPermission(options){this.control.modes.push(options.mode);return this.control.permission;}
  async getDirectoryHandle(name,{create=false}={}){this.check();assert.ok(!name.includes('/')&&!name.includes('\\')&&name!=='.'&&name!=='..');const location=path.join(this.location,name);
    if(create)await mkdir(location,{recursive:true});try{assert.ok((await stat(location)).isDirectory());}catch(error){if(error.code==='ENOENT')throw new DOMException('missing','NotFoundError');throw error;}return new Directory(location,this.control);}
  async getFileHandle(name,{create=false}={}){this.check();assert.ok(!name.includes('/')&&!name.includes('\\'));const location=path.join(this.location,name),directory=this;
    try{await stat(location);}catch(error){if(error.code!=='ENOENT')throw error;if(!create)throw new DOMException('missing','NotFoundError');await writeFile(location,'',{flag:'wx'});}
    return {kind:'file',name,async getFile(){directory.check();return new File([await readFile(location)],name);},async createWritable(){directory.check();let data;
      return {async write(value){directory.check();await directory.control.beforeWrite?.(location);data=Buffer.from(await value.arrayBuffer());},async close(){directory.check();await directory.control.beforeClose?.(location);await writeFile(location,data);directory.control.written.push(location);},async abort(){directory.control.aborts++;}};
    }};
  }
  async *values(){this.check();for(const entry of await readdir(this.location,{withFileTypes:true}))yield entry.isDirectory()?new Directory(path.join(this.location,entry.name),this.control):await this.getFileHandle(entry.name);}
  removeEntry(){assert.fail('Managed resources must never delete user files');}
}
async function fixture(t){
  const folder=await mkdtemp(path.join(tmpdir(),'atlas-managed-')),control={permission:'granted',modes:[],written:[],aborts:0},root=new Directory(folder,control),values=new Map();let saved;
  const settings={read:async()=>saved,write:async value=>{saved=value;}},storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const providers=[],cache=createResourceCache({indexedDB:new IDBFactory(),preferences:storage});
  const create=(options={})=>{const provider=createManagedResources({settings,storage,picker:async()=>root,indexedDB:null,locks:null,...options});providers.push(provider);return provider;};
  t.after(async()=>{for(const p of providers)await p.close();await cache.close();assert.ok(folder.startsWith(path.join(tmpdir(),'atlas-managed-')));await rm(folder,{recursive:true,force:true});});
  return {folder,root,control,settings,storage,create,provider:create(),cache};
}
async function planFor(bytes,mapId='factory'){const hash=await sha256(bytes);return {hash,plan:{mapId,quality,geometry:[[identity,hash,bytes.length]],texture:[]}};}

test('desktop defaults to its own resource folder, preserves linked directories and never defaults back to online on unlink',async t=>{
  const f=await fixture(t);assert.equal(f.provider.mode(),'');
  const client=f.create({client:true});assert.equal(client.mode(),'client');
  f.storage.setItem('atlas-resource-mode-v1','online');assert.equal(f.create({client:true}).mode(),'client');
  await client.choose();assert.equal(f.create({client:true}).mode(),'managed');
  await client.forget();assert.equal(client.mode(),'client');assert.equal(f.create({client:true}).mode(),'client');
  client.setMode('online');assert.equal(f.create({client:true}).mode(),'online','An explicit new desktop choice is remembered');
  assert.equal(f.provider.mode(),'','Website default is unchanged');
});

test('a failed model write joins concurrent workers before exposing the error or allowing a retry',async t=>{
  const bytes=new Uint8Array(CHUNK*2+17).fill(61),version=await sha256(bytes),oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;});
  globalThis.fetch=async url=>{const query=new URL(url,'http://localhost').searchParams,offset=Number(query.get('offset')),length=Number(query.get('length')),part=bytes.subarray(offset,offset+length);return Response.json({offset,total:bytes.length,encoding:'base64',data:Buffer.from(part).toString('base64'),sha256:await sha256(part)});};
  let finishWrites,bothStarted,failed,active=0,settled=false;
  const gate=new Promise(resolve=>{finishWrites=resolve;}),started=new Promise(resolve=>{bothStarted=resolve;}),failure=new Promise(resolve=>{failed=resolve;});
  const diskError=new DOMException('disk full','QuotaExceededError');
  const cache={ticket:()=>0,get:async()=>null,remove:async()=>{},async put(key){
    if(key.includes(':0:')){await started;failed();throw diskError;}
    active++;if(active===2)bothStarted();await gate;active--;
  }};
  const pending=loadFactoryGeometry({sha256:version,stats:{bytes:bytes.length}},()=>{},identity.slice(9),undefined,cache);
  void pending.then(()=>{settled=true;},()=>{settled=true;});
  await failure;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(settled,false);assert.equal(active,2);
  finishWrites();await assert.rejects(pending,error=>error===diskError);assert.equal(active,0);
});

test('managed downloads persist verified chunks and textures, reopen without network or a duplicate browser/full-model copy',async t=>{
  const f=await fixture(t),bytes=new Uint8Array(CHUNK*2+17).fill(37),{plan,hash}=await planFor(bytes),image=Buffer.from('texture payload'),imageHash=await sha256(image);
  plan.texture=[[texture,imageHash,image.length]];await f.provider.register(plan);await f.provider.choose();await f.provider.prepare();
  const fetcher=globalThis.fetch;let requests=0;
  globalThis.fetch=async(url,options)=>{requests++;assert.equal(options.cache,'no-store','Managed downloads must not create an HTTP-cache copy');const q=new URL(url,'http://localhost').searchParams;if(url.startsWith('/data/'))return new Response(image);
    const offset=Number(q.get('offset')),length=Number(q.get('length')),part=bytes.subarray(offset,offset+length);return Response.json({offset,total:bytes.length,encoding:'base64',data:Buffer.from(part).toString('base64'),sha256:await sha256(part)});};
  t.after(()=>{globalThis.fetch=fetcher;});
  const adapter=f.provider.cache(f.cache),manifest={sha256:hash,stats:{bytes:bytes.length}};
  assert.deepEqual(new Uint8Array(await loadFactoryGeometry(manifest,()=>{},identity.slice(9),undefined,adapter)),bytes);
  await loadCachedTexture({loadAsync:async()=>({})},texture.slice(8),{sha256:imageHash,bytes:image.length},adapter);
  assert.equal(requests,4);assert.equal((await f.cache.inventory()).records.length,0);
  assert.deepEqual(await readdir(path.join(f.folder,MANAGED_DIRECTORY,'factory','blobs')),[imageHash]);
  assert.equal((await readdir(path.join(f.folder,MANAGED_DIRECTORY,'factory','models',hash))).length,3);
  const next=f.create();await next.register(plan);await next.initialize();globalThis.fetch=async()=>assert.fail('Reopened resources must not download again');
  assert.deepEqual(new Uint8Array(await loadFactoryGeometry(manifest,()=>{},identity.slice(9),undefined,next.cache(f.cache))),bytes);
  await loadCachedTexture({loadAsync:async()=>({})},texture.slice(8),{sha256:imageHash,bytes:image.length},next.cache(f.cache));
  const info=await next.stats({scan:true});assert.equal(info.maps[0].bytes,bytes.length+3*64+image.length);assert.equal(info.maps[0].path,MANAGED_DIRECTORY+'/factory');
  assert.ok(f.control.modes.every(mode=>mode==='readwrite'));
});

test('partial chunks survive reopening and only missing or corrupt chunks are fetched',async t=>{
  const f=await fixture(t),bytes=new Uint8Array(CHUNK+15).fill(51),{plan,hash}=await planFor(bytes);await f.provider.register(plan);await f.provider.choose();
  const first=bytes.subarray(0,CHUNK),adapter=f.provider.cache(f.cache);await adapter.put(`geometry-chunk:${identity.slice(9)}:0:${CHUNK}`,hash,new Blob([await sha256(first),first]),adapter.ticket());
  const next=f.create();await next.register(plan);await next.initialize();let requests=[];const fetcher=globalThis.fetch;t.after(()=>{globalThis.fetch=fetcher;});
  globalThis.fetch=async url=>{const q=new URL(url,'http://localhost').searchParams,offset=Number(q.get('offset')),length=Number(q.get('length')),part=bytes.subarray(offset,offset+length);requests.push(offset);return Response.json({offset,total:bytes.length,encoding:'base64',data:Buffer.from(part).toString('base64'),sha256:await sha256(part)});};
  const manifest={sha256:hash,stats:{bytes:bytes.length}};await loadFactoryGeometry(manifest,()=>{},identity.slice(9),undefined,next.cache(f.cache));assert.deepEqual(requests,[CHUNK]);
  await writeFile(path.join(f.folder,MANAGED_DIRECTORY,'factory','models',hash,`${CHUNK}-15`),'broken');requests=[];
  await loadFactoryGeometry(manifest,()=>{},identity.slice(9),undefined,next.cache(f.cache));assert.deepEqual(requests,[CHUNK]);
});

test('managed namespace refuses occupied unmarked directories, unknown identities and bad checksums without deleting anything',async t=>{
  const f=await fixture(t);await mkdir(path.join(f.folder,MANAGED_DIRECTORY));const personal=path.join(f.folder,MANAGED_DIRECTORY,'personal.txt');await writeFile(personal,'keep');
  await assert.rejects(f.provider.choose(),/已有其他文件/);assert.equal(await readFile(personal,'utf8'),'keep');assert.equal((await readdir(path.join(f.folder,MANAGED_DIRECTORY))).length,1);
  const clean=await f.root.getDirectoryHandle('new',{create:true});const provider=createManagedResources({indexedDB:null,picker:async()=>clean,locks:null});t.after(()=>provider.close());
  const bytes=Buffer.from('valid'),{plan,hash}=await planFor(bytes);await provider.register(plan);await provider.choose();const cache=provider.cache(f.cache);
  await assert.rejects(cache.put('geometry:/api/woods-geometry',hash,new Blob([bytes]),cache.ticket()),/清单之外/);
  await assert.rejects(cache.put(identity,hash,new Blob(['wrong']),cache.ticket()),/校验失败/);
  await cache.put(identity,hash,new Blob([bytes]),cache.ticket());await provider.forget();
  assert.equal(await readFile(path.join(clean.location,MANAGED_DIRECTORY,'factory','blobs',hash),'utf8'),'valid');
});

test('existing browser resources migrate after verification; old hashes remain readable and are never evicted',async t=>{
  const f=await fixture(t),bytes=Buffer.from('first version'),{plan,hash}=await planFor(bytes);await f.cache.put(identity,hash,new Blob([bytes]));await f.provider.register(plan);await f.provider.choose();
  const cache=f.provider.cache(f.cache);assert.equal(await (await cache.get(identity,hash)).text(),bytes.toString());
  const changed=Buffer.from('second version'),next=await planFor(changed);await f.provider.register(next.plan);await cache.put(identity,next.hash,new Blob([changed]),cache.ticket());
  assert.equal(await (await cache.get(identity,hash)).text(),bytes.toString());assert.equal((await f.cache.inventory()).records.length,1,'Existing browser data stays available for compatibility');
  assert.equal((await readdir(path.join(f.folder,MANAGED_DIRECTORY,'factory','blobs'))).length,2);
});

test('permission loss and disk-full errors pause concurrent work once, then retry or switch online',async t=>{
  const f=await fixture(t),bytes=Buffer.from('payload'),{plan,hash}=await planFor(bytes);await f.provider.register(plan);await f.provider.choose();
  f.control.permission='prompt';let recoveries=0;
  f.provider.setRecoveryHandler(async message=>{recoveries++;assert.match(message,/权限/);await new Promise(resolve=>setTimeout(resolve,10));f.control.permission='granted';await f.provider.authorize();});
  const cache=f.provider.cache(f.cache);await Promise.all([cache.get(identity,hash),cache.get(identity,hash)]);assert.equal(recoveries,1);
  f.control.beforeWrite=async location=>{if(location.endsWith(hash))throw new DOMException('full','QuotaExceededError');};
  f.provider.setRecoveryHandler(async message=>{assert.match(message,/空间不足/);f.provider.setMode('online');});
  await cache.put(identity,hash,new Blob([bytes]),cache.ticket());assert.equal(f.provider.mode(),'online');assert.equal(f.control.aborts,1);
  assert.equal((await f.cache.inventory()).records.length,0,'The current write is not silently duplicated after a failed local save');
});

test('changing directory mode cancels pending stream commits; cancelled wait does not resume network work',async t=>{
  const f=await fixture(t),bytes=Buffer.from('payload'),{plan,hash}=await planFor(bytes);await f.provider.register(plan);await f.provider.choose();
  f.control.beforeWrite=async location=>{if(location.endsWith(hash))f.provider.setMode('online');};const cache=f.provider.cache(f.cache);
  await assert.rejects(cache.put(identity,hash,new Blob([bytes]),cache.ticket()),{name:'AbortError'});assert.equal(f.control.aborts,1);
  assert.equal((await readFile(path.join(f.folder,MANAGED_DIRECTORY,'factory','blobs',hash))).length,0);
  f.provider.setMode('managed');f.control.permission='prompt';let release;f.provider.setRecoveryHandler(()=>new Promise(resolve=>{release=resolve;}));const controller=new AbortController();
  const pending=f.provider.cache(f.cache,controller.signal).get(identity,hash);while(!release)await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await assert.rejects(pending,{name:'AbortError'});release();
});

test('pausing blocks new local reads and writes, resumes without losing files and does not survive a mode switch',async t=>{
  const f=await fixture(t),bytes=Buffer.from('pause payload'),{plan,hash}=await planFor(bytes);await f.provider.register(plan);await f.provider.choose();const cache=f.provider.cache(f.cache);
  f.provider.setPaused(true);let finished=false;const pending=cache.put(identity,hash,new Blob([bytes]),cache.ticket()).then(()=>{finished=true;});
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(finished,false);f.provider.setPaused(false);await pending;assert.equal(await (await cache.get(identity,hash)).text(),bytes.toString());
  f.provider.setPaused(true);f.provider.setMode('online');assert.equal((await f.provider.stats()).paused,false);
});

test('selecting an unpacked pack reuses original files through the real loaders and writes only the dedicated child',async t=>{
  const f=await fixture(t),bytes=Buffer.from('old ZIP payload'),{plan,hash}=await planFor(bytes);
  await mkdir(path.join(f.folder,'blobs'));await writeFile(path.join(f.folder,'blobs',hash),bytes);
  const metadata=JSON.stringify({schemaVersion:1,type:'tarkov-map-resource-pack',mapId:'factory',quality,resources:plan.geometry});await writeFile(path.join(f.folder,'resources.json'),metadata);
  const oldPicker=globalThis.showDirectoryPicker,oldFetch=globalThis.fetch;
  t.after(async()=>{globalThis.showDirectoryPicker=oldPicker;globalThis.fetch=oldFetch;await managedResources.forget();await localResources.forget();});
  globalThis.showDirectoryPicker=options=>{assert.equal(options.mode,'readwrite');return Promise.resolve(f.root);};globalThis.fetch=async()=>assert.fail('Existing pack should not download');
  await managedResources.register(plan);await managedResources.choose();await managedResources.prepare();
  assert.deepEqual(Buffer.from(await loadFactoryGeometry({sha256:hash,stats:{bytes:bytes.length}},()=>{},identity.slice(9))),bytes);
  assert.equal(await readFile(path.join(f.folder,'resources.json'),'utf8'),metadata);assert.equal(await readFile(path.join(f.folder,'blobs',hash),'utf8'),bytes.toString());
  assert.ok(f.control.written.every(file=>file.startsWith(path.join(f.folder,MANAGED_DIRECTORY)+path.sep)));
  assert.equal((await managedResources.stats({scan:true})).maps[0].bytes,0,'Read-only packs are not duplicated in the managed folder');
});

test('a failed handle save never silently reconnects the previously selected directory on the next visit',async t=>{
  const f=await fixture(t);await f.provider.choose();const saved=await f.settings.read(),root=await f.root.getDirectoryHandle('replacement',{create:true});
  const next=createManagedResources({storage:f.storage,settings:{read:async()=>saved,write:async()=>{throw Error('quota');}},picker:async()=>root,imports:null,indexedDB:null,locks:null});
  t.after(()=>next.close());await next.choose();assert.match((await next.stats()).reason,/无法记住/);
  const reopened=f.create(),state=await reopened.stats();assert.equal(state.connected,false);assert.equal(state.name,'');assert.match(state.reason,/重新选择/);
});
