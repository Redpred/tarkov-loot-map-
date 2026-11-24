import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createSiteServer, MAX_GEOMETRY_CHUNK } from '../lib/site-server.mjs';
import { loadFactoryGeometry } from '../../site/factory-geometry.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {acceptsGzip,createResponseCache} from '../lib/http-resource-cache.mjs';

test('geometry JSON transport works without requesting a downloadable binary',async t=>{
  const work=path.resolve(import.meta.dirname,'../../work');
  await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'geometry-transport-'));
  const atlas=path.join(root,'data/atlas');
  await fs.mkdir(atlas,{recursive:true});
  const source=Buffer.alloc(MAX_GEOMETRY_CHUNK*2+17);
  for(let i=0;i<source.length;i++)source[i]=(i*31+(i>>>8))&255;
  const manifest={stats:{bytes:source.length},sha256:createHash('sha256').update(source).digest('hex')};
  await fs.writeFile(path.join(atlas,'factory-geometry.bin'),source);
  await fs.writeFile(path.join(atlas,'factory-geometry.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(root,'index.html'),'<!doctype html><title>Atlas Maps</title>');
  const server=createSiteServer(root),requests=[];
  server.on('request',req=>requests.push(req.url));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const endpoint=`${base}/api/factory-geometry`;
  const url=(values={})=>`${endpoint}?${new URLSearchParams({offset:0,length:16,version:manifest.sha256,...values})}`;
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    // Only remove the uniquely created test fixture inside this project's work/.
    assert.equal(path.dirname(path.resolve(root)),work);
    assert.ok(path.basename(root).startsWith('geometry-transport-'));
    await fs.rm(root,{recursive:true,force:true});
  });

  await t.test('the launcher can identify the service and its project directory',async()=>{
    const response=await fetch(`${base}/api/health`);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{app:'tarkov-loot-map',siteRoot:root,pid:process.pid});
    const post=await fetch(`${base}/api/health`,{method:'POST'});
    assert.equal(post.status,405);
    await post.arrayBuffer();
  });

  await t.test('JSON headers are inline and a partial chunk decodes byte for byte',async()=>{
    const response=await fetch(url({offset:11,length:19}));
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^application\/json/);
    assert.equal(response.headers.get('content-disposition'),'inline');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const chunk=await response.json();
    assert.deepEqual(Buffer.from(chunk.data,'base64'),source.subarray(11,30));
  });

  await t.test('gzip keeps JSON compatibility, caches by version and supports conditional requests',async()=>{
    const address=url({length:MAX_GEOMETRY_CHUNK});
    const response=await fetch(address,{headers:{'accept-encoding':'gzip'}});
    assert.equal(response.headers.get('content-encoding'),'gzip');
    assert.match(response.headers.get('cache-control'),/immutable/);
    assert.equal(response.headers.get('vary'),'Accept-Encoding');
    assert.ok(Number(response.headers.get('content-length'))<MAX_GEOMETRY_CHUNK);
    assert.deepEqual(Buffer.from((await response.json()).data,'base64'),source.subarray(0,MAX_GEOMETRY_CHUNK));
    const hit=await fetch(address,{headers:{'if-none-match':response.headers.get('etag'),'accept-encoding':'gzip'}});
    assert.equal(hit.status,304);assert.equal((await hit.arrayBuffer()).byteLength,0);
    const plain=await fetch(url(),{headers:{'accept-encoding':'gzip;q=0, identity'}});
    assert.equal(plain.headers.get('content-encoding'),null);assert.equal(plain.status,200);await plain.arrayBuffer();
    const stale=await fetch(url({version:'0'.repeat(64)}));
    assert.equal(stale.headers.get('cache-control'),'no-store');await stale.arrayBuffer();
  });

  await t.test('static resources revalidate without bodies and changed files invalidate validators',async()=>{
    const file=path.join(root,'data.json'),body=JSON.stringify({test:'atlas '.repeat(10000)});
    await fs.writeFile(file,body);
    const response=await fetch(`${base}/data.json`,{headers:{'accept-encoding':'gzip'}});
    assert.equal(response.headers.get('content-encoding'),'gzip');assert.equal(await response.text(),body);
    const etag=response.headers.get('etag');assert.ok(etag);
    const unchanged=await fetch(`${base}/data.json`,{headers:{'if-none-match':etag}});
    assert.equal(unchanged.status,304);assert.equal((await unchanged.arrayBuffer()).byteLength,0);
    await fs.writeFile(file,'{"changed":true}');
    const changed=await fetch(`${base}/data.json`,{headers:{'if-none-match':etag}});
    assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),etag);assert.deepEqual(await changed.json(),{changed:true});
    const head=await fetch(`${base}/data.json`,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  });

  await t.test('the browser loader joins multiple chunks and checks the original hash',async()=>{
    requests.length=0;
    const progress=[];
    const buffer=await loadFactoryGeometry(manifest,(...args)=>progress.push(args),endpoint);
    assert.deepEqual(Buffer.from(buffer),source);
    assert.equal(requests.length,3);
    assert.ok(requests.every(url=>url.startsWith('/api/factory-geometry?')&&!url.includes('.bin')));
    assert.deepEqual(progress[0],[0,source.length,'network']);
    assert.deepEqual(progress.at(-1),[source.length,source.length,'verify']);
    assert.ok(progress.every(([done],i)=>!i||done>=progress[i-1][0]));
    assert.equal(progress.at(-1)[2],'verify');
  });

  await t.test('invalid ranges and stale manifests fail before returning model data',async()=>{
    for(const values of [{offset:-1},{length:0},{length:MAX_GEOMETRY_CHUNK+1},{offset:'NaN'}]){
      const response=await fetch(url(values));assert.equal(response.status,400);await response.arrayBuffer();
    }
    for(const [values,status] of [[{version:'0'.repeat(64)},409],[{offset:source.length},416]]){
      const response=await fetch(url(values));assert.equal(response.status,status);await response.arrayBuffer();
    }
  });

  await t.test('paused or obsolete loads abort without downloading the rest of the model',async()=>{
    const controller=new AbortController();controller.abort();
    const before=requests.length;
    await assert.rejects(loadFactoryGeometry(manifest,()=>{},endpoint,controller.signal),e=>e.name==='AbortError');
    assert.equal(requests.length,before);
  });

  await t.test('the site still serves the map page with its HTML MIME type',async()=>{
    const response=await fetch(base);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^text\/html/);
    assert.match(await response.text(),/Atlas Maps/);
  });

  await t.test('corruption is rejected instead of rendering a broken model',async()=>{
    const file=await fs.open(path.join(atlas,'factory-geometry.bin'),'r+');
    await file.write(Buffer.from([source[0]^255]),0,1,0);await file.close();
    await assert.rejects(loadFactoryGeometry(manifest,()=>{},endpoint),/完整性校验失败/);
  });

  await t.test('a binary currently being rebuilt returns an explicit error',async()=>{
    await fs.truncate(path.join(atlas,'factory-geometry.bin'),16);
    const response=await fetch(url());assert.equal(response.status,503);
    assert.match((await response.json()).error,/重建/);
  });

  await t.test('street sectors use independent checked JSON transport and cannot select arbitrary files',async()=>{
    const dir=path.join(atlas,'streets');await fs.mkdir(path.join(dir,'sectors'),{recursive:true});
    const sector={id:'s_-2_3',...manifest};
    await fs.writeFile(path.join(dir,'streets-sectors.json'),JSON.stringify({sectors:[sector]}));
    await fs.writeFile(path.join(dir,'sectors/s_-2_3.bin'),source);
    const streetEndpoint=`${base}/api/streets-geometry/s_-2_3`;
    const buffer=await loadFactoryGeometry(manifest,()=>{},streetEndpoint);
    assert.deepEqual(Buffer.from(buffer),source);
    const missing=await fetch(`${base}/api/streets-geometry/s_9_9?${new URLSearchParams({offset:0,length:16,version:manifest.sha256})}`);
    assert.equal(missing.status,404);await missing.arrayBuffer();
    const invalid=await fetch(`${streetEndpoint}?${new URLSearchParams({offset:0,length:16,version:'0'.repeat(64)})}`);
    assert.equal(invalid.status,409);await invalid.arrayBuffer();
  });

  await t.test('every streamed map has an isolated allowlisted sector route',async()=>{
    for(const map of Object.values(ATLAS_MAPS).filter(m=>m.streamed)){
      const dir=path.join(root,map.textureBase);await fs.mkdir(path.join(dir,'sectors'),{recursive:true});
      await fs.writeFile(path.join(root,map.geometry),JSON.stringify({sectors:[{id:'s_0_-1',...manifest}]}));
      await fs.writeFile(path.join(dir,'sectors/s_0_-1.bin'),source);
      const q=new URLSearchParams({offset:12,length:17,version:manifest.sha256});
      const response=await fetch(`${base}/${map.endpoint}/s_0_-1?${q}`);
      assert.equal(response.status,200,map.id);assert.match(response.headers.get('content-type'),/application\/json/);
      assert.deepEqual(Buffer.from((await response.json()).data,'base64'),source.subarray(12,29));
    }
    for(const route of ['__proto__-geometry/s_0_-1','unknown-geometry/s_0_-1','lighthouse-geometry','factory-geometry/s_0_-1','lighthouse-geometry/..%2f..%2findex.html']){
      const response=await fetch(`${base}/api/${route}`);assert.equal(response.status,404,route);await response.arrayBuffer();
    }
  });
});

test('compressed response cache coalesces concurrent requests and bounds retained bytes',async()=>{
  const cached=createResponseCache(8);let builds=0;
  const build=async()=>{builds++;await new Promise(r=>setTimeout(r,2));return Buffer.alloc(5);};
  await Promise.all([cached('a',build,false),cached('a',build,false),cached('a',build,false)]);assert.equal(builds,1);
  await cached('a',build,false);assert.equal(builds,1);
  await cached('b',build,false);await cached('a',build,false);assert.equal(builds,3);
  for(const [value,expected] of [['gzip',true],['br, gzip;q=0.5',true],['gzip;q=0, *;q=1',false],['br',false],['*',true],['',false]])assert.equal(acceptsGzip(value),expected);
});
