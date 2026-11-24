import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMapTapTracker,markerHitRadius,touchMovement,createTouchNavigation} from '../../site/atlas-touch.js';
import {createFirstPerson} from '../../site/atlas-first-person.js';
import {validateViewSettings} from '../../site/atlas-view-settings.js';

const pointer=(pointerId=1,extra={})=>({pointerId,button:0,pointerType:'touch',clientX:100,clientY:100,timeStamp:100,...extra});
test('touch taps tolerate finger jitter, but a drag that returns to its start never selects',()=>{
  const tracker=createMapTapTracker();
  tracker.down(pointer());tracker.move(pointer(1,{clientX:105}));assert.equal(tracker.up(pointer(1,{clientX:105,timeStamp:200})),true);
  tracker.down(pointer());tracker.move(pointer(1,{clientX:120}));tracker.move(pointer());assert.equal(tracker.up(pointer()),false);
  tracker.down(pointer());assert.equal(tracker.up(pointer(1,{timeStamp:900})),false,'long presses do not select');
  tracker.down(pointer(1,{pointerType:'mouse'}));assert.equal(tracker.up(pointer(1,{pointerType:'mouse',clientX:105})),false,'mouse keeps its precise movement threshold');
});

test('a pinch cannot select with either finger, including a cancelled finger or a third touch',()=>{
  const tracker=createMapTapTracker();
  tracker.down(pointer(1));tracker.down(pointer(2));assert.equal(tracker.up(pointer(2)),false);assert.equal(tracker.up(pointer(1)),false);
  tracker.down(pointer(1));tracker.down(pointer(2));tracker.cancel(pointer(2));assert.equal(tracker.up(pointer(1)),false);
  tracker.down(pointer(1));tracker.down(pointer(2));tracker.down(pointer(3));assert.equal(tracker.up(pointer(1)),false);assert.equal(tracker.up(pointer(2)),false);assert.equal(tracker.up(pointer(3)),false);
  tracker.down(pointer());assert.equal(tracker.up(pointer()),true,'next independent touch can select');
  tracker.down(pointer());tracker.cancel(pointer());assert.equal(tracker.up(pointer()),false,'lost capture drops the captured pointer');
  tracker.down(pointer());tracker.reset();assert.equal(tracker.up(pointer()),false,'blur drops an unfinished selection');
});

test('touch hit targets are at least 44 px across while mouse sizes are unchanged',()=>{
  assert.equal(markerHitRadius('icons',26,'touch'),22);assert.equal(markerHitRadius('dots',26,'touch'),22);
  assert.equal(markerHitRadius('icons',60,'touch'),32);assert.equal(markerHitRadius('icons',26,'mouse'),15);
  assert.equal(markerHitRadius('dots',26,'mouse'),12);
});

test('held touch directions combine and opposing buttons cancel',()=>{
  assert.deepEqual(touchMovement(new Set(['forward','right','up'])),{forward:1,right:1,up:1});
  assert.deepEqual(touchMovement(new Set(['forward','backward','right','left','up','down'])),{forward:0,right:0,up:0});
  assert.deepEqual(touchMovement(new Set(['backward','left','down'])),{forward:-1,right:-1,up:-1});
});

