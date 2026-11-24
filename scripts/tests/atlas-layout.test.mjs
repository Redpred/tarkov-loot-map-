import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFirstPersonDetailsWheel} from '../../site/atlas-layout.js';

function wheel(surface,deltaY,deltaMode=0,ctrlKey=false){
  const event=Object.assign(new Event('wheel',{cancelable:true}),{deltaY,deltaMode,ctrlKey});
  surface.dispatchEvent(event);return event;
}

test('first-person wheel scrolls details in pixels, lines and pages, respecting both ends',()=>{
  const surface=new EventTarget(),details={hidden:false,clientHeight:400,scrollHeight:2000,scrollTop:0};
  const unbind=bindFirstPersonDetailsWheel({surface,details,isActive:()=>true});
  assert.equal(wheel(surface,120).defaultPrevented,true);assert.equal(details.scrollTop,120);
  wheel(surface,3,1);assert.equal(details.scrollTop,168);
  wheel(surface,1,2);assert.equal(details.scrollTop,568);
  wheel(surface,10000);assert.equal(details.scrollTop,1600);
  wheel(surface,-10000);assert.equal(details.scrollTop,0);
  unbind();assert.equal(wheel(surface,120).defaultPrevented,false);assert.equal(details.scrollTop,0);
});

test('ordinary map zoom, closed details, browser zoom and horizontal wheel are left untouched',()=>{
  const surface=new EventTarget(),details={hidden:false,clientHeight:400,scrollHeight:2000,scrollTop:100};let active=false;
  bindFirstPersonDetailsWheel({surface,details,isActive:()=>active});
  assert.equal(wheel(surface,120).defaultPrevented,false);assert.equal(details.scrollTop,100);
  active=true;details.hidden=true;assert.equal(wheel(surface,120).defaultPrevented,false);assert.equal(details.scrollTop,100);
  details.hidden=false;assert.equal(wheel(surface,120,0,true).defaultPrevented,false);
  assert.equal(wheel(surface,0).defaultPrevented,false);assert.equal(details.scrollTop,100);
  details.scrollHeight=200;wheel(surface,120);assert.equal(details.scrollTop,0);
});
