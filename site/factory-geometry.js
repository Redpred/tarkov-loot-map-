import {resourceCache,sha256} from './atlas-resource-cache.js';
import {sceneryEndpoint} from './atlas-scenery-details.js';
import {localResources} from './atlas-local-resources.js';
import {managedResources} from './atlas-managed-resources.js';
import {readMapResource} from './atlas-resource-request.js';
import {mapLoadError} from './atlas-map-diagnostics.js';
export const geometryProgressText=(done,total,source)=>({cache:'读取本地模型缓存',local:'读取本地资源包',resume:'恢复已下载分块',verify:'校验模型',network:'在线读取模型',retry:'正在重试模型分块'}[source]||'在线读取模型')+` ${Math.round(done/total*100)}%`;
// Keep the binary on disk for the exporter, but transfer it as ordinary JSON.
// Download-manager browser extensions can otherwise capture the .bin fetch.
export async function loadFactoryGeometry(manifest,onProgress=()=>{},endpoint='api/factory-geometry',signal,cache=resourceCache){
  endpoint=sceneryEndpoint(endpoint,manifest);
  const total=manifest?.stats?.bytes,chunkSize=4*1024*1024;
  if(!Number.isSafeInteger(total)||total<=0||!/^[a-f0-9]{64}$/.test(manifest.sha256))
    throw mapLoadError('MODEL-MANIFEST', '模型清单无效', {url:endpoint});
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
          if(![out,start,length].every(Number.isSafeInteger)||out!==cursor||start<previousEnd||length<1||start+length>raw.byteLength||out+length>total)throw mapLoadError('SCENERY-MODEL-RANGE', '装饰筛选范围无效', {url:endpoint});
          derived.set(new Uint8Array(raw,start,length),out);cursor+=length;previousEnd=start+length;
        }
        if(cursor!==total||await sha256(derived)!==manifest.sha256)throw mapLoadError('SCENERY-MODEL-HASH', '装饰筛选校验失败', {url:endpoint});signal?.throwIfAborted();
        if(!externalSource&&cache.enabled?.()!==false)await cache.put(identity,manifest.sha256,new Blob([derived]),startTicket);
        signal?.throwIfAborted();onProgress(total,total,externalSource?'local':'cache');return derived.buffer;
      }
      if(!externalSource)await cache.remove(sourceIdentity,filter.sourceGeometrySha256);
    }
  }
  const output=new Uint8Array(total),controller=new AbortController();
  const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
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
      const url=`${endpoint}?${query}`;
      const {chunk,source}=await readMapResource(url,'模型分块读取',async response=>({
        chunk:await response.json(),source:response.headers.get('X-Resource-Source')
      }),{
        code:'MODEL-CHUNK',cache:cache.managed?'no-store':'default',headers:{Accept:'application/json',...(cache.client?{'X-Tarkov-Storage':'client'}:{})},
        signal:controller.signal,timeout:globalThis.location?.protocol==='tarkov:'?0:60000,readError:true,onRetry:()=>onProgress(loaded,total,'retry')
      });
      controller.signal.throwIfAborted();
      if(chunk?.offset!==offset||chunk.total!==total||chunk.encoding!=='base64'||
          typeof chunk.data!=='string'||chunk.data.length!==Math.ceil(length/3)*4)
        throw mapLoadError('MODEL-CHUNK-FORMAT', '模型分块不完整，请刷新页面重试', {url});
      let bytes;
      try{bytes=typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(chunk.data):atob(chunk.data);}
      catch(cause){throw mapLoadError('MODEL-CHUNK-BASE64', '模型分块编码无效', {url,cause});}
      if(bytes.length!==length)throw mapLoadError('MODEL-CHUNK-LENGTH', '模型分块长度不符，请刷新页面重试', {url});
      if(typeof bytes==='string')for(let i=0;i<length;i++)output[offset+i]=bytes.charCodeAt(i);
      else output.set(bytes,offset);
      const decoded=output.subarray(offset,offset+length);
      cache.recordFetch?.(length);
      if(chunk.sha256){
        if(!/^[a-f0-9]{64}$/.test(chunk.sha256)||await sha256(decoded)!==chunk.sha256)throw mapLoadError('MODEL-CHUNK-HASH', '模型分块校验失败，请重试', {url});
        controller.signal.throwIfAborted();
        await cache.put(partial,manifest.sha256,new Blob([chunk.sha256,decoded]),startTicket);
      }
      loaded+=length;onProgress(loaded,total,source==='local'?'cache':'network');
    }
  }
  try{
    let failure;
    await Promise.allSettled(Array.from({length:Math.min(3,Math.ceil(total/chunkSize))},async()=>{try{await worker();}catch(error){failure||=error;controller.abort();}}));
    if(failure)throw failure;
    controller.signal.throwIfAborted();
    onProgress(total,total,'verify');const hash=await sha256(output);
    controller.signal.throwIfAborted();
    if(hash!==manifest.sha256){await discardPartials();throw mapLoadError('MODEL-HASH', '模型完整性校验失败，请等待重建完成后刷新', {url:`${endpoint}?version=${manifest.sha256}`});}
    if(cache.enabled?.()!==false)await cache.put(identity,manifest.sha256,new Blob([output]),startTicket,partials);
    controller.signal.throwIfAborted();
    return output.buffer;
  }catch(error){controller.abort();throw error;}
  finally{signal?.removeEventListener('abort',abort);}
}
