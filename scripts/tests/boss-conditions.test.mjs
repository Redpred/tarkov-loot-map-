import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describeBossWave} from '../../site/boss-conditions.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
const snapshot=read('site/data/encyclopedia/map-snapshot.json');
const catalog=read('site/data/bosses/catalog.json');
const wave=id=>snapshot.waves.find(w=>w.id===id);
const text=result=>[...result.facts.map(f=>f.label+'：'+f.value),...result.notes].join('\n');
const fact=(result,label)=>result.facts.find(f=>f.label===label)?.value;

test('snapshot raw and encyclopedia detail preserve the same conditions without mutating input',()=>{
  const original=wave('Woods:2'),copy=JSON.stringify(original);
  const asEntry={...original,detail:original.raw};delete asEntry.raw;
  assert.deepEqual(describeBossWave(original),describeBossWave(asEntry));
  assert.equal(JSON.stringify(original),copy);
});

test('snapshot scene and mode flags are separate from current availability and empty modes stay empty',()=>{
  const disabled=describeBossWave(wave('Lighthouse2:0'));
  assert.equal(fact(disabled,'配置模式'),'未列出模式');
  assert.equal(fact(disabled,'场景启用标志'),'快照中关闭');
  assert.match(text(disabled),/不代表活动当前开放/);
  const missing=describeBossWave({});
  assert.equal(fact(missing,'配置模式'),'此记录未提供');
  assert.equal(fact(missing,'场景启用标志'),'此记录未提供');
});

test('zero probability and force spawn are not rewritten as certain encounters',()=>{
  const result=describeBossWave(wave('Terminal_ui:63'));
  assert.equal(fact(result,'波次配置概率'),'0%（不等于实际遭遇率）');
  assert.match(fact(result,'强制生成标志'),/不等于每局必刷/);
  assert.match(text(result),/不能用来覆盖波次概率/);
  assert.equal(fact(describeBossWave({BossChance:120}),'波次配置概率'),'未提供可解释的概率');
});

test('event and interaction triggers are explained without leaking internal trigger IDs',()=>{
  const interaction=describeBossWave(wave('laboratory:14'));
  assert.match(fact(interaction,'触发条件'),/场景物件交互.*具体开关尚未核验/);
  assert.doesNotMatch(text(interaction),/autoId_00014_EXFIL/);
  assert.equal(fact(interaction,'延迟参数'),'8 秒');
  const event=describeBossWave(wave('Icebreaker:0'));
  assert.match(fact(event,'触发条件'),/游戏事件.*具体事件尚未核验/);
  assert.doesNotMatch(text(event),/botEvent|\bT1\b/);
});

test('negative and event sentinel time values are not shown as raid countdowns',()=>{
  assert.match(fact(describeBossWave(wave('Woods:1')),'生成时间参数'),/特殊值 -1.*未设常规倒计时/);
  assert.match(fact(describeBossWave(wave('Icebreaker:0')),'生成时间参数'),/9,999.*不按倒计时/);
  assert.match(fact(describeBossWave({Time:99999}),'生成时间参数'),/99,999.*不按倒计时/);
  assert.doesNotMatch(text(describeBossWave(wave('Icebreaker:0'))),/166 分钟|战局开始后/);
});

test('ordinary timing, random timing, and unverified random delay remain distinct',()=>{
  const result=describeBossWave({Time:450,RandomTimeSpawn:true,Delay:12,RandomDelay:3});
  assert.equal(fact(result,'生成时间参数'),'7 分钟 30 秒（配置值）');
  assert.match(fact(result,'生成时机'),/随机.*范围未提供/);
  assert.equal(fact(result,'延迟参数'),'12 秒');
  assert.equal(fact(result,'随机延迟参数'),'3（单位未核定）');
  assert.match(text(result),/门限判断.*不能据此承诺/);
});

test('Partisan normal and PvE karma flags are shown independently',()=>{
  for(const id of ['Woods:2','Lighthouse:2','bigmap:2','Shoreline:2']){
    const result=describeBossWave(wave(id));
    assert.equal(fact(result,'PvP 业力依赖'),'启用');
    assert.equal(fact(result,'PvE 业力依赖'),'未启用');
  }
  assert.match(fact(describeBossWave({DependKarma:true}),'PvE 业力依赖'),/未提供.*不能按关闭/);
});

test('Kaban main escort and support breakdown are not added into twelve guards',()=>{
  const result=describeBossWave(wave('TarkovStreets:0'));
  assert.equal(fact(result,'基础随行配置'),'Kaban 护卫 · 6 名');
  assert.deepEqual(result.facts.filter(f=>f.label==='随行分组配置').map(f=>f.value),[
    'Kaban 护卫 · 4 名','Kaban 近卫（1） · 1 名','Kaban 近卫（2） · 1 名',
  ]);
  assert.match(text(result),/不相加推算总人数/);
  assert.doesNotMatch(text(result),/12 名/);
});

test('zero-count support records do not become promised guard members',()=>{
  const result=describeBossWave(wave('Woods:1'));
  const support=result.facts.filter(f=>f.label==='随行分组配置').map(f=>f.value);
  assert.deepEqual(support,['Big Pipe · 1 名','Birdeye · 1 名']);
  assert.match(text(result),/1 条随行分组.*数量为零/);
});

test('comma-separated escort amounts preserve candidate counts without inventing a sum or weights',()=>{
  const repeated=describeBossWave({BossEscortType:'followerScourgeEventLab',BossEscortAmount:'4,4,4'});
  assert.match(fact(repeated,'基础随行配置'),/4 名.*重复项/);
  assert.doesNotMatch(text(repeated),/12 名/);
  assert.match(text(repeated),/重复值不作为已确认的概率/);
  const alternatives=describeBossWave({BossEscortType:'pmcBot',BossEscortAmount:'2,2,3,3,3'});
  assert.match(fact(alternatives,'基础随行配置'),/候选数量 2 \/ 3 名/);
});

test('raw zone IDs are hidden while supplied human-readable zone names are retained',()=>{
  const raw=describeBossWave({BossZone:'BotZoneArmory,BotZoneGreenOffice,BotZoneArmory'});
  assert.equal(fact(raw,'生成区域'),'已配置 2 个区域；名称尚未关联');
  assert.doesNotMatch(text(raw),/BotZone/);
  const known=describeBossWave(catalog.appearances.find(a=>a.id==='tarkovstreets:0'));
  assert.equal(fact(known,'生成区域'),'汽车展厅');
  assert.match(text(known),/条目可能重叠.*不累加/);
});

test('legacy flattened records never invent missing scene, mode-specific karma or raw probability',()=>{
  const result=describeBossWave(catalog.appearances.find(a=>a.id==='bigmap:2'));
  assert.equal(fact(result,'场景启用标志'),'此记录未提供');
  assert.equal(fact(result,'波次配置概率'),'未提供可解释的概率');
  assert.match(fact(result,'业力依赖'),/未分别记录 PvP 与 PvE/);
  assert.match(fact(result,'触发条件'),/具体条件尚未核验/);
});

test('all saved wave and legacy records produce plain strings without changing the source',()=>{
  const before=JSON.stringify([snapshot,catalog]);
  for(const entry of [...snapshot.waves,...catalog.appearances]){
    const result=describeBossWave(entry);
    assert.ok(result.facts.every(f=>typeof f.label==='string'&&typeof f.value==='string'));
    assert.ok(result.notes.every(n=>typeof n==='string'));
    assert.doesNotMatch(text(result),/NaN|undefined|\[object Object\]/);
  }
  assert.equal(JSON.stringify([snapshot,catalog]),before);
});
