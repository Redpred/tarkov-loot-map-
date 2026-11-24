import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {candidatesFor} from '../lib/factory-data.mjs';
import {classifyPointMarker} from '../../site/factory-marker-rules.js';
import {pointSettingKey} from '../../site/factory-icon-settings.js';
import path from 'node:path';
import {SPT_DB} from '../lib/spt-source.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8').replace(/^\uFEFF/,''));

test('street dataset retains SPT records and uses exact client ID/template coordinates',()=>{
  const data=read('site/data/streets-atlas.json'),client=read('work/tarkmap/out/streets/gamedata.json');
  const loose=JSON.parse(fs.readFileSync(path.join(SPT_DB,'locations/tarkovstreets/looseLoot.json'),'utf8'));
  const containers=JSON.parse(fs.readFileSync(path.join(SPT_DB,'locations/tarkovstreets/staticContainers.json'),'utf8'));
  assert.equal(data.stats.loose,loose.spawnpoints.length+loose.spawnpointsForced.length);assert.equal(data.stats.forced,loose.spawnpointsForced.length);assert.equal(data.stats.containers,containers.staticContainers.length);
  assert.equal(data.stats.unresolvedCandidates,0);assert.equal(data.sources.atlas.map,'streets');
  assert.ok(data.stats.matchedContainers>1000);
  assert.equal(new Set(data.points.map(p=>p.id)).size,data.points.length);
  assert.equal(new Set(data.points.map(pointSettingKey)).size,data.points.length);
  for(const point of data.points.filter(p=>p.joinStatus==='matched')){
    const candidates=client.containers.filter(c=>c.id===point.sourceId&&c.template===point.containerTpl);
    const positions=[...new Set(candidates.map(c=>JSON.stringify(c.pos)))];assert.equal(positions.length,1);
    const [x,y,z]=JSON.parse(positions[0]);assert.deepEqual(point.position,{x:-x,y,z});
  }
  for(const point of data.points.filter(p=>p.position))assert.ok(Object.values(point.position).every(Number.isFinite));
});
test('every street root candidate has its own local item icon and all markers resolve',()=>{
  const data=read('site/data/streets-atlas.json');const manifests=['factory/manifest.json','items/manifest.json','items/spt-extras.json'].map(p=>read('site/data/icons/'+p));
  const icons={items:Object.assign({},...manifests.map(m=>m.items)),entries:Object.assign({},...manifests.map(m=>m.entries))};
  for(const p of data.points){
    assert.ok(icons.entries[classifyPointMarker(p,data,icons).key]);
    for(const c of candidatesFor(p,data))if(c.weight==null||c.weight>0)assert.ok(icons.items[c.tpl],`${c.tpl}: ${data.items[c.tpl]?.zh}`);
  }
});
