import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {once} from 'node:events';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {createTaskMapIndex,serializeTaskMapIndex,restoreTaskMapIndex} from '../../site/task-map-index.js';
import {createTaskStore} from '../../site/task-store.js';
import {mergeMapData,runtimeInputs,loadRuntimeDescriptor,loadPreparedMap,loadPreparedSpatial,readPreparedJson} from '../../site/atlas-runtime.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {createSiteServer} from '../lib/site-server.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const pos={x:1,y:2,z:3};
function fixture(){
  const loot={points:[{id:'loose',kind:'loose',position:pos,candidates:[{tpl:'a',weight:1,included:[{tpl:'b'}]},{tpl:'zero',weight:0}]},
    {id:'container',kind:'container',position:pos,pool:'p',forcedItems:[{tpl:'b'}]},
    {id:'outside',kind:'loose',position:pos,outsideClientEnvelope:true,candidates:[{tpl:'a',weight:1}]}],
    items:{a:{zh:'显示卡',en:'Graphics card'},b:{zh:'附带物品'}},pools:{p:{items:[{tpl:'a',weight:1}]}}};
  const poi={points:[{id:'scav',kind:'poi',position:pos,poiTypes:['scav_ai']},{id:'door',kind:'poi',position:pos,poiTypes:['locked_door'],keyId:'key'}],items:{key:{zh:'钥匙'}}};
  const quests={points:[{id:'zone',kind:'poi',position:pos,poiTypes:['quest_zone'],questObjectives:[{questId:'task',objectiveId:'zone'}]}],items:{},quests:[]};
  const goal=(id,type,extra={})=>({id,type,itemIds:['a'],mapIds:[],text:id,raw:{conditionType:type},...extra});
  const catalog={tasks:[{id:'task',name:'任务',objectives:[goal('collect','FindItem'),goal('zone','CounterCreator'),goal('plant','LeaveItemAtLocation'),goal('pmc','CounterCreator',{mapIds:['factory'],raw:{conditionType:'Kills',target:'AnyPmc'}}),goal('scav','CounterCreator',{mapIds:['factory'],raw:{conditionType:'Kills',target:'Savage'}})]}]};
  return {loot,poi,quests,catalog,regions:{regions:[]},data:mergeMapData(loot,poi,quests)};
}
const rows=entries=>entries.map(entry=>({id:entry.task.id,objectives:entry.objectives.map(row=>({id:row.objective.id,points:[...row.points].map(p=>p.id),candidate:row.candidate,hint:row.hint,relevant:row.relevant}))}));
function memoryCache(){const values=new Map();return{ticket:()=>0,get:async(id,sha)=>values.get(id+sha),put:async(id,sha,b)=>values.set(id+sha,b),remove:async(id,sha)=>values.delete(id+sha)};}

test('prepared item index preserves counts, exact matching and ranking without reading candidate pools',()=>{
  const {data}=fixture(),original=createItemIndex(data),packed=JSON.parse(JSON.stringify(original.serialize()));
  const restored=createItemIndex(data,packed);
  assert.deepEqual(restored.items,original.items);
  for(const query of ['显','GRAPHICS card','b','key','zero',''])assert.deepEqual(restored.search(query),original.search(query));
  for(const point of data.points)for(const ids of [['a'],['b'],['a','b'],[],['key'],['zero']])assert.equal(restored.matches(point,ids),original.matches(point,ids));
  const clone=structuredClone(data);delete clone.pools;
  for(const point of clone.points)Object.defineProperty(point,'candidates',{get(){throw new Error('Candidates rescanned');}});
  const fast=createItemIndex(clone,packed);assert.equal(fast.matches(clone.points[0],['a']),true);
  assert.throws(()=>createItemIndex({...data,points:[]},packed),/版本/);
  const bad=structuredClone(packed);bad.sets[0]=[999999];assert.throws(()=>createItemIndex(data,bad),/损坏/);
});

test('prepared task index keeps exact points and personal completion/visibility semantics',()=>{
  const {data,catalog}=fixture(),original=createTaskMapIndex({data,catalog,mapId:'factory'});
  const serialized=JSON.parse(JSON.stringify(serializeTaskMapIndex(original,catalog,data)));
  const restored=restoreTaskMapIndex(serialized,data,'factory');
  assert.deepEqual(rows(restored.entries(['task'])),rows(original.entries(['task'])));
  assert.deepEqual(restored.entries(['missing']),[]);
  assert.equal(JSON.stringify(serialized).includes('"raw"'),false);
  const store=createTaskStore({storage:null,eventTarget:null});store.toggleTask('task',true);
  for(const change of [()=>{},()=>store.setCompleted('task','collect',true),()=>store.setTaskVisible('factory','task',false),()=>store.setTaskVisible('factory','task',true),()=>store.setMapEnabled('factory',false)]){
    change();assert.deepEqual([...restored.active(restored.entries(['task']),store)].map(p=>p.id),[...original.active(original.entries(['task']),store)].map(p=>p.id));
  }
  store.destroy();
  const bad=structuredClone(serialized);bad.sets[0].push(data.points.length);assert.throws(()=>restoreTaskMapIndex(bad,data,'factory'),/点位/);
});

