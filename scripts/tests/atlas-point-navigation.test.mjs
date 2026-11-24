import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMapTapTracker,createPointDoubleTapTracker} from '../../site/atlas-touch.js';
import {firstPersonEntryPosition} from '../../site/atlas-navigation.js';
import {createFirstPerson} from '../../site/atlas-first-person.js';
import {validateViewSettings} from '../../site/atlas-view-settings.js';

const pointer=(time,extra={})=>({pointerId:1,pointerType:'mouse',button:0,clientX:50,clientY:60,timeStamp:time,...extra});
test('double click and double tap require the same point; a third tap starts a new pair',()=>{
  for(const pointerType of ['mouse','touch','pen']){
    const tracker=createPointDoubleTapTracker();
    assert.equal(tracker.tap('a',pointer(100,{pointerType})),false);
    assert.equal(tracker.tap('a',pointer(350,{pointerType})),true);
    assert.equal(tracker.tap('a',pointer(550,{pointerType})),false);
    assert.equal(tracker.tap('b',pointer(650,{pointerType})),false);
    assert.equal(tracker.tap('b',pointer(1101,{pointerType})),false);
    tracker.reset();assert.equal(tracker.tap('b',pointer(1200,{pointerType})),false);
  }
});
test('blank, spatially distant and mixed input taps never focus a point accidentally',()=>{
  for(const extra of [{clientX:59},{pointerType:'touch'},{timeStamp:99}]){
    const tracker=createPointDoubleTapTracker();tracker.tap('a',pointer(100));
    assert.equal(tracker.tap('a',pointer(200,extra)),false);
  }
  const tracker=createPointDoubleTapTracker();tracker.tap('a',pointer(100));
  tracker.tap(null,pointer(200));assert.equal(tracker.tap('a',pointer(300)),false);
  tracker.reset();tracker.tap('a',pointer(400,{pointerType:'touch'}));
  assert.equal(tracker.tap('a',pointer(500,{pointerType:'touch',clientX:70})),true);
});
test('a drag returning to its start and a pinch interrupt a pair of taps',()=>{
  const taps=createMapTapTracker(),pairs=createPointDoubleTapTracker();
  const up=e=>{if(taps.up(e))return pairs.tap('a',e);pairs.reset();return false;};
  taps.down(pointer(0));assert.equal(up(pointer(20)),false);
  taps.down(pointer(100));taps.move(pointer(120,{clientX:70}));
  assert.equal(up(pointer(140)),false);
  taps.down(pointer(200));assert.equal(up(pointer(220)),false);
  taps.down(pointer(300,{pointerType:'touch'}));taps.down(pointer(310,{pointerType:'touch',pointerId:2}));
  assert.equal(up(pointer(320,{pointerType:'touch',pointerId:2})),false);
  assert.equal(up(pointer(330,{pointerType:'touch'})),false);
  taps.down(pointer(350,{pointerType:'touch'}));assert.equal(up(pointer(370,{pointerType:'touch'})),false);
});
test('an explicit point uses its own floor and converts Unity Z once without a roof raycast or offset',()=>{
  const point={position:{x:25,y:-3,z:17}},target=new THREE.Vector3(0,12,0),camera={position:new THREE.Vector3(20,200,20)};
  const position=firstPersonEntryPosition({point,target,camera,surface(){throw new Error('must not raycast the roof');}});
  assert.deepEqual(position.toArray(),[25,-3,-17]);
  assert.deepEqual(point.position,{x:25,y:-3,z:17});assert.deepEqual(target.toArray(),[0,12,0]);
});
test('without a located point entry still follows the observed surface, falling back to the orbit target',()=>{
  const target=new THREE.Vector3(0,2,0),surface=new THREE.Vector3(0,5,0),camera={position:new THREE.Vector3(10,100,0)};
  assert.deepEqual(firstPersonEntryPosition({target,camera,surface:()=>surface}).toArray(),[1.1,5,0]);
  assert.deepEqual(firstPersonEntryPosition({point:{position:{x:NaN,y:0,z:0}},target,camera,surface:()=>null}).toArray(),[1.1,2,0]);
  assert.deepEqual(surface.toArray(),[0,5,0]);assert.deepEqual(target.toArray(),[0,2,0]);
});

function withFirstPerson(run){
  const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const canvas=new EventTarget(),doc=new EventTarget(),frames=new Map();let counter=0,time=performance.now();
  canvas.focus=()=>{doc.activeElement=canvas;};doc.querySelector=()=>null;
  Object.assign(globalThis,{window:new EventTarget(),document:doc,requestAnimationFrame:cb=>{frames.set(++counter,cb);return counter;},cancelAnimationFrame:id=>frames.delete(id)});
  const tick=()=>{const pending=[...frames.values()];frames.clear();for(const cb of pending)cb(time+=20);};
  let fp;
  try{run({create(options={}){return fp=createFirstPerson({canvas,settings:validateViewSettings(),onChange(){},onNotice(){},...options});},tick,frames});}
  finally{fp?.exit();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
test('fly entry and teleport preserve the point coordinates plus eye height, and re-entering keeps the current location',()=>withFirstPerson(({create,frames})=>{
  const fp=create();fp.enter(new THREE.Vector3(25,-3,-17));
  assert.deepEqual(fp.camera.position.toArray(),[25,-1.35,-17]);
  fp.teleport(new THREE.Vector3(40,7,12));assert.deepEqual(fp.camera.position.toArray(),[40,8.65,12]);
  fp.enter();assert.deepEqual(fp.camera.position.toArray(),[40,8.65,12]);
  fp.enter();assert.deepEqual(fp.camera.position.toArray(),[40,8.65,12]);assert.equal(frames.size,1);
}));
test('flight hovers without a ground or loading dependency, ignores jump and crosses all heights',()=>withFirstPerson(({create,tick})=>{
  const fp=create();fp.enter(new THREE.Vector3(25,-3,-17));
  const origin=fp.camera.position.clone();for(let i=0;i<60;i++)tick();
  assert.ok(fp.camera.position.equals(origin),'idle flight must not snap to a surface or fall');
  const space=Object.assign(new Event('keydown',{cancelable:true}),{code:'Space',repeat:false});
  window.dispatchEvent(space);tick();assert.equal(space.defaultPrevented,false);assert.ok(fp.camera.position.equals(origin));
  fp.setTouchMovement({up:-1});for(let i=0;i<60;i++)tick();assert.ok(fp.camera.position.y<-3,'flight can pass below the entry floor');
  fp.setTouchMovement({up:0});fp.teleport(new THREE.Vector3(40,-120,12));tick();
  assert.deepEqual(fp.camera.position.toArray(),[40,-118.35,12],'deep flight must not trigger a falling recovery');
  assert.equal(fp.mode,'fly');
}));
