// Only the marked application directory is writable. There is deliberately no
// removeEntry/remove implementation: users clean up map directories themselves.
import {ATLAS_MAPS} from './atlas-maps.js';
import {cacheOwner} from './atlas-cache-identity.js';
import {validateResourcePack,localResources} from './atlas-local-resources.js';
import {directoryError,mapLoadError} from './atlas-map-diagnostics.js';

export const MANAGED_DIRECTORY='tarkov-map-resources';
const MARKER='atlas-directory.json',TYPE='tarkov-managed-resources',MODE_KEY='atlas-resource-mode-v1',EPOCH_KEY='atlas-managed-directory-epoch',BINDING_KEY='atlas-managed-directory-binding';
const CHUNK=4*2**20,HASH=/^[a-f0-9]{64}$/;
const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
const missing=error=>error.name==='NotFoundError';
const stale=()=>new DOMException('资源目录已切换，请重试当前地图','AbortError');
function preferences(){try{return globalThis.localStorage;}catch{return null;}}
async function readFile(root,parts){let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);return (await dir.getFileHandle(parts.at(-1))).getFile();}
async function optionalFile(root,parts){try{return await readFile(root,parts);}catch(error){if(missing(error))return null;throw error;}}

export function createManagedResources({indexedDB=globalThis.indexedDB,storage=preferences(),events=globalThis,settings,client=globalThis.location?.protocol==='tarkov:'&&globalThis.location?.hostname==='app',
  picker=()=>globalThis.showDirectoryPicker({id:'atlas-managed-resources',mode:'readwrite'}),locks=globalThis.navigator?.locks,imports=localResources}={}){
  let opening,ready,directory,note='',reason='',needsPermission=false,epoch=0,recovery,recoverHandler,paused=false,pauseWait,resumePaused;
  const modeKey=client?'atlas-desktop-resource-mode-v1':MODE_KEY,defaultMode=client?'client':'';
  function savedMode(){const value=storage?.getItem(modeKey);if(['managed','online','manual',...(client?['client']:[])].includes(value))return value;
    // Retain explicitly linked external directories when upgrading previews.
    const old=storage?.getItem(MODE_KEY);return client&&['managed','manual'].includes(old)?old:defaultMode;}
  let mode,binding;try{mode=savedMode();binding=storage?.getItem(BINDING_KEY)||'';}catch{mode=defaultMode;binding='';}
  const entries=new Map(),plans=new Map(),ignored=new Set(),writes=new Map();
  const metrics={hitBytes:0,writeBytes:0};
  async function setting(value,write=false){
    if(settings)return write?settings.write(value):settings.read();
    if(!indexedDB)return null;
    opening||=new Promise((resolve,reject)=>{const r=indexedDB.open('atlas-managed-directory-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const db=await opening;
    return new Promise((resolve,reject)=>{const tx=db.transaction('settings',write?'readwrite':'readonly'),store=tx.objectStore('settings'),r=write?store.put(value,'directory'):store.get('directory');let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};});
  }
  async function hasMarker(root){
    const file=await optionalFile(root,[MARKER]);if(!file)return false;
    if(file.size>4096)throw mapLoadError('STORAGE-DIRECTORY-MARKER', '所选目录的资源标识无效，请选择其他专用目录');
    const value=JSON.parse(await file.text());
    if(value?.schemaVersion!==1||value.type!==TYPE)throw mapLoadError('STORAGE-DIRECTORY-MARKER', '所选目录的资源标识无效，请选择其他专用目录');return true;
  }
  async function atomic(root,parts,blob,stamp=epoch){
    if(stamp!==epoch)throw stale();let dir=root;
    for(const name of parts.slice(0,-1)){dir=await dir.getDirectoryHandle(name,{create:true});if(stamp!==epoch)throw stale();}
    const file=await dir.getFileHandle(parts.at(-1),{create:true}),stream=await file.createWritable();
    try{await stream.write(blob);if(stamp!==epoch)throw stale();await stream.close();}
    catch(error){await stream.abort().catch(()=>{});throw error;}
  }
  const notify=()=>{try{storage?.setItem(EPOCH_KEY,`${Date.now()}-${Math.random()}`);}catch{}};
  async function persist(){
    try{if(!indexedDB&&!settings)throw Error();await setting({directory,note,binding},true);}
    catch{reason='此浏览器无法记住目录，下次访问需要重新选择原目录。';}
  }
  async function restore(){const stamp=epoch;let candidate;try{const saved=await setting();if(stamp!==epoch)return;
    if(saved?.directory&&saved.binding!==binding){reason='上次选择的目录未能记住，请重新选择原目录。';return;}
    candidate=saved?.directory;
    const denied=candidate&&await candidate.queryPermission({mode:'readwrite'})!=='granted';if(stamp!==epoch)return;
    if(candidate&&!denied&&!await hasMarker(candidate))throw Error('专用目录标识缺失，请重新选择目录');if(stamp!==epoch)return;
    directory=candidate;note=saved?.note||'';needsPermission=Boolean(denied);
  }catch(error){if(stamp===epoch){directory=candidate;needsPermission=true;reason=error.message;}}}
  const initialize=()=>ready||(ready=restore());
  function setPaused(value){paused=Boolean(value);if(paused)pauseWait||=new Promise(resolve=>{resumePaused=resolve;});else{resumePaused?.();pauseWait=null;resumePaused=null;}}
  function setMode(value){if(!['managed','online','manual',...(client?['client']:[])].includes(value))throw Error('资源模式无效');mode=value;epoch++;ignored.clear();setPaused(false);try{storage?.setItem(modeKey,value);}catch{}notify();}
  async function connect(selected){
    let root=selected;
    const connectRoot=async()=>{
      if(!await hasMarker(root)){
        root=await selected.getDirectoryHandle(MANAGED_DIRECTORY,{create:true});
        if(!await hasMarker(root)){
          for await(const unused of root.values())throw mapLoadError('STORAGE-DIRECTORY-OCCUPIED', '同名子目录已有其他文件，请选择其他位置或空的专用目录');
          await atomic(root,[MARKER],new Blob([JSON.stringify({schemaVersion:1,type:TYPE})]));
        }
      }
      return root;
    };
    root=locks?await locks.request('atlas-managed-connect',connectRoot):await connectRoot();
    epoch++;directory=root;needsPermission=false;reason='';ignored.clear();ready=Promise.resolve();
    binding=`${Date.now()}-${Math.random()}`;try{storage?.setItem(BINDING_KEY,binding);}catch{}
    setMode('managed');await persist();
    await atomic(root,['使用说明.txt'],new Blob(['本目录由塔科夫物资地图自动管理。\r\n每张地图对应一个英文名称子目录；模型、贴图和各画质清单分别保存。只下载当前需要且缺失的资源。\r\n再次访问网站会校验并复用文件，权限失效时请重新授权或选择本目录。\r\n清理时先在网站切换到在线模式并关闭其他地图标签页，再自行删除对应地图子目录，或删除整个专用目录。网站不会自动删除文件。\r\n不要在此专用目录存放个人文件。网页与任务等其他数据仍需要联网。\r\n']));
    // A selected unpacked ZIP (or its parent) stays a read-only source. Missing
    // resources are written exclusively into the separate managed directory.
    if(root!==selected)await imports?.connectDirectory(selected).catch(()=>{});
    notify();
  }
  async function recover(error){
    reason=error.name==='NotAllowedError'?'目录权限已失效，请重新授权。':error.name==='QuotaExceededError'?'磁盘空间不足，请手动清理后重试，或切换在线模式。':`本地资源读写失败：${error.message}`;
    if(error.name==='NotAllowedError')needsPermission=true;
    if(!recoverHandler)throw error;
    if(!recovery){
      const failure=directoryError(error,reason);
      recovery=Promise.resolve().then(()=>recoverHandler(failure.message,failure)).finally(()=>{recovery=null;});
    }
    await recovery;
    if(mode==='managed'&&!needsPermission)reason='';
  }
  async function run(operation,signal){
    for(;;){signal?.throwIfAborted();await initialize();if(recovery)await wait(recovery,signal);if(pauseWait)await wait(pauseWait,signal);if(mode!=='managed')return null;
      try{if(!directory||needsPermission)throw new DOMException('需要选择或授权资源目录','NotAllowedError');return await operation();}
      catch(error){if(error.name==='AbortError')throw error;await wait(recover(error),signal);}
    }
  }
  function wait(promise,signal){
    if(!signal)return promise;signal.throwIfAborted();
    return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||stale());signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
  }
  function entryFor(identity,version){
    const match=identity.match(/^geometry-chunk:(.+):(\d+):(\d+)$/),key=(match?'geometry:'+match[1]:identity)+'|'+version,entry=entries.get(key);
    if(!entry)return null;
    if(!match)return {...entry,key};
    const offset=Number(match[2]),length=Number(match[3]);
    if(offset%CHUNK||offset<0||length!==Math.min(CHUNK,entry.bytes-offset)||length<1)return null;
    return {...entry,key,offset,length};
  }
  const pathFor=(entry,hash)=>entry.length?[entry.mapId,'models',hash,`${entry.offset}-${entry.length}`]:[entry.mapId,'blobs',hash];
  async function chunkBlob(entry,hash){
    const parts=[];
    for(let offset=0;offset<entry.bytes;offset+=CHUNK){const length=Math.min(CHUNK,entry.bytes-offset),key=`geometry-chunk:${entry.identity.slice(9)}:${offset}:${length}|${hash}`;
      if(ignored.has(key))return null;
      const blob=await optionalFile(directory,[entry.mapId,'models',hash,`${offset}-${length}`]);if(!blob||blob.size!==length+64)return null;
      const header=await blob.slice(0,64).text(),body=blob.slice(64);if(!HASH.test(header)||await digest(body)!==header){ignored.add(key);return null;}parts.push(body);
    }
    const full=new Blob(parts);if(await digest(full)!==hash){
      for(let offset=0;offset<entry.bytes;offset+=CHUNK)ignored.add(`geometry-chunk:${entry.identity.slice(9)}:${offset}:${Math.min(CHUNK,entry.bytes-offset)}|${hash}`);
      return null;
    }return full;
  }
  async function get(identity,hash,signal){
    const entry=entryFor(identity,hash);if(!entry)return null;
    return run(async()=>{if(ignored.has(identity+'|'+hash))return null;const stamp=epoch;
      let blob=await optionalFile(directory,pathFor(entry,hash));
      if(blob){const body=entry.length?blob.slice(64):blob,expected=entry.length?await blob.slice(0,64).text():hash;
        if(body.size!==(entry.length||entry.bytes)||!HASH.test(expected)||await digest(body)!==expected)blob=null;}
      if(!blob&&!entry.length&&entry.identity.startsWith('geometry:'))blob=await chunkBlob(entry,hash);
      if(stamp!==epoch)throw stale();if(blob)metrics.hitBytes+=entry.length||blob.size;return blob;
    },signal);
  }
  async function put(identity,hash,blob,startTicket,signal){
    const entry=entryFor(identity,hash);if(!entry)throw Error('拒绝保存清单之外的资源');
    const body=entry.length?blob.slice(64):blob,expected=entry.length?await blob.slice(0,64).text():hash;
    if(body.size!==(entry.length||entry.bytes)||!HASH.test(expected)||await digest(body)!==expected)throw Error('拒绝保存校验失败的资源');
    if(startTicket!==epoch)throw stale();
    const key=identity+'|'+hash;
    return run(async()=>{
      // Retain verified chunks as the permanent model representation; do not
      // store a second full copy or remove resume files after a completed load.
      if(!entry.length&&entry.identity.startsWith('geometry:')&&await chunkBlob(entry,hash)){ignored.delete(key);return true;}
      const stamp=epoch,root=directory;
      const write=async()=>{signal?.throwIfAborted();if(stamp!==epoch)throw stale();await atomic(root,pathFor(entry,hash),blob,stamp);ignored.delete(key);metrics.writeBytes+=body.size;return true;};
      const previous=writes.get(key)||Promise.resolve(),pending=previous.catch(()=>{}).then(()=>locks?locks.request('atlas-resource:'+key,write):write());writes.set(key,pending);
      try{return await pending;}finally{if(writes.get(key)===pending)writes.delete(key);}
    },signal);
  }
  async function register(plan){
    const quality=plan.quality;
    if(!Object.hasOwn(ATLAS_MAPS,plan.mapId)||!quality||!['original','medium','low'].includes(quality.geometry)||!['original','medium','low'].includes(quality.texture)||!['full','simple'].includes(quality.scenery))throw Error('资源画质清单无效');
    const pack=validateResourcePack({schemaVersion:1,type:'tarkov-map-resource-pack',mapId:plan.mapId,quality,resources:[...plan.geometry,...plan.texture]});
    for(const [identity,hash,bytes] of pack.resources)entries.set(identity+'|'+hash,{identity,mapId:plan.mapId,bytes});
    const blob=new Blob([JSON.stringify(pack)]),hash=await digest(blob);
    plans.set(plan.mapId,{blob,path:[plan.mapId,'plans',`${quality.geometry}-${quality.texture}-${quality.scenery}-${hash}.json`]});
  }
  async function prepare(){await initialize();if(mode!=='managed')return;
    for(const plan of plans.values())await run(async()=>{const existing=await optionalFile(directory,plan.path);if(!existing||await existing.text()!==await plan.blob.text())await atomic(directory,plan.path,plan.blob);});
  }
  async function inventory(){await initialize();const maps=[];if(!directory||needsPermission)return maps;
    for(const map of Object.values(ATLAS_MAPS)){
      let root;try{root=await directory.getDirectoryHandle(map.id);}catch(error){if(missing(error))continue;throw error;}
      let bytes=0,count=0;
      async function sizes(dir,depth){for await(const child of dir.values()){
        if(child.kind==='file'){const file=await child.getFile();bytes+=file.size;count++;}
        else if(depth>0)await sizes(child,depth-1);
      }}
      for(const name of ['blobs','models'])try{await sizes(await root.getDirectoryHandle(name),name==='models'?1:0);}catch(error){if(!missing(error))throw error;}
      maps.push({mapId:map.id,path:directory.name+'/'+map.id,bytes,count});
    }return maps;
  }
  const changed=event=>{if(event.key!==EPOCH_KEY)return;epoch++;directory=null;note='';reason='';needsPermission=false;ready=null;ignored.clear();setPaused(false);try{mode=savedMode();binding=storage?.getItem(BINDING_KEY)||'';}catch{mode=defaultMode;binding='';}};
  events.addEventListener?.('storage',changed);
  return {
    initialize,register,prepare,setMode,setPaused,mode:()=>mode,client,
    // Native protocol reads/writes the installation's map-resources directory.
    // Avoid a second full copy in IndexedDB or HTTP cache in this mode.
    clientCache:{client:true,managed:true,enabled:()=>false,ticket:()=>0,get:async()=>null,put:async()=>{},remove:async()=>{}},
    setRecoveryHandler(handler){recoverHandler=handler;},
    // Both privileged prompts are called synchronously from button handlers.
    async choose(){const root=await picker();await connect(root);},
    async authorize(){if(!directory)throw Error('请重新选择资源目录');const stamp=epoch,root=directory,granted=await root.requestPermission({mode:'readwrite'});if(stamp!==epoch)throw stale();if(granted!=='granted')throw Error('未获得目录读写权限');if(!await hasMarker(root))throw Error('资源目录标识缺失，请重新选择');if(stamp!==epoch)throw stale();needsPermission=false;reason='';},
    async forget(){setMode(client?'client':'online');directory=null;note='';needsPermission=false;reason='';ready=Promise.resolve();binding='';try{storage?.setItem(BINDING_KEY,'');}catch{}await setting(null,true);notify();},
    async saveNote(value){note=String(value).slice(0,500);await persist();notify();},
    async stats({scan=false}={}){await initialize();let maps=[];if(scan)try{maps=await inventory();}catch(error){reason=error.message;if(error.name==='NotAllowedError')needsPermission=true;}
      return {mode,revision:epoch,paused,name:directory?.name||'',note,reason,needsPermission,connected:Boolean(directory&&!needsPermission),maps,...metrics};},
    addSource(identity,hash,bytes){const owner=cacheOwner(identity);if(owner.kind==='geometry'&&HASH.test(hash)&&Number.isSafeInteger(bytes)&&bytes>0)entries.set(identity+'|'+hash,{identity,mapId:owner.mapId,bytes});},
    cache(fallback,signal){return {
      managed:true,ticket:()=>epoch,enabled:()=>true,
      async get(identity,hash){await initialize();if(mode!=='managed')return fallback.get(identity,hash);const blob=await get(identity,hash,signal);if(blob)return blob;
        if(mode!=='managed')return fallback.get(identity,hash);
        const existing=await fallback.get(identity,hash),entry=entryFor(identity,hash);
        if(existing&&entry){const stamp=epoch;try{await put(identity,hash,existing,stamp,signal);return existing;}catch(error){if(error.message==='拒绝保存校验失败的资源')return null;throw error;}}return null;
      },
      async put(identity,hash,blob,stamp,partials){await initialize();if(mode!=='managed')return fallback.put(identity,hash,blob,fallback.ticket(identity),partials);return put(identity,hash,blob,stamp,signal);},
      async remove(identity,hash){ignored.add(identity+'|'+hash);if(mode!=='managed')await fallback.remove(identity,hash);},
      recordFetch:bytes=>fallback.recordFetch?.(bytes),recordResume:bytes=>fallback.recordResume?.(bytes)
    };},
    async close(){events.removeEventListener?.('storage',changed);if(opening)(await opening).close();}
  };
}
export const managedResources=createManagedResources();