test('prepared resources use immutable gzip transport, verify hashes, cache, and reject stale source data',async t=>{
  const work=path.resolve(import.meta.dirname,'../../work'),root=await fs.mkdtemp(path.join(work,'runtime-test-'));
  const runtime=path.join(root,'data/runtime');await fs.mkdir(runtime,{recursive:true});
  const f=fixture(),items=createItemIndex(f.data),tasks=createTaskMapIndex({catalog:f.catalog,data:f.data,mapId:'factory'});
  const payload={version:1,mapId:'factory',loot:f.loot,poi:f.poi,quests:f.quests,regions:f.regions,itemIndex:items.serialize(),taskIndex:serializeTaskMapIndex(tasks,f.catalog,f.data)};
  const bytes=Buffer.from(JSON.stringify(payload)),sha256=hash(bytes),info={file:`data/runtime/${sha256}.json`,sha256,bytes:bytes.length};
  await fs.writeFile(path.join(root,info.file),bytes);await fs.writeFile(path.join(root,info.file+'.gz'),gzipSync(bytes));
  const values=[f.loot,f.poi,f.quests,f.regions,f.catalog],inputs={};
  for(const [i,file] of runtimeInputs(ATLAS_MAPS.factory).entries()){
    const content=Buffer.from(JSON.stringify(values[i]));await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),content);inputs[file]=hash(content);
  }
  await fs.writeFile(path.join(runtime,'manifest.json'),JSON.stringify({version:1,maps:{factory:{...info,inputs}},geometry:{}}));
  const server=createSiteServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/`,fetcher=(url,options)=>fetch(new URL(url,base),options);
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(root),work);assert.ok(path.basename(root).startsWith('runtime-test-'));await fs.rm(root,{recursive:true,force:true});});
  const descriptor=await loadRuntimeDescriptor('factory',{fetcher});assert.equal(descriptor.map.sha256,sha256);
  const cache=memoryCache(),prepared=await loadPreparedMap('factory',descriptor,{fetcher,cache});
  assert.equal(prepared.data.points.length,f.data.points.length);assert.deepEqual(prepared.itemIndex.items,items.items);
  assert.deepEqual(rows(prepared.taskIndex.entries(['task'])),rows(tasks.entries(['task'])));
  const cached=await loadPreparedMap('factory',descriptor,{cache,fetcher:()=>{throw new Error('Unexpected network');}});assert.ok(cached);
  const response=await fetcher(info.file,{headers:{'accept-encoding':'gzip'}});
  assert.equal(response.headers.get('content-encoding'),'gzip');assert.match(response.headers.get('cache-control'),/immutable/);assert.equal(await response.text(),bytes.toString());
  const unchanged=await fetcher(info.file,{headers:{'if-none-match':response.headers.get('etag')}});assert.equal(unchanged.status,304);
  const plain=await fetcher(info.file,{headers:{'accept-encoding':'identity'}});assert.equal(plain.headers.get('content-encoding'),null);assert.equal(await plain.text(),bytes.toString());
  const head=await fetcher(info.file,{method:'HEAD',headers:{'accept-encoding':'gzip'}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetcher('api/runtime/__proto__')).status,404);assert.equal((await fetcher('api/runtime/factory',{method:'POST'})).status,405);
  assert.equal(await loadPreparedMap('streets',descriptor,{fetcher,cache}),null);
  await cache.put('runtime:map:factory',sha256,new Blob(['corrupt']));assert.ok(await loadPreparedMap('factory',descriptor,{fetcher,cache}));
  assert.equal(await loadPreparedMap('factory',descriptor,{fetcher:async()=>new Response('corrupt'),cache:memoryCache()}),null);
  await fs.writeFile(path.join(root,runtimeInputs(ATLAS_MAPS.factory)[4]),JSON.stringify({tasks:[]}));
  assert.equal((await loadRuntimeDescriptor('factory',{fetcher})).map,null);
  assert.equal((await loadRuntimeDescriptor('woods',{fetcher})).map,null);
  assert.equal(await loadRuntimeDescriptor('factory',{fetcher:async()=>{throw new Error('Offline');}}),null);
});

test('spatial resources reject a manifest with changed offsets even when binary SHA is unchanged',async()=>{
  const manifest={sha256:'a'.repeat(64),meshes:[{vertices:3,positionOffset:0}]};
  const payload={version:1,geometrySha256:manifest.sha256,meshes:[{}]},body=JSON.stringify(payload),sha256=hash(body);
  const info={file:`data/runtime/${sha256}.json`,sha256,bytes:Buffer.byteLength(body),geometrySha256:manifest.sha256,manifestSha256:hash(JSON.stringify(manifest))};
  const options={fetcher:async()=>new Response(body),cache:memoryCache()},descriptor={geometry:{whole:info}};
  assert.ok(await loadPreparedSpatial('factory','whole',manifest,descriptor,options));
  assert.equal(await loadPreparedSpatial('factory','whole',{...manifest,meshes:[{vertices:3,positionOffset:4}]},descriptor,options),null);
  await assert.rejects(readPreparedJson({...info,file:'../secret.json'},'test',options),/地址/);
});
