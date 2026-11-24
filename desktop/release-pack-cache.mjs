import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

// Only GitHub endpoints that ignore Range use this cache. Serialize access so
// parallel map requests cannot allocate several multi-gigabyte fallback files.
const queues = new Map();
export function createReleasePackCache(cacheRoot) {
  const root = path.resolve(cacheRoot, 'release-packs');
  const verified = new Map();
  async function exclusive(run) {
    const previous = queues.get(root) || Promise.resolve();
    const pending = previous.catch(() => {}).then(run); queues.set(root,pending);
    try { return await pending; } finally { if (queues.get(root) === pending) queues.delete(root); }
  }
  async function ready() {
    await fs.mkdir(root,{recursive:true});
    if ((await fs.lstat(root)).isSymbolicLink()) throw Error('资源包缓存不能使用链接');
  }
  async function valid(file,pack) {
    let stat;
    try { stat=await fs.lstat(file); } catch(error) { if(error.code==='ENOENT')return false;throw error; }
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size!==pack.bytes)return false;
    const stamp=`${stat.size}/${stat.mtimeMs}/${stat.ctimeMs}`;
    if(verified.get(pack.sha256)===stamp)return true;
    const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);
    if(hash.digest('hex')!==pack.sha256)return false;
    verified.set(pack.sha256,stamp);return true;
  }
  async function slice(file,offset,length) {
    const handle=await fs.open(file,'r'),bytes=Buffer.allocUnsafe(length);let read=0;
    try { while(read<length){const part=await handle.read(bytes,read,length-read,offset+read);if(!part.bytesRead)throw Error('资源包缓存不完整');read+=part.bytesRead;} }
    finally { await handle.close(); }
    return bytes;
  }
  return {
    read(pack,offset,length,response,signal) {
      return exclusive(async()=>{
        try {
          signal?.throwIfAborted(); await ready();
          const file=path.join(root,pack.sha256+'.zip');
          if(await valid(file,pack))return await slice(file,offset,length);
          if(!response)return null;
          if(Number(response.headers.get('content-length'))>pack.bytes)throw Error('资源超过预期大小');
          // Evict only this module's hash-named cache files, never map-resources.
          for(const name of await fs.readdir(root))if(/^[a-f0-9]{64}\.zip$/.test(name)){
            const old=path.join(root,name),stat=await fs.lstat(old);
            if(stat.isFile()&&!stat.isSymbolicLink())await fs.unlink(old);
          }
          verified.clear();
          const temp=path.join(root,randomUUID()+'.tmp');
          const handle=await fs.open(temp,'wx');let count=0;const hash=createHash('sha256');
          try {
            for await(const part of response.body){signal?.throwIfAborted();count+=part.length;if(count>pack.bytes)throw Error('资源超过预期大小');hash.update(part);await handle.writeFile(part);}
            if(count!==pack.bytes||hash.digest('hex')!==pack.sha256)throw Error('GitHub 资源包校验失败');
            await handle.close(); await fs.rename(temp,file);
            const stat=await fs.stat(file);verified.set(pack.sha256,`${stat.size}/${stat.mtimeMs}/${stat.ctimeMs}`);
            return await slice(file,offset,length);
          } finally { await handle.close(); await fs.rm(temp,{force:true}); }
        } finally { await response?.body?.cancel().catch(()=>{}); }
      });
    }
  };
}
