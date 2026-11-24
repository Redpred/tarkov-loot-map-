import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanRegionName,regionNameKey,regionDisplayName,validateRegionNames} from '../../site/atlas-region-names.js';
import {buildRegionArrival,regionAtPosition,createRegionArrivalTracker} from '../../site/atlas-region-arrivals.js';

const read=map=>JSON.parse(fs.readFileSync(new URL(`../../site/data/${map}-regions.json`,import.meta.url)));
const factory=read('factory').labels,streets=read('streets').labels;
const pos=label=>({...label.position});

test('custom names round-trip while preserving source names and sharing repeated road anchors',()=>{
  const road=streets.find(l=>l.en==='Primorsky Ave.'),original=structuredClone(road);
  const names=validateRegionNames({version:1,names:{[regionNameKey(road)]:'  主干道  \n  中央街  ',unknown:'忽略'}},streets);
  assert.equal(regionDisplayName(road,names),'主干道 中央街');
  assert.deepEqual(road,original,'editing a display name must not overwrite the original English or default translation');
  assert.equal(streets.filter(l=>l.en===road.en&&regionDisplayName(l,names)==='主干道 中央街').length,3);
  const stored=JSON.parse(JSON.stringify({version:1,names}));
  assert.deepEqual(validateRegionNames(stored,streets),names);
  assert.equal(Object.keys(validateRegionNames(stored,factory)).length,0,'names from another map do not leak');
  assert.equal(Object.keys(validateRegionNames({version:1,names:{[road.en]:road.name}},streets)).length,0);
});

test('name validation rejects malformed saved data, strips controls and bounds user input',()=>{
  for(const invalid of [null,{},[],{version:2,names:{}},{version:1,names:[]}])assert.equal(Object.keys(validateRegionNames(invalid,streets)).length,0);
  assert.equal(cleanRegionName('a'.repeat(100)).length,60);
  assert.equal(cleanRegionName(123),'');assert.equal(cleanRegionName(' \u0000\t '),'');
  const label=streets[0],names=validateRegionNames({version:1,names:{[label.en]:'   '}},streets);
  assert.equal(regionDisplayName(label,names),label.name);
  const proto=validateRegionNames(JSON.parse('{"version":1,"names":{"__proto__":"test"}}'),streets);
  assert.equal(Object.keys(proto).length,0);assert.equal(Object.getPrototypeOf(proto),null);
});

test('generated arrival zones are bounded, explicitly approximate, and exclude roads',()=>{
  for(const [map,labels] of [['factory',factory],['streets',streets]])for(const label of labels){
    assert.deepEqual(label.arrival,buildRegionArrival(label,map));
    if(label.kind==='road'){assert.equal(label.arrival,null);continue;}
    assert.equal(label.arrival.approximate,true);
    assert.ok(label.arrival.radius>0&&label.arrival.radius<=42);
    assert.ok(label.arrival.minY<label.arrival.maxY&&label.arrival.maxY<30);
  }
  assert.equal(regionAtPosition(streets,{x:10000,y:0,z:10000}),null);
  assert.equal(regionAtPosition(streets,{x:66,y:100,z:305}),null,'flying far above a name anchor must not enter its building');
});

test('factory entries distinguish stacked rooms and prefer a room within its building',()=>{
  const office=factory.find(l=>l.en==='Main Office'),locker=factory.find(l=>l.en==='Locker Rooms');
  assert.equal(regionAtPosition(factory,pos(office)).id,office.id);
  assert.equal(regionAtPosition(factory,pos(locker)).id,locker.id);
  assert.notEqual(regionAtPosition(factory,{...pos(office),y:1})?.id,office.id);
  const basement=factory.find(l=>l.en==='Underground Stash');
  assert.equal(regionAtPosition(factory,pos(basement)).id,basement.id);
  assert.notEqual(regionAtPosition(factory,{...pos(basement),y:1})?.id,basement.id);
  const lexos=streets.find(l=>l.en==='Lexos');
  assert.equal(regionAtPosition(streets,pos(lexos)).id,lexos.id);
  assert.notEqual(regionAtPosition(streets,{...pos(lexos),z:-lexos.position.z})?.id,lexos.id);
});

const zone=(id,x)=>({id,name:id,en:id,kind:'area',position:{x,y:1,z:0},arrival:{radius:10,minY:0,maxY:5,approximate:true}});
test('additional maps use their actual elevation and separate stacked room floors',()=>{
  const room=(id,y,floor)=>({id,name:id,en:id,kind:'room',floor,position:{x:100,y,z:200}});
  const lower=room('mall',28,'mall'),upper=room('upper',37,'upper');
  for(const label of [lower,upper])label.arrival=buildRegionArrival(label,'interchange');
  assert.equal(regionAtPosition([lower,upper],{x:100,y:28,z:200})?.id,'mall');
  assert.equal(regionAtPosition([lower,upper],{x:100,y:37,z:200})?.id,'upper');
  assert.equal(regionAtPosition([lower,upper],{x:100,y:0,z:200}),null);
  for(const [map,y] of [['ground_zero',24],['shoreline',-60],['woods',90]]){
    const label={id:map,name:map,en:map,kind:'area',position:{x:20,y,z:40}};
    label.arrival=buildRegionArrival(label,map);
    assert.equal(regionAtPosition([label],{x:20,y,z:40}),label,map);
    assert.equal(regionAtPosition([label],{x:20,y:y+50,z:40}),null,map);
  }
});
test('entry announcements wait for stable presence and never repeat while standing or rotating',()=>{
  const a=zone('a',0),tracker=createRegionArrivalTracker([a]),p=pos(a);
  assert.equal(tracker.update(p,0),null);assert.equal(tracker.update(p,449),null);
  assert.equal(tracker.update(p,450),a);
  for(const now of [500,1000,10000])assert.equal(tracker.update(p,now),null);
  assert.equal(tracker.currentId,a.id);
  tracker.reset();assert.equal(tracker.currentId,null);
  assert.equal(tracker.update(p,11000),null);assert.equal(tracker.update(p,11450),a);
});

test('entry borders retain the current region and debounce quick passes, exits and re-entry',()=>{
  const a=zone('a',0),b=zone('b',18),tracker=createRegionArrivalTracker([a,b]);
  tracker.update(pos(a),0);tracker.update(pos(a),450);
  assert.equal(tracker.update({x:10.5,y:1,z:0},600),null);
  assert.equal(tracker.update(pos(a),800),null,'a quick boundary crossing must not announce b');
  tracker.update(pos(b),1000);assert.equal(tracker.update(pos(b),1450),b);
  const outside={x:40,y:1,z:0};tracker.update(outside,2000);assert.equal(tracker.update(outside,2450),null);assert.equal(tracker.currentId,null);
  tracker.update(pos(b),2500);assert.equal(tracker.update(pos(b),2950),null,'very fast re-entry is suppressed');
  tracker.update(outside,6000);tracker.update(outside,6500);tracker.update(pos(b),7000);assert.equal(tracker.update(pos(b),7500),b);
});