test('touch buttons release capture and movement on cancel, capture loss, hiding and mode changes',()=>{
  const saved={window:globalThis.window,document:globalThis.document};
  const win=new EventTarget(),doc=new EventTarget(),canvas={focus(){}},element={dataset:{},setAttribute(){}};
  const buttons=Object.fromEntries(['forward','left','backward','right','up','down'].map(action=>{
    const button=new EventTarget(),captures=new Set();button.dataset={touchAction:action};button.attributes={};
    button.setAttribute=(key,value)=>button.attributes[key]=value;button.hasPointerCapture=id=>captures.has(id);button.setPointerCapture=id=>captures.add(id);
    button.releasePointerCapture=id=>{captures.delete(id);button.dispatchEvent(Object.assign(new Event('lostpointercapture'),{pointerId:id}));};
    return [action,button];
  }));
  element.querySelectorAll=()=>Object.values(buttons);doc.createElement=()=>element;
  Object.assign(globalThis,{window:win,document:doc});
  let movement;
  const fire=(action,type,id=1)=>buttons[action].dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:id,button:0}));
  const key=(action,type,code)=>{const event=Object.assign(new Event(type,{cancelable:true}),{code,repeat:false});(type==='keydown'?buttons[action]:win).dispatchEvent(event);return event;};
  const focus=target=>{const event=new Event('focusin');Object.defineProperty(event,'target',{value:target});doc.dispatchEvent(event);};
  try{
    const navigation=createTouchNavigation({parent:{append(){}},canvas,onMove:input=>movement=input});
    const markup=[...element.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.equal(markup.length,6);
    for(const [,attributes,content] of markup){
      assert.match(attributes,/aria-label="[^"]+"/,'icons retain accessible action names');
      assert.match(content,/<svg[^>]*aria-hidden="true"[^>]*><path /);
      assert.equal(content.replace(/<[^>]*>/g,''),'','controls contain no selectable text nodes');
    }
    navigation.setMode('fly');assert.equal(element.hidden,false);assert.doesNotMatch(element.innerHTML,/jump|跳跃/);
    fire('forward','pointerdown');fire('right','pointerdown',2);assert.deepEqual(movement,{forward:1,right:1,up:0});
    for(const type of ['selectstart','contextmenu','dragstart']){
      const event=new Event(type,{cancelable:true});buttons.forward.dispatchEvent(event);
      assert.equal(event.defaultPrevented,true);assert.deepEqual(movement,{forward:1,right:1,up:0},'long-press protection does not release held movement');
    }
    fire('forward','pointercancel');assert.deepEqual(movement,{forward:0,right:1,up:0});assert.equal(buttons.forward.attributes['aria-pressed'],'false');
    fire('right','lostpointercapture',2);assert.deepEqual(movement,{forward:0,right:0,up:0});
    fire('forward','pointerdown');fire('right','pointerdown',2);focus({tagName:'INPUT'});assert.deepEqual(movement,{forward:0,right:0,up:0});assert.equal(buttons.forward.hasPointerCapture(1),false);
    fire('right','pointerup',2);assert.equal(movement.forward,0,'releasing a stale second pointer cannot restart the first');
    assert.equal(key('forward','keydown','Space').defaultPrevented,true);assert.equal(movement.forward,1);key('forward','keyup','Space');assert.equal(movement.forward,0);
    key('right','keydown','Enter');assert.equal(movement.right,1);focus({tagName:'INPUT'});assert.equal(movement.right,0);key('right','keyup','Enter');assert.equal(movement.right,0);
    fire('up','pointerdown');win.dispatchEvent(new Event('blur'));assert.deepEqual(movement,{forward:0,right:0,up:0});
    fire('forward','pointerdown');doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(movement.forward,0);doc.hidden=false;
    for(const type of ['fullscreenchange','webkitfullscreenchange','orientationchange']){
      fire('forward','pointerdown');fire('right','pointerdown',2);
      (type==='orientationchange'?win:doc).dispatchEvent(new Event(type));
      assert.deepEqual(movement,{forward:0,right:0,up:0});assert.equal(buttons.forward.hasPointerCapture(1),false);
    }
    fire('forward','pointerdown');navigation.setMode(null);assert.equal(movement.forward,0);assert.equal(element.hidden,true);
    navigation.setMode('fly');assert.equal(element.hidden,false);
    buttons.forward.dispatchEvent(Object.assign(new Event('click'),{detail:0}));assert.equal(movement.forward,1,'assistive activation gives a short movement step');
    navigation.setMode(null);assert.equal(element.hidden,true);assert.equal(movement.forward,0);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('first-person touch movement stops on release, focus loss, blur and mode changes',()=>{
  const saved={window:globalThis.window,document:globalThis.document,performance:globalThis.performance,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const canvas=new EventTarget(),win=new EventTarget(),doc=new EventTarget(),frames=new Map();let sequence=0,time=performance.now();
  canvas.focus=()=>{doc.activeElement=canvas;};canvas.hasPointerCapture=()=>false;doc.querySelector=()=>null;
  // enter() and fake animation frames must use the same clock under CPU load.
  Object.assign(globalThis,{window:win,document:doc,performance:{now:()=>time},requestAnimationFrame:cb=>{frames.set(++sequence,cb);return sequence;},cancelAnimationFrame:id=>frames.delete(id)});
  const tick=()=>{time+=20;const callbacks=[...frames.values()];frames.clear();for(const cb of callbacks)cb(time);};
  try{
    const fp=createFirstPerson({canvas,settings:validateViewSettings(),onChange(){},onNotice(){}});
    fp.enter(new THREE.Vector3());const start=fp.camera.position.clone();
    fp.setTouchMovement({forward:1,right:1,up:1});tick();assert.ok(fp.camera.position.z<start.z&&fp.camera.position.x>start.x&&fp.camera.position.y>start.y);
    fp.setTouchMovement({forward:0,right:0,up:0});let stopped=fp.camera.position.clone();tick();assert.ok(fp.camera.position.equals(stopped));
    doc.activeElement={closest:()=>({})};fp.setTouchMovement({forward:1});tick();assert.ok(fp.camera.position.z<stopped.z,'a focused direction button can move');
    fp.setTouchMovement({forward:0});stopped=fp.camera.position.clone();win.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW'}));tick();assert.ok(fp.camera.position.equals(stopped),'ordinary keyboard shortcuts still require canvas focus');
    fp.setTouchMovement({forward:1});doc.activeElement={};tick();canvas.focus();tick();assert.ok(fp.camera.position.equals(stopped),'opening a control clears held movement');
    fp.setTouchMovement({forward:1});win.dispatchEvent(new Event('blur'));tick();assert.ok(fp.camera.position.equals(stopped));
    fp.setTouchMovement({forward:1});fp.enter();stopped=fp.camera.position.clone();tick();assert.ok(fp.camera.position.equals(stopped));
    fp.setTouchMovement({forward:NaN,right:Infinity});tick();assert.ok(fp.camera.position.equals(stopped),'invalid axes cannot corrupt camera position');
    fp.exit();assert.equal(frames.size,0);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
