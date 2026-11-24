import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {cacheOwner} from '../../site/atlas-cache-identity.js';
import {makeMapCachePlan,summarizeMapCache,createMapCacheReader,mapCacheStatus} from '../../site/atlas-map-cache.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {createSiteServer} from '../lib/site-server.mjs';

const hash='a'.repeat(64),quality={geometry:'original',texture:'original'};
const manifest={sha256:hash,stats:{bytes:100},meshes:[{material:0}],materials:[{tex:'a',emis:'b'}],textures:{a:{file:'textures/a.webp',sha256:hash,bytes:10},b:{file:'textures/a.webp',sha256:hash,bytes:10},unused:{file:'textures/unused.webp',sha256:hash,bytes:20}}};
const plan=makeMapCachePlan(ATLAS_MAPS.factory,manifest,manifest,quality);
const rows=()=>[...plan.geometry,...plan.texture].map(([identity,version,bytes])=>({identity,version,bytes,...cacheOwner(identity)}));

test('plans count referenced textures once and group all map formats and precision tiers',()=>{
  assert.equal(plan.texture.length,1);assert.equal(plan.geometry.length,1);
  assert.deepEqual(cacheOwner('texture:/data/atlas/textures/a.webp'),{mapId:'factory',kind:'texture',quality:'original'});
  assert.deepEqual(cacheOwner('texture:/data/model-quality/ground_zero/low/a.webp'),{mapId:'ground_zero',kind:'texture',quality:'low'});
  assert.equal(cacheOwner('runtime:spatial:lighthouse:s_-1_2').mapId,'lighthouse');
  assert.equal(cacheOwner('geometry:/api/unknown-geometry').mapId,'other');
  const streamed={...manifest,sectors:[{id:'s_-1_2',sha256:hash,stats:{bytes:100},materialIds:[0]},{id:'s_0_0',sha256:hash,stats:{bytes:50},materialIds:[0]}]};
  const woods=makeMapCachePlan(ATLAS_MAPS.woods,streamed,manifest,{geometry:'medium',texture:'original'});
  assert.equal(woods.geometry.length,2);assert.equal(woods.texture.length,1);assert.equal(woods.geometry[0][0],'geometry:/api/woods-geometry/medium/s_-1_2');
});

test('completion requires every current hash and byte size; other qualities and old versions never count',()=>{
  assert.equal(summarizeMapCache('factory',rows(),plan).state,'complete');
  const partial=summarizeMapCache('factory',rows().slice(0,1),plan);assert.equal(partial.state,'partial');assert.equal(partial.percent,90);
  const stale=rows().map(row=>({...row,version:'b'.repeat(64)}));assert.equal(summarizeMapCache('factory',stale,plan).state,'other');
  const other=rows().map(row=>({...row,identity:row.identity.replace('/api/factory-geometry','/api/factory-geometry/medium').replace('/data/atlas/textures/','/data/model-quality/factory/low/')}));
  const summary=summarizeMapCache('factory',other,plan);assert.equal(summary.state,'other');assert.equal(summary.bytes,110);assert.equal(summary.percent,0);
  assert.equal(summarizeMapCache('factory',rows().map(row=>({...row,bytes:1})),plan).state,'other');
  assert.match(mapCacheStatus(summarizeMapCache('factory',rows())),/版本待核对/);
  assert.equal(summarizeMapCache('factory',[],plan).state,'empty');
});

test('directory reads only lightweight plans for cached maps, reuses plans and handles offline state truthfully',async()=>{
  let calls=0,time=0,offline=false;
  const reader=createMapCacheReader({cache:{inventory:async()=>({available:true,records:rows()})},now:()=>time,fetcher:async url=>{calls++;assert.match(url,/^api\/cache-plan\/factory\?/);if(offline)throw Error('offline');return Response.json(plan);}});
  const first=await reader.read(quality);assert.equal(first.maps.length,13);assert.equal(first.maps.find(m=>m.mapId==='factory').state,'complete');assert.equal(calls,1);
  await reader.read(quality);assert.equal(calls,1);
  time=60001;offline=true;const unknown=await reader.read(quality);assert.equal(calls,2);assert.equal(unknown.maps[0].state,'unknown');
  const empty=createMapCacheReader({cache:{inventory:async()=>({available:true,records:[]})},fetcher:()=>{throw Error('No downloads permitted');}});
  assert.ok((await empty.read()).maps.every(m=>m.state==='empty'));
});

test('cache plan HTTP endpoint validates inputs, revalidates versions and transfers no binary assets',async t=>{
  const work=path.resolve(import.meta.dirname,'../../work');await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'map-cache-test-')),directory=path.join(root,'data/atlas');
  t.after(async()=>{assert.equal(path.dirname(root),work);assert.ok(path.basename(root).startsWith('map-cache-test-'));await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'factory-geometry.json');await fs.writeFile(file,JSON.stringify(manifest));
  const server=createSiteServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/cache-plan/factory?geometry=original&texture=original';
  const response=await fetch(url);assert.equal(response.status,200);assert.deepEqual(await response.json(),plan);assert.equal(response.headers.get('cache-control'),'no-cache');
  const etag=response.headers.get('etag');assert.equal((await fetch(url,{headers:{'if-none-match':etag}})).status,304);
  await fs.writeFile(file,JSON.stringify({...manifest,sha256:'b'.repeat(64)}));const changed=await fetch(url,{headers:{'if-none-match':etag}});assert.equal(changed.status,200);assert.equal((await changed.json()).geometry[0][1],'b'.repeat(64));
  for(const query of ['geometry=oops&texture=original','geometry=original&texture=original&x=1','geometry=original&geometry=low&texture=original'])assert.equal((await fetch(base+'/api/cache-plan/factory?'+query)).status,400);
  assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal((await fetch(base+'/api/cache-plan/unknown?geometry=original&texture=original')).status,404);
  assert.equal((await fetch(base+'/api/cache-plan/factory?geometry=medium&texture=original')).status,503);
});
