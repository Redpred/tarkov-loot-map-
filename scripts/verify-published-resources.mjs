import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReleaseResources, releaseDownloadUrl} from '../desktop/release-resources.mjs';
import {createDesktopResources} from '../desktop/resources.mjs';
import {downloadProjectAssets} from './lib/project-assets-download.mjs';
import {restoreProjectAssets, verifyProjectAssets} from './lib/project-assets.mjs';
const root=path.resolve(import.meta.dirname,'..'),evidence=path.join(root,'work/release-acceptance/resources');
await fs.mkdir(evidence,{recursive:true});
const readJson=async file=>JSON.parse(await fs.readFile(path.join(root,file)));
const lock=await readJson('desktop/resources.lock.json'),release=await readJson('desktop/resource-release.json');
const requests=[];
async function fetcher(url,init={}) {
  assert(releaseDownloadUrl(String(url))); assert.equal(new Headers(init.headers).has('authorization'),false);
  const response=await fetch(url,init);
  requests.push({host:new URL(url).hostname,name:new URL(url).pathname.split('/').at(-1),range:new Headers(init.headers).get('range'),status:response.status,contentRange:response.headers.get('content-range')});
  return response;
}
const remote=createReleaseResources({release,lock,cacheRoot:path.join(evidence,'range-cache'),fetcher});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const chosen=[];
for(const id of ['factory','streets','customs','woods','shoreline','interchange','reserve','labs','ground_zero','labyrinth','terminal','icebreaker','lighthouse']) {
  const name=Object.keys(lock.files).find(name=>name===`data/geometry-quality/${id}/manifest.json`);
  assert(name);const bytes=await remote.read(name,lock.files[name][1]);assert.equal(sha(bytes),lock.files[name][0]);chosen.push(name);
}
const texture=Object.keys(lock.files).find(name=>name.includes('/factory/')&&/\.(png|webp|jpg)$/.test(name));assert(texture);
assert.equal(sha(await remote.read(texture,lock.files[texture][1])),lock.files[texture][0]);
const model=Object.entries(lock.geometry).find(([name])=>name==='api/factory-geometry/low');assert(model);
const [modelName,[modelHash,total]]=model;
const localRoot=path.join(evidence,'resume','map-resources');
await fs.mkdir(path.dirname(localRoot),{recursive:true});
const create=offline=>createDesktopResources({siteRoot:path.join(evidence,'empty-site'),cacheRoot:path.join(evidence,'resume-cache'),
  localRoot,lock,release,fetcher:offline?async()=>{throw Error('Offline resume must not request the network');}:fetcher});
let store=create(false),parts=[];
const get=async(offset)=>{
  const length=Math.min(4*2**20,total-offset),query=new URLSearchParams({offset,length,version:modelHash});
  const response=await store.handle(new Request(`tarkov://app/${modelName}?${query}`,{headers:{'X-Tarkov-Storage':'client'}}));
  assert.equal(response.status,200);const value=await response.json();const bytes=Buffer.from(value.data,'base64');assert.equal(sha(bytes),value.sha256);return bytes;
};
parts.push(await get(0));
const before=requests.length;store=create(false);assert.deepEqual(await get(0),parts[0]);assert.equal(requests.length,before);
for(let offset=4*2**20;offset<total;offset+=4*2**20)parts.push(await get(offset));
assert.equal(sha(Buffer.concat(parts)),modelHash);
store=create(true);for(let offset=0;offset<total;offset+=4*2**20)assert.deepEqual(await get(offset),parts[offset/(4*2**20)]);
// Force only the client request policy to omit Range: the returned whole ZIP is
// still anonymously downloaded from GitHub and verified by the production reader.
const fallbackRequests=[];
const fallback=createReleaseResources({release,lock,cacheRoot:path.join(evidence,'whole-cache'),fetcher:async(url,init)=>{
  const headers=new Headers(init.headers),requestedRange=headers.get('range');headers.delete('range');const response=await fetcher(url,{...init,headers});
  // GitHub's final CDN path is an opaque ID, not the original ZIP filename.
  // Range identifies the pack request across redirects; indexes have no Range.
  fallbackRequests.push({name:new URL(url).pathname.split('/').at(-1),requestedRange,status:response.status});return response;
}});
assert.equal(sha(await fallback.read(chosen[0],lock.files[chosen[0]][1])),lock.files[chosen[0]][0]);
const assetResult=await downloadProjectAssets({lock:await readJson('resources/project-assets.lock.json'),release:await readJson('resources/project-assets-release.json'),
  cache:path.join(evidence,'downloaded-project-assets'),group:'all',fetcher});
const assetLock=await readJson('resources/project-assets.lock.json'),assetRelease=await readJson('resources/project-assets-release.json');
const restored=await restoreProjectAssets(path.join(evidence,'restored-project-assets'),assetLock,assetRelease,assetResult.cache);
const verified=await verifyProjectAssets(path.join(evidence,'restored-project-assets'),assetLock);
assert(requests.some(row=>row.status===206));assert(fallbackRequests.some(row=>row.status===200&&row.requestedRange));
const result={at:new Date().toISOString(),anonymous:true,metadataMaps:13,textureVerified:texture,
  modelVerified:modelName,modelBytes:total,persistedPartialChunkReused:true,remainingChunksDownloaded:true,reloadedOffline:true,
  actualRange206:true,actualWholeZip200:true,fullZipFallbackForcedByTest:true,fallbackRequests,projectAssets:assetResult,restored,verified,requests};
await fs.writeFile(path.join(evidence,'remote-resources.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,requests:requests.length}));
