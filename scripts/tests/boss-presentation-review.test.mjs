import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bossContext,bossBriefing,presentBossWave,presentBossCatalog,SCOURGE_END} from '../../site/boss-presentation.js';
import {filterEntries} from '../../site/encyclopedia-data.js';
import {bossPointEligible} from '../../site/boss-data.js';
import {describeBossWave} from '../../site/boss-conditions.js';
import {bossInventoryChoices} from '../../site/boss-ui.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../../site/'+p,import.meta.url)));

test('Scourge uses official name and event expiry cannot remain indefinitely active',()=>{
  const raw=read('data/encyclopedia/bosses.json').find(w=>w.role==='bossscourgeeventlab');
  const before=structuredClone(raw),wave=presentBossWave(raw);
  assert.equal(wave.name,'Scourge');assert.equal(wave.context.kind,'event');
  assert.match(wave.search,/灾厄/);assert.deepEqual(raw,before);
  assert.equal(wave.chance,100);assert.deepEqual(wave.modes,raw.modes);
  const deadline=Date.parse(SCOURGE_END);
  assert.match(bossBriefing(wave,deadline-1)[0].text,/官方已宣布延期/);
  assert.match(bossBriefing(wave,deadline)[0].text,/已超过官方公布/);
  assert.match(bossBriefing(wave,deadline)[0].url,/6935$/);
  assert.equal(describeBossWave(wave).facts.find(f=>f.label==='生成区域').value,'军械库、绿色办公室');
  assert.equal(wave.points.length,0);
});

test('zero-count escorts do not become related inventory roles',()=>{
  const catalog={roles:[{id:'bosspartisan',name:'Partisan'},{id:'sectantwarrior',name:'Cultist Warrior'}],appearances:[]};
  const choices=bossInventoryChoices(catalog,{role:'bosspartisan',detail:{BossEscortType:'sectantWarrior',BossEscortAmount:'0',Supports:[{BossEscortType:'sectantWarrior',BossEscortAmount:'0'}]}});
  assert.equal(choices.choices.find(c=>c.id==='sectantwarrior').related,false);
});

test('detail and raw forms classify trigger/karma/force conditions consistently',()=>{
  for(const raw of [{DependKarma:true},{DependKarmaPVE:true},{ForceSpawn:true},{TriggerName:'botEvent'},{TriggerId:'some-id'}]){
    assert.equal(bossContext({detail:raw}).kind,'conditional');
    assert.equal(bossContext({raw}).kind,'conditional');
  }
  assert.equal(bossContext({detail:{DependKarma:false,DependKarmaPVE:false}}).kind,'configuration');
  const waves=read('data/encyclopedia/bosses.json').map(presentBossWave);
  assert.equal(filterEntries(waves,{scope:'disabled'}).length,85);
  assert.ok(filterEntries(waves,{scope:'conditional'}).length>0);
  for(const mode of ['regular','pve','pvp-season'])assert.ok(filterEntries(waves,{mode}).every(w=>w.modes.includes(mode)));
});

test('archived dark lab positions can be inspected in every mode without changing saved flags',()=>{
  const original=read('data/bosses/catalog.json'),catalog=presentBossCatalog(structuredClone(original));
  const points=read('data/bosses/maps/labs.json').points;
  const blackDivision=points.find(p=>p.bossRefs.some(r=>r.role==='pmcbotblackdiv'));
  assert.ok(blackDivision);
  for(const mode of ['regular','pve','pvp-season']){
    assert.equal(bossPointEligible(blackDivision,catalog,mode),false);
    assert.equal(bossPointEligible(blackDivision,catalog,mode,'laboratory_dark'),true);
  }
  assert.deepEqual(catalog.appearances.map(a=>a.modes),original.appearances.map(a=>a.modes));
  assert.deepEqual(catalog.appearances.map(a=>a.probability),original.appearances.map(a=>a.probability));
});
