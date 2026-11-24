import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { looseCandidates, joinContainers, atlasToUnity, pointMatches, coordinateEnvelope, outsideEnvelope } from '../lib/factory-data.mjs';
import path from 'node:path';
import {SPT_DB} from '../lib/spt-source.mjs';
test('root selection keeps child ammunition separate and preserves zero weight',()=>{
  const sp={template:{Root:'a',Items:[{_id:'a',_tpl:'box',composedKey:'1'},{_id:'b',_tpl:'ammo',parentId:'a',upd:{StackObjectsCount:20}},{_id:'c',_tpl:'other',composedKey:'2'}]},itemDistribution:[{composedKey:{key:'1'},relativeProbability:8},{composedKey:{key:'2'},relativeProbability:0}]};
  const {candidates}=looseCandidates(sp);
  assert.deepEqual(candidates.map(c=>c.tpl),['box','other']);
  assert.equal(candidates[0].included[0].count,20);
  assert.equal(candidates[1].weight,0);
});
test('container join uses exact ID and template; zero placeholders are not map positions',()=>{
  const s=[{probability:0.39,template:{Id:'id',Root:'r',Items:[{_id:'r',_tpl:'bag'}],Position:{x:0,y:0,z:0}}}];
  assert.deepEqual(joinContainers(s,[{id:'id',template:'bag',pos:[-4,2,8]}])[0].position,{x:4,y:2,z:8});
  assert.equal(joinContainers(s,[{id:'id',template:'wrong',pos:[4,2,8]}])[0].position,null);
  assert.equal(joinContainers(s,[{id:'id',template:'bag',pos:[4,2,8]},{id:'id',template:'bag',pos:[5,2,8]}])[0].joinStatus,'ambiguous');
  assert.deepEqual(atlasToUnity([2,-1,4]),{x:-2,y:-1,z:4});
});
test('real Factory dataset retains all records and finds ammo packed inside a parent item',()=>{
  const d=JSON.parse(fs.readFileSync(new URL('../../site/data/factory-atlas.json',import.meta.url)));
  const loose=JSON.parse(fs.readFileSync(path.join(SPT_DB,'locations/factory4_day/looseLoot.json'),'utf8'));
  const containers=JSON.parse(fs.readFileSync(path.join(SPT_DB,'locations/factory4_day/staticContainers.json'),'utf8'));
  assert.equal(d.stats.loose,loose.spawnpoints.length+loose.spawnpointsForced.length);assert.equal(d.stats.containers,containers.staticContainers.length);
  assert.equal(d.stats.unresolvedCandidates,0);
  assert.ok(d.stats.matchedContainers>150);
  assert.equal(d.coordinateAudit.outsideLoose,d.points.filter(p=>p.outsideClientEnvelope).length);
  assert.ok(d.points.filter(p=>p.kind==='loose' && !p.outsideClientEnvelope).length>350);
  assert.equal(new Set(d.points.map(p=>p.id)).size,d.points.length);
  for(const p of d.points.filter(p=>p.position)) assert.ok(Object.values(p.position).every(Number.isFinite));
  const p=d.points.find(p=>p.candidates?.some(c=>c.included?.length));
  const tpl=p.candidates.find(c=>c.included?.length).included[0].tpl;
  assert.ok(pointMatches(p,d,tpl));
  const container=d.points.find(p=>p.kind==='container'&&d.pools[p.pool]?.items.some(it=>it.weight>0));
  const contained=d.pools[container.pool].items.find(it=>it.weight>0).tpl;
  assert.ok(pointMatches(container,d,contained));
});

test('spatial audit preserves edge points and flags remote coordinates without altering them',()=>{
  const envelope=coordinateEnvelope([{x:-10,z:-20},{x:10,z:20}]);
  assert.equal(outsideEnvelope({x:20,z:30},envelope),false);
  assert.equal(outsideEnvelope({x:260,z:-150},envelope),true);
  assert.equal(outsideEnvelope({x:260,z:-150},null),false);
});
