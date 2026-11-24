import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLocalResources,directoryFromFiles,validateResourcePack,localResources} from '../../site/atlas-local-resources.js';
import {loadFactoryGeometry} from '../../site/factory-geometry.js';
import {loadCachedTexture,resourceCache} from '../../site/atlas-resource-cache.js';

const bytes=Buffer.from('verified local model'),hash=createHash('sha256').update(bytes).digest('hex'),identity='geometry:/api/factory-geometry/low';
const manifest={schemaVersion:1,type:'tarkov-map-resource-pack',mapId:'factory',quality:{geometry:'low',texture:'medium',scenery:'full'},resources:[[identity,hash,bytes.length]]};
function file(name,content){const file=new File([content],name.split('/').at(-1));Object.defineProperty(file,'webkitRelativePath',{value:name});return file;}
function files(content=bytes){return [file('resources/factory/resources.json',JSON.stringify(manifest)),file('resources/factory/blobs/'+hash,content)];}

test('external packs supply verified bytes without write/delete methods or an IndexedDB copy',async()=>{
  const provider=createLocalResources({indexedDB:null});await provider.importFiles(files());
  assert.equal(await (await provider.get(identity,hash,bytes.length)).text(),bytes.toString());
  assert.equal(await provider.get(identity,'a'.repeat(64),bytes.length),null);
  assert.equal((await provider.stats()).hitBytes,bytes.length);
  await provider.saveNote('D:\\Maps');assert.equal((await provider.stats()).note,'D:\\Maps');
  await provider.forget();assert.equal(await provider.get(identity,hash,bytes.length),null);
  await provider.importFiles(files());assert.equal(await (await provider.get(identity,hash,bytes.length)).text(),bytes.toString());
});

test('missing, corrupt and wrongly sized local files fall back without deleting user files',async()=>{
  const provider=createLocalResources({indexedDB:null});await provider.importFiles(files(Buffer.alloc(bytes.length)));
  assert.equal(await provider.get(identity,hash,bytes.length),null);assert.match((await provider.stats()).reason,/校验失败/);
  await provider.importFiles(files());assert.equal(await provider.get(identity,hash,bytes.length+1),null);
});

test('directory permissions are read-only, denial requests reconnection, and no authority is inferred from a path note',async()=>{
  const root=directoryFromFiles(files()),modes=[];let allowed=true;
  root.queryPermission=async options=>{modes.push(options.mode);return allowed?'granted':'prompt';};
  root.requestPermission=async options=>{modes.push(options.mode);return allowed?'granted':'denied';};
  const provider=createLocalResources({indexedDB:null,picker:async()=>root});await provider.choose();
  const blobs=await (await root.getDirectoryHandle('factory')).getDirectoryHandle('blobs'),get=blobs.getFileHandle;
  blobs.getFileHandle=async()=>{throw new DOMException('denied','NotAllowedError');};
  assert.equal(await provider.get(identity,hash,bytes.length),null);assert.equal((await provider.stats()).needsPermission,true);
  allowed=false;await assert.rejects(provider.authorize(),/未获得/);allowed=true;blobs.getFileHandle=get;await provider.authorize();
  assert.ok(await provider.get(identity,hash,bytes.length));assert.ok(modes.every(mode=>mode==='read'));
});

test('pack metadata rejects cross-map identities, unsafe paths, duplicate entries and invalid hashes',()=>{
  for(const resources of [[['geometry:/api/woods-geometry/low/s_0_0',hash,1]],[[identity,'../file',1]],[manifest.resources[0],manifest.resources[0]],[[identity,hash,-1]]])assert.throws(()=>validateResourcePack({...manifest,resources}));
  assert.throws(()=>directoryFromFiles([file('root/../resources.json','x')]),/请选择/);
});

test('real loaders consume local geometry, derived simple geometry and textures without fetching or copying into cache',async t=>{
  const textureIdentity='texture:/data/model-quality/factory/medium/a.webp',source=[file('resources/resources.json',JSON.stringify({...manifest,resources:[...manifest.resources,[textureIdentity,hash,bytes.length]]})),file('resources/blobs/'+hash,bytes)];
  await localResources.importFiles(source);const original=globalThis.fetch,put=resourceCache.put;
  globalThis.fetch=async()=>{throw Error('Local resources must not fetch');};resourceCache.put=async()=>{throw Error('Local resources must not be copied');};
  t.after(async()=>{globalThis.fetch=original;resourceCache.put=put;await localResources.forget();});
  const detail={stats:{bytes:bytes.length},sha256:hash},progress=[];
  assert.deepEqual(Buffer.from(await loadFactoryGeometry(detail,(...args)=>progress.push(args),'api/factory-geometry/low')),bytes);assert.ok(progress.every(row=>row[2]==='local'));
  const simple=bytes.subarray(0,5),simpleHash=createHash('sha256').update(simple).digest('hex');
  const filtered={stats:{bytes:5},sha256:simpleHash,decorationFilter:{removedMeshes:1,sourceGeometrySha256:hash,sourceBytes:bytes.length,spans:[[0,0,5]]}};
  assert.deepEqual(Buffer.from(await loadFactoryGeometry(filtered,()=>{},'api/factory-geometry/low/simple')),simple);
  const loader={loadAsync:async url=>{assert.match(url,/^blob:/);return 'texture';}};
  assert.equal(await loadCachedTexture(loader,textureIdentity.slice(8),{sha256:hash,bytes:bytes.length}),'texture');
});
