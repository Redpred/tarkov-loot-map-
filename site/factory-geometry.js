import {resourceCache,sha256} from './atlas-resource-cache.js';
import {sceneryEndpoint} from './atlas-scenery-details.js';
import {localResources} from './atlas-local-resources.js';
import {managedResources} from './atlas-managed-resources.js';
export const geometryProgressText=(done,total,source)=>({cache:'读取本地模型缓存',local:'读取本地资源包',resume:'恢复已下载分块',verify:'校验模型',network:'在线读取模型'}[source]||'在线读取模型')+` ${Math.round(done/total*100)}%`;
// Keep the binary on disk for the exporter, but transfer it as ordinary JSON.
// Download-manager browser extensions can otherwise capture the .bin fetch.
export async function loadFactoryGeometry(manifest,onProgress=()=>{},endpoint='api/factory-geometry',signal,cache=resourceCache){
  endpoint=sceneryEndpoint(endpoint,manifest);
  const total=manifest.stats.bytes,chunkSize=4*1024*1024;
  if(!Number.isSafeInteger(total)||total<=0||!/^[a-f0-9]{64}$/.test(manifest.sha256))
    throw new Error('模型清单无效，请重新生成几何数据');
  signal?.throwIfAborted();
  const identity=`geometry:${new URL(endpoint,globalThis.location?.href||'http://localhost/').pathname}`;
  const useExternal=cache===resourceCache;
  const external=useExternal&&managedResources.mode()!=='client'?await localResources.get(identity,manifest.sha256,total):null;
  if(useExternal&&managedResources.mode()==='managed')cache=managedResources.cache(cache,signal);
  if(useExternal&&managedResources.mode()==='client')cache=managedResources.clientCache;
  const startTicket=cache.ticket(identity);
  signal?.throwIfAborted();
  if(external){onProgress(0,total,'local');const buffer=await external.arrayBuffer();signal?.throwIfAborted();onProgress(total,total,'local');return buffer;}
  const cached=await cache.get(identity,manifest.sha256);
  signal?.throwIfAborted();
  if(cached){
    onProgress(0,total,'cache');
    const buffer=await cached.arrayBuffer();
    signal?.throwIfAborted();
    const valid=buffer.byteLength===total&&await sha256(buffer)===manifest.sha256;
    signal?.throwIfAborted();
    if(valid){onProgress(total,total,'cache');return buffer;}
    await cache.remove(identity,manifest.sha256);
  }
  const filter=manifest.decorationFilter;
  if(filter?.removedMeshes>0){
    const sourceIdentity=identity.replace(/\/simple(?=\/|$)/,'');
    const externalSource=useExternal&&managedResources.mode()!=='client'?await localResources.get(sourceIdentity,filter.sourceGeometrySha256,filter.sourceBytes):null;
    const source=externalSource||await cache.get(sourceIdentity,filter.sourceGeometrySha256);
    signal?.throwIfAborted();
    if(source){
      onProgress(0,total,externalSource?'local':'cache');const raw=await source.arrayBuffer();signal?.throwIfAborted();
      const valid=raw.byteLength===filter.sourceBytes&&await sha256(raw)===filter.sourceGeometrySha256;signal?.throwIfAborted();
      if(valid){
        const derived=new Uint8Array(total);let cursor=0,previousEnd=0;
        for(const [out,start,length] of filter.spans){
          if(![out,start,length].every(Number.isSafeInteger)||out!==cursor||start<previousEnd||length<1||start+length>raw.byteLength||out+length>total)throw Error('装饰筛选范围无效');
          derived.set(new Uint8Array(raw,start,length),out);cursor+=length;previousEnd=start+length;
        }
        if(cursor!==total||await sha256(derived)!==manifest.sha256)throw Error('装饰筛选校验失败');signal?.throwIfAborted();
        if(!externalSource&&cache.enabled?.()!==false)await cache.put(identity,manifest.sha256,new Blob([derived]),startTicket);
        signal?.throwIfAborted();onProgress(total,total,externalSource?'local':'cache');return derived.buffer;
      }
      if(!externalSource)await cache.remove(sourceIdentity,filter.sourceGeometrySha256);
    }
  }
  const output=new Uint8Array(total),controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  let next=0,loaded=0;
  const partials=[];
  const partialIdentity=(offset,length)=>`geometry-chunk:${identity.slice(9)}:${offset}:${length}`;
  const discardPartials=()=>Promise.all(partials.map(key=>cache.remove?.(key,manifest.sha256)));
  onProgress(0,total,'network');
  async function worker(){
    while(next<total){
      const offset=next,length=Math.min(chunkSize,total-offset);next+=length;
      const partial=partialIdentity(offset,length);partials.push(partial);
      const saved=await cache.get(partial,manifest.sha256);
      controller.signal.throwIfAborted();
      if(saved){
        const header=await saved.slice(0,64).text(),bytes=new Uint8Array(await saved.slice(64).arrayBuffer());
        if(bytes.length===length&&/^[a-f0-9]{64}$/.test(header)&&await sha256(bytes)===header){
          controller.signal.throwIfAborted();output.set(bytes,offset);loaded+=length;cache.recordResume?.(length);onProgress(loaded,total,'resume');continue;
        }
        await cache.remove(partial,manifest.sha256);
      }
      const query=new URLSearchParams({offset,length,version:manifest.sha256});
      const response=await fetch(`${endpoint}?${query}`,{
        cache:cache.managed?'no-store':'default',headers:{Accept:'application/json',...(cache.client?{'X-Tarkov-Storage':'client'}:{})},signal:controller.signal});
      if(!response.ok){
        if(response.status===404)throw new Error('地图服务暂不可用，请稍后刷新页面');
        if(cache.client){const detail=await response.json().catch(()=>null);if(detail?.error)throw Error(detail.error);}
        throw new Error(`模型分块读取失败（HTTP ${response.status}），请刷新页面`);
      }
      const chunk=await response.json();
      controller.signal.throwIfAborted();
      if(chunk.offset!==offset||chunk.total!==total||chunk.encoding!=='base64'||
          typeof chunk.data!=='string'||chunk.data.length!==Math.ceil(length/3)*4)
        throw new Error('模型分块不完整，请刷新页面重试');
      if(typeof Uint8Array.fromBase64==='function'){
        const decoded=Uint8Array.fromBase64(chunk.data);
        if(decoded.length!==length)throw new Error('模型分块长度不符，请刷新页面重试');
        output.set(decoded,offset);
      }else{
        const decoded=atob(chunk.data);
        if(decoded.length!==length)throw new Error('模型分块长度不符，请刷新页面重试');
        for(let i=0;i<length;i++)output[offset+i]=decoded.charCodeAt(i);
      }
      const decoded=output.subarray(offset,offset+length);
      cache.recordFetch?.(length);
      if(chunk.sha256){
        if(!/^[a-f0-9]{64}$/.test(chunk.sha256)||await sha256(decoded)!==chunk.sha256)throw Error('模型分块校验失败，请重试');
        controller.signal.throwIfAborted();
        await cache.put(partial,manifest.sha256,new Blob([chunk.sha256,decoded]),startTicket);
      }
      loaded+=length;onProgress(loaded,total,response.headers.get('X-Resource-Source')==='local'?'cache':'network');
    }
  }
  try{
    let failure;
    await Promise.allSettled(Array.from({length:Math.min(3,Math.ceil(total/chunkSize))},async()=>{try{await worker();}catch(error){failure||=error;controller.abort();}}));
    if(failure)throw failure;
    controller.signal.throwIfAborted();
    onProgress(total,total,'verify');const hash=await sha256(output);
    controller.signal.throwIfAborted();
    if(hash!==manifest.sha256){await discardPartials();throw new Error('模型完整性校验失败，请等待重建完成后刷新');}
    if(cache.enabled?.()!==false)await cache.put(identity,manifest.sha256,new Blob([output]),startTicket,partials);
    controller.signal.throwIfAborted();
    return output.buffer;
  }catch(error){controller.abort();throw error;}
  finally{signal?.removeEventListener('abort',abort);}
}
