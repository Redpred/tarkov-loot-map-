import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFullscreenControl} from '../../site/atlas-fullscreen.js';

function setup(){
  const doc=new EventTarget(),button=new EventTarget(),attributes=new Map(),messages=[];
  doc.documentElement={};button.setAttribute=(key,value)=>attributes.set(key,value);
  return {doc,button,attributes,messages,bind:()=>bindFullscreenControl({button,document:doc,onUnavailable:reason=>messages.push(reason)})};
}
test('fullscreen requests the whole document in the click, hides navigation, and follows system exits',async()=>{
  const {doc,button,attributes,messages,bind}=setup();let options,receiver;
  doc.documentElement.requestFullscreen=function(value){receiver=this;options=value;doc.fullscreenElement=this;doc.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();};
  const control=bind();assert.equal(attributes.get('aria-pressed'),'false');
  const pending=control.toggle();assert.equal(receiver,doc.documentElement);assert.deepEqual(options,{navigationUI:'hide'});assert.equal(button.disabled,true);
  await pending;assert.equal(attributes.get('aria-pressed'),'true');assert.match(button.innerHTML,/退出全屏/);assert.equal(button.disabled,false);
  doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));assert.equal(attributes.get('aria-pressed'),'false');assert.deepEqual(messages,[]);
});
test('the same button exits fullscreen and failed exits retain the real state',async()=>{
  const {doc,attributes,messages,bind}=setup();doc.fullscreenElement=doc.documentElement;
  doc.exitFullscreen=async()=>{throw Error('denied');};const control=bind();await control.toggle();
  assert.deepEqual(messages,['exit']);assert.equal(attributes.get('aria-pressed'),'true');
  doc.exitFullscreen=async function(){assert.equal(this,doc);doc.fullscreenElement=null;doc.dispatchEvent(new Event('fullscreenchange'));};
  await control.toggle();assert.equal(attributes.get('aria-pressed'),'false');
});
test('unsupported and policy-disabled browsers offer help without claiming fullscreen',async()=>{
  for(const disabled of [false,true]){
    const {doc,attributes,messages,bind}=setup();
    if(disabled){doc.fullscreenEnabled=false;doc.documentElement.requestFullscreen=()=>{throw Error('must not call');};}
    await bind().toggle();assert.deepEqual(messages,['unsupported']);assert.equal(attributes.get('aria-pressed'),'false');
  }
});
test('rejection and synchronous exceptions re-enable retry without changing the state',async()=>{
  for(const synchronous of [false,true]){
    const {doc,button,attributes,messages,bind}=setup();
    doc.documentElement.requestFullscreen=()=>{if(synchronous)throw Error('denied');return Promise.reject(Error('denied'));};
    const control=bind();await control.toggle();assert.equal(button.disabled,false);assert.equal(attributes.get('aria-pressed'),'false');assert.deepEqual(messages,['denied']);
    doc.documentElement.requestFullscreen=async()=>{doc.fullscreenElement=doc.documentElement;};await control.toggle();assert.equal(attributes.get('aria-pressed'),'true');
  }
});
test('rapid repeated activation does not start overlapping fullscreen requests',async()=>{
  const {doc,bind}=setup();let resolve,calls=0;
  doc.documentElement.requestFullscreen=()=>{calls++;return new Promise(done=>resolve=done);};
  const control=bind(),pending=control.toggle();await control.toggle();assert.equal(calls,1);resolve();await pending;
});
test('older WebKit enters/exits with prefixed methods and change/error events',async()=>{
  const {doc,attributes,messages,bind}=setup();
  doc.documentElement.webkitRequestFullscreen=function(){assert.equal(arguments.length,0);doc.webkitFullscreenElement=this;doc.dispatchEvent(new Event('webkitfullscreenchange'));};
  doc.webkitExitFullscreen=function(){assert.equal(this,doc);doc.webkitFullscreenElement=null;doc.dispatchEvent(new Event('webkitfullscreenchange'));};
  const control=bind();await control.toggle();assert.equal(attributes.get('aria-pressed'),'true');await control.toggle();assert.equal(attributes.get('aria-pressed'),'false');
  doc.dispatchEvent(new Event('webkitfullscreenerror'));assert.deepEqual(messages,['denied']);
});
