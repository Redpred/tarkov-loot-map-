import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {roundEven,adjustedStaticWeight,chance100,groupedContainerProbability,ungroupedContainerProbabilities,looseSelectionProbabilities,findSlot,fillSlot,containerContents,forcedCapPlan} from '../lib/point-value-model.mjs';
import {pointValuePreferences,pointTier,valueContent,valuePoint,createPointValuation,pointMatches,createPointValueSelection,createPointModelClient,verifyPointModelSource,stockPercent,shortValue} from '../../site/atlas-point-values.js';

const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ≠ ${b}`);
const item=(tpl,weight=1,width=1,height=1)=>({tpl,weight,width,height,coefficients:[[tpl,1]],issues:[]});
const point=(id,weight=.1,locationId=id)=>({id,sourceId:id,locationId,kind:'loose',sourceWeight:weight});
const market={mode:'regular',fetchedAt:'2026-10-16T08:00:00Z',items:{a:{trader:{priceRUB:20000},fleaMin:10000,offers:1},b:{trader:{priceRUB:1000},fleaMin:100000,offers:0}}};

test('grouped containers use inclusion in replacement draws, with the source over-capacity branch',()=>{
  close(groupedContainerProbability(.61,[.61,.54,.62,.52,.56,.64],3,4),.4871561024425295);
  close(groupedContainerProbability(1,[1,1],2,2),.75);
  close(groupedContainerProbability(1,[1,1],3,3),1);
  close(groupedContainerProbability(0,[0,1],2,2),0);close(groupedContainerProbability(0,[0,1],3,3),1);
  close(groupedContainerProbability(.5,[.5],0,1),.5);
  assert.equal(groupedContainerProbability(1,[1],-1,2),null);
});
test('ungrouped selection includes the second weighted draw stage after Bernoulli trials',()=>{
  const [p]=ungroupedContainerProbabilities([.5,.5],{samples:20000});
  const q=chance100(50);close(p,q*((1-q)+q*.75),.003);
  close(ungroupedContainerProbabilities([.00001])[0],0);
});
test('banker rounding and the pinned integer chance helper are explicit',()=>{
  assert.deepEqual([.5,1.5,2.5,3.5].map(roundEven),[0,2,2,4]);close(chance100(95),95/99);close(chance100(100),1);
});
test('post-load static weight percentages are applied before normalizing, with integer rounding',()=>{
  assert.equal(adjustedStaticWeight(10,60),6);assert.equal(adjustedStaticWeight(1,60),1);assert.equal(adjustedStaticWeight(1,50),0);assert.equal(adjustedStaticWeight(17,undefined),17);
});
test('weighted selection preserves rare nonzero tails and is invariant to a common weight scale',()=>{
  const rows=[point('a',.1),point('b',.3),point('rare',1e-12)],opts={mean:1,std:0,samples:8000};
  const a=looseSelectionProbabilities(rows,opts),b=looseSelectionProbabilities(rows.map(p=>({...p,sourceWeight:p.sourceWeight*2})),opts);
  close(a.get('a').probability,.25,.01);assert.ok(a.get('rare').probability>0);
  for(const p of rows)close(a.get(p.id).probability,b.get(p.id).probability);
});
test('forced alternative positions form one event; guaranteed loose locations suppress duplicates',()=>{
  const rows=[{...point('f1',.2),sourceId:'forced',forced:true},{...point('f2',.8),sourceId:'forced',forced:true},point('g',1,'same'),point('other',.1,'same'),point('z',0),point('negative',-2)];
  const p=looseSelectionProbabilities(rows,{mean:4,std:0,samples:200});
  close(p.get('f1').probability,.2);close(p.get('f2').probability,.8);close(p.get('g').probability,1);close(p.get('other').probability,0);close(p.get('z').probability,0);close(p.get('negative').probability,0);
});
test('duplicate source IDs keep all tickets but resolve to the first source record',()=>{
  const rows=[{...point('first',.2,'first-location'),sourceId:'same'},{...point('second',.3,'other-location'),sourceId:'same'}];
  const p=looseSelectionProbabilities(rows,{mean:2,std:0,samples:20000});close(p.get('first').probability,1,.01);close(p.get('second').probability,0);
});
test('full source positions compete even when not visible or outside the display envelope',()=>{
  const p=looseSelectionProbabilities([point('shown'),{...point('hidden'),outsideClientEnvelope:true}],{mean:1,std:0,samples:8000});close(p.get('shown').probability,.5,.01);
});
test('global caps consume one forced group, then suppress later groups and ordinary candidates',()=>{
  const rows=[{...point('a'),sourceId:'one',forced:true,rootTpl:'key'},{...point('b'),sourceId:'one',forced:true,rootTpl:'key'},{...point('c'),forced:true,rootTpl:'key'}];
  const result=forcedCapPlan(rows,{key:1});assert.equal(result.allowed.get('a'),true);assert.equal(result.allowed.get('b'),true);assert.equal(result.allowed.get('c'),false);assert.ok(result.exhausted.has('key'));
  const coupled=forcedCapPlan(rows,{key:1},new Set(['key']));assert.equal(coupled.allowed.get('a'),null);assert.equal(coupled.exhausted.size,0);
});
test('inventory packing tries rotation per slot and honours occupied cells',()=>{
  const grid=new Uint8Array(6),slot=findSlot(grid,2,3,3,2);assert.deepEqual(slot,{x:0,y:0,w:2,h:3});fillSlot(grid,2,slot);assert.equal(findSlot(grid,2,3,1,1),null);
});
test('zero count returns before fixed items; fixed candidates are not added twice',()=>{
  const result=containerContents({items:[item('a'),item('b'),item('c')],counts:[{count:0,relativeProbability:1},{count:1,relativeProbability:1}],width:4,height:4,forced:[item('a')],samples:500});
  close(result.stock,.5);close(new Map(result.coefficients).get('a'),.5);close(new Map(result.coefficients).get('b'),1/6);close(result.roots,5/6);
});
test('packing counts accepted items, preserves a rare size class, and stops after source failure limit',()=>{
  const packed=containerContents({items:[item('a'),item('b'),item('rare',1e-12)],counts:[{count:2,relativeProbability:1}],width:1,height:1,samples:100});
  close(packed.roots,1);assert.ok(new Map(packed.coefficients).get('rare')>0);
  const pool=[...Array.from({length:10},(_,i)=>item('large'+i,1,4,4)),item('tiny',1e-9)];
  const failed=containerContents({items:pool,counts:[{count:10,relativeProbability:1}],width:1,height:1,fitAttempts:3,samples:100});
  // Five chances to fit (before the fifth failure ends the loop), not ten.
  close(new Map(failed.coefficients).get('tiny'),5e-10,1e-16);
});
test('small pools use removal while money remains available for repeated draws',()=>{
  const content=containerContents({items:[item('a')],counts:[{count:2,relativeProbability:1}],width:1,height:1,samples:100});
  close(content.stock,1);close(content.roots,1);close(new Map(content.coefficients).get('a'),1);
  const money=containerContents({items:[{...item('cash'),money:true}],counts:[{count:3,relativeProbability:1}],width:4,height:1,samples:100});
  close(money.stock,1);close(money.roots,3);close(new Map(money.coefficients).get('cash'),3);
  const incomplete=containerContents({items:[item('a')],counts:[],width:1,height:1,samples:100});assert.equal(incomplete.stock,null);
});
test('empty outcomes are not deducted twice and runtime value follows the highest valid sale price',()=>{
  const model={stock:.75,roots:1,coefficients:[['a',3.75]],issues:[]};
  const value=valuePoint({probability:.6,issues:[]},model,valueContent(model,market));
  close(value.stock,.45);close(value.conditional,100000);close(value.expected,45000);close(value.expected,value.stock*value.conditional);
  close(valueContent({coefficients:[['b',1]],issues:[]},market).total,1000);
});
test('missing prices preserve coefficients and cannot silently re-normalize the pool or enter a low tier',()=>{
  const model={stock:1,coefficients:[['a',.2],['missing',.8]],issues:[]},content=valueContent(model,market),v=valuePoint({probability:.5},model,content);
  assert.equal(content.total,null);close(content.known,4000);assert.equal(v.expected,null);close(v.knownExpected,2000);assert.equal(pointTier(v.expected),null);
});
test('unresolved shared caps cannot leak into conditional-value tiers either',()=>{
  const model={stock:1,coefficients:[['a',1]],issues:[]},v=valuePoint({probability:null,issues:['global-limit']},model,valueContent(model,market));
  assert.equal(v.stock,null);assert.equal(v.expected,null);assert.equal(v.conditional,null);
});
test('cash face value, quest-only and assembly uncertainty remain distinct',()=>{
  close(valueContent({coefficients:[['5449016a4bdc2d6f028b456f',1234]],issues:[]},market).total,1234);
  assert.equal(valueContent({coefficients:[],issues:['quest-only']},market).total,null);
  assert.equal(valueContent({coefficients:[],issues:['assembly-price']},market).total,null);
});
test('boundaries enter the higher tier and saved thresholds/colors are validated',()=>{
  assert.deepEqual([0,9999,10000,39999,40000,99999,100000].map(n=>pointTier(n)),[0,0,1,1,2,2,3]);
  const valid=pointValuePreferences({thresholds:[15000,30000,90000],colors:['#123abc','#ffffff','#101010','#fedcba']});assert.equal(valid.metric,'expected');assert.equal(valid.colors[0],'#123abc');
  assert.deepEqual(pointValuePreferences({thresholds:[40,10,100]}).thresholds,[10000,40000,100000]);assert.equal(pointValuePreferences({colors:['red']}).colors[0],'#e2e8f0');
  assert.equal(stockPercent(null),'—');assert.equal(stockPercent(.00001),'<0.1%');assert.equal(shortValue(1),'<0.1K');
});
test('metric and kind filters remain independent; unknown is an explicit separate option',()=>{
  const prefs=pointValuePreferences({tiers:[2]});const v={expected:45000,conditional:100000};assert.equal(pointMatches(point('a'),v,prefs),true);assert.equal(pointMatches(point('a'),v,{...prefs,metric:'conditional'}),false);
  assert.equal(pointMatches(point('a'),{expected:null},prefs),false);assert.equal(pointMatches(point('a'),{expected:null},{...prefs,unknown:true}),true);assert.equal(pointMatches(point('a'),v,{...prefs,kinds:[]}),false);
});
test('applied selections preserve the price snapshot and copied tier preferences until cancellation',()=>{
  const s=createPointValueSelection(),prefs=pointValuePreferences(),values=new Map([['a',{expected:45000}]]);s.apply({preferences:prefs,market,values});prefs.thresholds[0]=999999;prefs.colors[2]='#000000';values.clear();
  assert.equal(s.matches(point('a')),true);assert.equal(s.color(point('a')),'#c69aff');assert.equal(s.export().mode,'regular');s.cancel();assert.equal(s.active,false);assert.equal(s.matches(point('a')),false);
});
test('model loading coalesces requests, validates responses, and retries failed loads',async()=>{
  let calls=0;const client=createPointModelClient({fetchImpl:async()=>{calls++;return {ok:calls>1,json:async()=>({schemaVersion:1,map:'factory',models:{},points:{}})};}});
  await assert.rejects(client.load('factory'));const [a,b]=await Promise.all([client.load('factory'),client.load('factory')]);assert.equal(a,b);assert.equal(calls,2);
  assert.throws(()=>verifyPointModelSource({source:{commit:'old',files:{}}},{sources:{spt:{commit:'new'}}}));
});
test('all 13 derived maps match their source fingerprints, keep full pools, and obey expected-value identities',()=>{
  const root=new URL('../../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
  let known=0;for(const map of Object.values(ATLAS_MAPS)){
    const data=read('site/'+map.data),model=read(`site/data/point-values/${map.id}.json`);verifyPointModelSource(model,data);
    assert.equal(model.source.atlasSHA256,createHash('sha256').update(fs.readFileSync(new URL('site/'+map.data,root))).digest('hex'));
    assert.equal(Object.keys(model.points).length,data.points.filter(p=>['loose','container'].includes(p.kind)).length);
    for(const m of Object.values(model.models)){assert.ok(m.stock==null||m.stock>=0&&m.stock<=1);for(const [,n] of m.coefficients)assert.ok(Number.isFinite(n)&&n>0);}
    for(const v of createPointValuation(model,market).values())if(v.expected!=null&&v.stock>0){known++;close(v.expected,v.stock*v.conditional,.00001);}
  }assert.ok(known>10);
});
