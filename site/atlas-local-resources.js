// User-selected external files are read-only. Never create, overwrite or remove
// entries in this directory. Only its handle and a location note live in IDB.
import {cacheOwner} from './atlas-cache-identity.js';

const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
export function validateResourcePack(value){
  if(value?.schemaVersion!==1||value.type!=='tarkov-map-resource-pack'||!Array.isArray(value.resources)||value.resources.length>100000)throw Error('资源包目录无效');
  const seen=new Set();
  for(const row of value.resources){
    if(!Array.isArray(row)||row.length!==3)throw Error('资源包条目无效');
    const [identity,hash,bytes]=row,owner=cacheOwner(identity),key=identity+'|'+hash;
    if(owner.mapId!==value.mapId||!['geometry','texture'].includes(owner.kind)||!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(bytes)||bytes<1||seen.has(key))throw Error('资源包条目无效');
    seen.add(key);
  }
  return value;
}
export function createLocalResources({indexedDB=globalThis.indexedDB,picker=()=>globalThis.showDirectoryPicker({id:'map-resources',mode:'read'}),events=globalThis}={}){
  let opening,directory,note='',reason='',needsPermission=false,ready,index=new Map(),packs=[],epoch=0,hitBytes=0;
  async function database(){
    if(!indexedDB)return null;
    if(!opening)opening=new Promise((resolve,reject)=>{const request=indexedDB.open('atlas-local-directory-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}).catch(error=>{opening=null;throw error;});
    return opening;
  }
  async function setting(value,write=false){
    const db=await database();if(!db)return null;
    return new Promise((resolve,reject)=>{const tx=db.transaction('settings',write?'readwrite':'readonly'),store=tx.objectStore('settings'),request=write?store.put(value,'directory'):store.get('directory');let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});
  }
  async function scan(root){
    const candidates=[root],next=new Map(),found=[];
    for await(const child of root.values()){if(child.kind==='directory'&&child.name!=='blobs')candidates.push(child);if(candidates.length>256)throw Error('请选择只包含地图资源包的专用目录');}
    for(const candidate of candidates){
      let file;try{file=await (await candidate.getFileHandle('resources.json')).getFile();}catch(error){if(error.name==='NotFoundError')continue;throw error;}
      if(file.size>8*2**20)throw Error('资源包目录过大');
      const pack=validateResourcePack(JSON.parse(await file.text()));
      const blobs=await candidate.getDirectoryHandle('blobs');
      for(const [identity,hash,bytes] of pack.resources)next.set(identity+'|'+hash,{directory:blobs,bytes,hash});
      found.push({mapId:pack.mapId,quality:pack.quality,name:candidate.name,count:pack.resources.length,bytes:pack.resources.reduce((n,r)=>n+r[2],0)});
    }
    if(!found.length)throw Error('未找到资源包，请先解压，再选择资源包目录或其上一级目录');
    return {index:next,packs:found};
  }
  async function restore(){
    const stamp=epoch;
    try{const saved=await setting();if(stamp!==epoch)return;note=saved?.note||'';if(!saved?.directory)return;
      const granted=await saved.directory.queryPermission({mode:'read'});if(stamp!==epoch)return;
      directory=saved.directory;note=saved.note||'';
      if(granted!=='granted'){needsPermission=true;return;}
      const result=await scan(directory);if(stamp!==epoch)return;index=result.index;packs=result.packs;
    }catch(error){if(stamp===epoch)reason=error.message;}
  }
  const notify=()=>{try{globalThis.localStorage?.setItem('atlas-local-directory-epoch',`${Date.now()}-${Math.random()}`);}catch{}};
  const changed=event=>{if(event.key!=='atlas-local-directory-epoch')return;epoch++;directory=null;index=new Map();packs=[];note='';reason='';needsPermission=false;ready=null;};
  events.addEventListener?.('storage',changed);
  const initialize=()=>ready||(ready=restore());
  async function connect(root){
    const stamp=++epoch,result=await scan(root);if(stamp!==epoch)return;
    directory=root;index=result.index;packs=result.packs;reason='';needsPermission=false;ready=Promise.resolve();
    try{
      if(!indexedDB)throw Error('No persistent settings');
      await setting({directory:directory.temporary?null:directory,note},true);
    }catch{
      // Never leave a formerly selected directory associated after an ephemeral
      // selection replaces it. Clearing this handle does not touch external files.
      await setting({directory:null,note},true).catch(()=>{});
      reason='目录已连接，但浏览器无法记住此目录，下次需要重新选择。';
    }
    notify();
  }
  return {
    initialize,
    connectDirectory:connect,
    async choose(){const root=await picker();await connect(root);},
    async importFiles(files){await connect(directoryFromFiles(files));reason='目录已连接。本浏览器需要在下次访问时重新选择目录。';},
    async authorize(){await initialize();if(!directory)return;if(await directory.requestPermission({mode:'read'})!=='granted')throw Error('未获得目录读取权限');await connect(directory);},
    async refresh(){await initialize();if(directory)await connect(directory);},
    async forget(){epoch++;directory=null;index.clear();packs=[];note='';reason='';needsPermission=false;ready=Promise.resolve();await setting(null,true);notify();},
    async saveNote(value){await initialize();note=String(value).slice(0,500);await setting({directory:directory?.temporary?null:directory,note},true);notify();},
    async stats(){await initialize();return {name:directory?.name||'',note,reason,needsPermission,packs,hitBytes,connected:Boolean(directory&&!needsPermission&&packs.length)};},
    async get(identity,hash,bytes){
      await initialize();const entry=index.get(identity+'|'+hash),stamp=epoch;
      if(!entry||needsPermission)return null;
      try{const file=await (await entry.directory.getFileHandle(hash)).getFile();
        if(file.size!==entry.bytes||(bytes&&file.size!==bytes)||await digest(file)!==hash)throw Error('本地资源校验失败，已改用在线资源；可在设置中选择资源保存位置，自动补充所需资源');
        if(stamp!==epoch)return null;hitBytes+=file.size;return file;
      }catch(error){reason=error.name==='NotAllowedError'?'目录权限已失效，请重新授权读取。':error.message;if(error.name==='NotAllowedError')needsPermission=true;return null;}
    },
    async close(){events.removeEventListener?.('storage',changed);if(opening)(await opening).close();}
  };
}
export const localResources=createLocalResources();

export function directoryFromFiles(files){
  const make=name=>({kind:'directory',name,temporary:true,children:new Map(),async *values(){yield* this.children.values();},
    async queryPermission(){return 'granted';},async getFileHandle(name){const child=this.children.get(name);if(child?.kind!=='file')throw new DOMException('文件不存在','NotFoundError');return child;},
    async getDirectoryHandle(name){const child=this.children.get(name);if(child?.kind!=='directory')throw new DOMException('目录不存在','NotFoundError');return child;}});
  let root;
  for(const file of files){
    const parts=file.webkitRelativePath?.split('/');if(!parts||parts.length<2||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw Error('请选择已解压的资源包文件夹');
    root||=make(parts[0]);if(root.name!==parts[0])throw Error('请选择同一个资源目录');let parent=root;
    for(const name of parts.slice(1,-1)){if(!parent.children.has(name))parent.children.set(name,make(name));parent=parent.children.get(name);}
    parent.children.set(parts.at(-1),{kind:'file',name:parts.at(-1),getFile:async()=>file});
  }
  if(!root)throw Error('所选目录没有文件');return root;
}
