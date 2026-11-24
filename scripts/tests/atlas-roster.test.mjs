import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {SPT_DB,SPT_SOURCE} from '../lib/spt-source.mjs';
import {atlasToUnity,candidatesFor} from '../lib/factory-data.mjs';
import {classifyPointMarker} from '../../site/factory-marker-rules.js';
import {pointSettingKey} from '../../site/factory-icon-settings.js';
const root=path.resolve(import.meta.dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8').replace(/^\uFEFF/,''));
const manifests=['factory/manifest.json','items/manifest.json','items/spt-extras.json'].map(p=>read('site/data/icons/'+p));
const icons={items:Object.assign({},...manifests.map(m=>m.items)),entries:Object.assign({},...manifests.map(m=>m.entries))};
const unavailable=new Set(manifests.flatMap(m=>(m.unavailable||[]).map(i=>i.id)));

for(const map of Object.values(ATLAS_MAPS))test(`${map.id}: current source, coordinates, item pools, icons and exported assets`,()=>{
  const data=read('site/'+map.data),meta=read(`data/atlas/${map.id}-source.json`);
  assert.equal(data.sources.atlas.eftBuild,SPT_SOURCE.eftBuild);
  assert.equal(data.sources.spt.commit,SPT_SOURCE.commit);
  assert.equal(data.sources.versionMatch,true);
  assert.equal(data.sources.atlas.clientFingerprint,meta.clientFingerprint);
  const raw=read(path.join(SPT_DB,'locations',map.spt,'looseLoot.json'));
  assert.equal(data.stats.loose,raw.spawnpoints.length+raw.spawnpointsForced.length);
  assert.equal(data.stats.unresolvedCandidates,0);
  assert.equal(new Set(data.points.map(p=>p.id)).size,data.points.length);
  assert.equal(new Set(data.points.map(pointSettingKey)).size,data.points.length);
  const client=read(`work/tarkmap/out/${map.atlas}/gamedata.json`),byId=new Map();
  for(const c of client.containers||[]){const key=`${c.id}:${c.template}`;if(!byId.has(key))byId.set(key,[]);byId.get(key).push(c);}
  const sptContainerKeys=new Set(data.points.filter(p=>p.kind==='container'&&p.joinStatus!=='client-only').map(p=>`${p.sourceId}:${p.containerTpl}`));
  for(const c of client.containers||[]){
    if(!c.id||c.active===false||sptContainerKeys.has(`${c.id}:${c.template}`))continue;
    const actual=data.points.find(p=>p.joinStatus==='client-only'&&p.sourceId===c.id&&p.containerTpl===c.template&&JSON.stringify(p.position)===JSON.stringify(atlasToUnity(c.pos)));
    assert.ok(actual,`Current client container must remain visible without an invented pool: ${c.id}`);
    assert.equal(actual.pool,null);
  }
  for(const p of data.points){
    if(p.position)assert.ok(Object.values(p.position).every(Number.isFinite),p.id);
    if(p.joinStatus==='matched'){
      const rows=byId.get(`${p.sourceId}:${p.containerTpl}`)||[];
      const positions=[...new Set(rows.map(c=>JSON.stringify(c.pos)))];
      assert.equal(positions.length,1,p.id);
      assert.deepEqual(p.position,atlasToUnity(JSON.parse(positions[0])),p.id);
    }
    assert.ok(icons.entries[classifyPointMarker(p,data,icons).key],p.id);
    for(const c of candidatesFor(p,data)){
      assert.ok(data.items[c.tpl],`Missing item ${c.tpl}`);
      if(c.weight==null||c.weight>0)assert.ok(icons.items[c.tpl]||unavailable.has(c.tpl),`Unaccounted icon ${c.tpl}`);
    }
  }
  for(const suffix of ['pois','quests']){
    const supplement=read(`site/data/${map.id}-${suffix}.json`);
    assert.equal(new Set(supplement.points.map(p=>p.id)).size,supplement.points.length);
    for(const p of supplement.points)assert.ok(p.position&&Object.values(p.position).every(Number.isFinite),p.id);
    for(const p of supplement.points)if(p.poiTypes?.includes('locked_door'))assert.ok(typeof p.keyId==='string'&&p.keyId.trim()&&supplement.items[p.keyId],p.id);
    if(suffix==='quests')assert.ok(supplement.sources.quests.includes(SPT_SOURCE.version));
  }
  const geometry=read('site/'+map.geometry);
  assert.ok(geometry.stats.exportedInstances>0);
  for(const key of ['min','max'])assert.ok(geometry.bounds[key].every(Number.isFinite));
  const groups=map.streamed?geometry.sectors:[geometry];
  assert.ok(groups.length>0);
  for(const g of groups){
    const binary=path.join(root,'site',map.textureBase,map.streamed?g.binary:geometry.binary);
    assert.equal(fs.statSync(binary).size,g.stats.bytes,binary);
    assert.match(g.sha256,/^[a-f0-9]{64}$/);
  }
  for(const texture of Object.values(geometry.textures))assert.ok(fs.existsSync(path.join(root,'site',map.textureBase,texture.file)),texture.file);
  const regions=read(`site/data/${map.id}-regions.json`);
  for(const label of regions.labels){
    assert.ok(label.name&&label.en);
    assert.ok(Object.values(label.position).every(Number.isFinite));
    if(label.arrival)assert.ok(label.arrival.minY<label.arrival.maxY);
  }
});

test('the launcher catalogue exposes every completed map from the same dataset',()=>{
  const catalog=read('site/data/atlas-catalog.json');
  assert.deepEqual(catalog.maps.map(m=>m.id).sort(),Object.keys(ATLAS_MAPS).sort());
  for(const map of catalog.maps){assert.equal(map.ready,true,map.id);assert.equal(map.spt.commit,SPT_SOURCE.commit,map.id);}
});
