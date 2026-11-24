// Screenshot coordinates remain Unity XYZ. This module never reads image bytes.
const number='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const vector=count=>new RegExp(`^\\(?\\s*(${Array(count).fill(number).join(')\\s*,\\s*(')})\\s*\\)?$`);
const positionPattern=vector(3),rotationPattern=vector(4);
const tailPattern=new RegExp(`^(?:_${number})?(?:\\s*\\((\\d+)\\))?$`);

export function parseScreenshotFilename(value){
  if(typeof value!=='string'||value.length>2048)return null;
  const name=value.trim().replace(/^["']|["']$/g,'').split(/[\\/]/).pop();
  const match=/^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})(?:-(\d{2}))?\]_(.+?)_(.+?)(?:\.(png|jpe?g))?$/i.exec(name);
  if(!match)return null;
  const [,year,month,day,hour,minute,second='0',xyz,rest]=match;
  const capturedAt=Date.UTC(+year,+month-1,+day,+hour,+minute,+second),date=new Date(capturedAt);
  if(date.getUTCFullYear()!==+year||date.getUTCMonth()!==+month-1||date.getUTCDate()!==+day||date.getUTCHours()!==+hour||date.getUTCMinutes()!==+minute||date.getUTCSeconds()!==+second)return null;
  const suffix=rest.replace(/\.(png|jpe?g)$/i,'');
  const rotationEnd=/^(\(?[^_]+?\)?)(_.+|\s+\(\d+\))?$/.exec(suffix);
  if(!rotationEnd)return null;
  const pos=positionPattern.exec(xyz),rot=rotationPattern.exec(rotationEnd[1]),tail=tailPattern.exec(rotationEnd[2]||'');
  if(!pos||!rot||!tail)return null;
  if([xyz,rotationEnd[1]].some(part=>part.trim().startsWith('(')!==part.trim().endsWith(')')))return null;
  const values=pos.slice(1).map(Number),quaternion=rot.slice(1).map(Number);
  if(![...values,...quaternion].every(Number.isFinite)||values.some(n=>Math.abs(n)>1e6))return null;
  return {name,position:{x:values[0],y:values[1],z:values[2]},capturedAt,duplicate:Number(tail[1]||0)};
}

export function screenshotWithinBounds(position,bounds,margin=10){
  return ['x','y','z'].every((axis,i)=>Number.isFinite(position?.[axis])&&Number.isFinite(bounds?.min?.[i])&&Number.isFinite(bounds?.max?.[i])&&position[axis]>=bounds.min[i]-margin&&position[axis]<=bounds.max[i]+margin);
}

export async function screenshotEntries(directory){
  const entries=[];
  for await(const handle of directory.values()){
    if(handle.kind!=='file'||! /\.(png|jpe?g)$/i.test(handle.name))continue;
    const parsed=parseScreenshotFilename(handle.name);
    if(parsed)entries.push({...parsed,handle});
  }
  return entries;
}

export async function latestScreenshot(entries){
  // Filename time prevents an old copied file from becoming the newest capture.
  // File modification time resolves captures within the same filename minute.
  const times=[...new Set(entries.map(entry=>entry.capturedAt))].sort((a,b)=>b-a);
  for(const time of times){
    const candidates=[];
    for(const entry of entries.filter(entry=>entry.capturedAt===time)){
      try{const file=await entry.handle.getFile();candidates.push({...entry,lastModified:file.lastModified});}
      catch(error){if(error.name!=='NotFoundError')throw error;}
    }
    candidates.sort((a,b)=>b.lastModified-a.lastModified||b.duplicate-a.duplicate||b.name.localeCompare(a.name));
    if(candidates.length)return candidates[0];
  }
  return null;
}

// Polling works in browsers without FileSystemObserver. Each scan is serialized;
// an epoch prevents a stopped/replaced connection from applying stale results.
export function createScreenshotWatcher({onLocate,onError=()=>{},schedule=setTimeout,cancel=clearTimeout,interval=1500}={}){
  let directory=null,automatic=false,suspended=true,disposed=false,seen=null,timer=null,epoch=0,pending=null;
  function clear(){cancel(timer);timer=null;}
  function queue(){clear();if(!disposed&&automatic&&!suspended&&directory)timer=schedule(()=>{timer=null;return scan(false);},interval);}
  async function scan(manual=false){
    if(disposed||suspended||!directory||(!manual&&!automatic))return null;
    if(pending){await pending.catch(()=>{});if(manual)return scan(true);return null;}
    const stamp=epoch,root=directory;
    const valid=()=>!disposed&&!suspended&&stamp===epoch&&root===directory;
    const work=(async()=>{
      const permission=await root.queryPermission({mode:'read'});
      if(permission!=='granted')throw new DOMException('请点击读取按钮重新授权截图目录。','NotAllowedError');
      const entries=await screenshotEntries(root);
      if(!valid())return null;
      const candidates=manual?entries:seen?entries.filter(entry=>!seen.has(entry.name)):[];
      const latest=await latestScreenshot(candidates);
      if(!valid())return null;
      seen=new Set(entries.map(entry=>entry.name));
      if(latest)onLocate(latest);
      else if(manual)throw Error('目录中没有可识别坐标的游戏截图，请在对局中按 Print Screen 后重试。');
      return latest;
    })();
    pending=work;
    try{return await work;}
    catch(error){if(valid()){if(['NotAllowedError','SecurityError','NotFoundError'].includes(error.name)){automatic=false;clear();}onError(error);}return null;}
    finally{if(pending===work)pending=null;queue();}
  }
  return {
    get automatic(){return automatic;},
    connect(handle){epoch++;clear();directory=handle;seen=null;if(automatic)return scan();},
    setAutomatic(value){epoch++;clear();automatic=Boolean(value);seen=null;if(automatic)return scan();},
    setSuspended(value){if(suspended===Boolean(value))return;epoch++;suspended=Boolean(value);clear();if(!suspended&&automatic)return scan();},
    read:()=>scan(true),
    poll:()=>scan(false),
    dispose(){disposed=true;epoch++;clear();directory=null;},
  };
}

export function createScreenshotDirectoryStore(indexedDB=globalThis.indexedDB){
  let opening;
  async function database(){
    if(!indexedDB)throw Error('此浏览器无法记住截图目录，本次仍可使用。');
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('atlas-screenshot-directory-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('settings');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  async function setting(write,value){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('settings',write?'readwrite':'readonly'),store=tx.objectStore('settings');
      const request=write?store.put(value,'directory'):store.get('directory');
      tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
    });
  }
  return {read:()=>setting(false),write:value=>setting(true,value)};
}
