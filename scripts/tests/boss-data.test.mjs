import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {configurationProbability,verifiedCandidate,inventoryGroups} from '../lib/boss-data.mjs';
import {attachBossPoints,bossPointEligible,bossPointSelected,probabilityLabel,loadBossData} from '../../site/boss-data.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
const root='work/boss-integration-20261020/staged/';
const catalog=read(root+'catalog.json'),manifest=read(root+'manifest.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('conditional boss rates stay unknown; zero is a known configuration, never an item weight',()=>{
  assert.deepEqual(configurationProbability({BossChance:0}),{value:0,basis:'version-configuration',scope:'wave'});
  for(const extra of [{TriggerId:'event'},{TriggerName:'event'},{DependKarma:true},{ForceSpawn:true},{BossChance:120},{BossChance:'50'}])assert.equal(configurationProbability({BossChance:75,...extra}),null);
  assert.equal(probabilityLabel({probability:{value:43,basis:'weight',scope:'wave'}}),'');
  assert.equal(probabilityLabel({probability:{value:100,basis:'version-configuration',scope:'point'}}),'');
});
test('candidate joins reject moved, inactive and non-boss markers; ranges require matching source radii',()=>{
  const s={Position:{x:4,y:2,z:6},Categories:['Boss'],ColliderParams:{_parent:'SpawnSphereParams',_props:{Center:{x:0,y:0,z:0},Radius:7}}};
  const c={pos:[-4,2,6],categories:['boss'],active:true,radius:7};
  assert.deepEqual(verifiedCandidate(s,c).position,s.Position);
  assert.equal(verifiedCandidate(s,c).range.radius,7);
  assert.equal(verifiedCandidate(s,{...c,radius:9}).range,null);
  for(const change of [{pos:[-5,2,6]},{active:false},{categories:['player']}])assert.ok(verifiedCandidate(s,{...c,...change}).reason);
  assert.equal(verifiedCandidate({...s,ColliderParams:{_parent:'SpawnSphereParams',_props:{Center:{x:1,y:0,z:0},Radius:7}}},c).range,null);
});
test('unequipped backpack pools and zero-weight entries are not shown as obtainable inventory',()=>{
  const b={chances:{equipment:{Backpack:0}},inventory:{equipment:{Backpack:{a:1},Scabbard:{b:2,c:0}},items:{Backpack:{d:1},Pockets:{e:3}}}};
  const groups=inventoryGroups(b);
  assert.deepEqual(groups.flatMap(g=>g.items.map(i=>i.tpl)),['b','e']);
  assert.ok(groups.flatMap(g=>g.items).every(i=>!Object.hasOwn(i,'probability')));
  const fallback=inventoryGroups({chances:{equipment:{Holster:0,FirstPrimaryWeapon:99}},inventory:{equipment:{Holster:{pistol:1}}}});
  assert.equal(fallback[0].items[0].tpl,'pistol');
});
test('laboratory black division is tied to dark lab, with leader, followers and soldier waves preserved',()=>{
  const labs=read(root+'maps/labs.json');
  const leader=catalog.appearances.find(a=>a.role==='bosswedgelab'&&a.mapId==='labs');
  assert.equal(leader.location,'laboratory_dark');assert.equal(leader.variant,'暗区实验室');
  assert.equal(leader.pointIds.length,19);assert.equal(leader.probability.value,100);
  assert.deepEqual(leader.companions,[{role:'followerwedgelab',amounts:[3]}]);
  assert.equal(catalog.appearances.filter(a=>a.role==='pmcbotblackdiv'&&a.mapId==='labs').length,5);
  assert.ok(catalog.roles.find(r=>r.id==='followerwedgelab').groups.length>0);
  assert.ok(labs.points.every(p=>p.coordinateDelta<=.05&&p.range&&p.position.x<0));
  const p=labs.points.find(p=>p.bossRefs.some(r=>r.role==='bosswedgelab'));
  assert.equal(bossPointSelected(p,catalog,new Set(['boss:bosswedgelab']),'regular'),true);
  assert.equal(bossPointEligible(p,catalog,'pvp-season'),false);
  assert.equal(bossPointEligible(p,catalog,'regular','laboratory'),false);
});
test('unlocated and triggered roles retain inventory without guessed coordinates',()=>{
  const partisan=catalog.roles.find(r=>r.id==='bosspartisan');
  assert.ok(partisan.groups.length);
  for(const a of catalog.appearances.filter(a=>a.role==='bosspartisan')){assert.equal(a.pointIds.length,0);assert.equal(a.probability,null);}
  const maze=read(root+'maps/labyrinth.json');
  assert.equal(maze.points.length,0);assert.ok(maze.roleIds.includes('bosskillaagro'));
});
test('sidecars preserve source IDs and coordinates, deduplicate physical candidates and keep weights private',()=>{
  for(const [id,info]of Object.entries(manifest.maps)){
    const bytes=fs.readFileSync(new URL('../../'+root+info.file.replace('data/bosses/',''),import.meta.url));
    assert.equal(hash(bytes),info.sha256);assert.equal(bytes.length,info.bytes);
    const m=JSON.parse(bytes);assert.equal(new Set(m.points.map(p=>p.id)).size,m.points.length);
    for(const p of m.points){
      assert.ok(p.bossRefs.length);assert.ok(!p.referenceOnly||p.range===null);
      assert.ok(!Object.hasOwn(p,'probability'));assert.ok(!Object.hasOwn(p,'volumes'));
      for(const ref of p.bossRefs)assert.ok(catalog.appearances.some(a=>a.id===ref.appearanceId&&(a.pointIds.includes(p.id)||a.referenceIds.includes(p.id))));
    }
  }
  for(const r of catalog.roles)for(const g of r.groups)for(const item of g.items)assert.ok(catalog.items[item.tpl]);
});
test('runtime attachment replaces only legacy boss placeholders and keeps quest/loot object identity',()=>{
  const quest={id:'q',kind:'poi',quest:true,poiTypes:['boss']},loot={id:'loot',kind:'loose'},other={id:'door',kind:'poi',poiTypes:['locked_door']};
  const data={sources:{spt:{commit:manifest.sourceCommit},atlas:{eftBuild:47965}},points:[quest,loot,other,{id:'old',kind:'poi',poiTypes:['boss']}]};
  const layer=read(root+'maps/labs.json');
  attachBossPoints(data,layer);
  assert.deepEqual(data.points.slice(0,3),[quest,loot,other]);assert.equal(data.points[0],quest);
  assert.throws(()=>attachBossPoints(data,{...layer,eftBuild:1}));
});
test('runtime loader checks content fingerprints and matching geometry before returning a layer',async()=>{
  const layer=read(root+'maps/labs.json'),source={spt:{commit:manifest.sourceCommit},atlas:{eftBuild:47965}};
  const fetcher=async url=>{
    const file=String(url).split('?')[0].replace('data/bosses/','');
    return new Response(fs.readFileSync(new URL('../../'+root+file,import.meta.url)));
  };
  assert.equal((await loadBossData({mapId:'labs',geometrySha256:layer.geometrySha256,source,fetcher})).map.points.length,48);
  await assert.rejects(loadBossData({mapId:'labs',geometrySha256:'wrong',source,fetcher}),/待更新/);
  await assert.rejects(loadBossData({fetcher:async url=>String(url).includes('catalog.json')?new Response('{}'):fetcher(url)}),/校验/);
});
