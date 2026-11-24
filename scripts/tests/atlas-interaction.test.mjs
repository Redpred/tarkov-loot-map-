import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMapInteractionGuards} from '../../site/atlas-interaction.js';

const target=(control,editable=false)=>({closest:selector=>(selector.startsWith('input,')?editable:control)?{}:null});
function dispatch(root,type,node){
  const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:node});root.dispatchEvent(event);return event;
}
test('long-press selection, context menus and native drag are cancelled on map controls and their text nodes',()=>{
  const root=new EventTarget();bindMapInteractionGuards(root);
  for(const type of ['selectstart','contextmenu','dragstart']){
    assert.equal(dispatch(root,type,target(true)).defaultPrevented,true);
    assert.equal(dispatch(root,type,{parentElement:target(true)}).defaultPrevented,true);
  }
});
test('fields, links, ordinary detail text, scrolling and pointer gestures retain native behavior',()=>{
  const root=new EventTarget();bindMapInteractionGuards(root);
  for(const type of ['selectstart','contextmenu','dragstart']){
    assert.equal(dispatch(root,type,target(true,true)).defaultPrevented,false);
    assert.equal(dispatch(root,type,target(false)).defaultPrevented,false);
  }
  for(const type of ['touchstart','touchmove','pointerdown','click'])assert.equal(dispatch(root,type,target(true)).defaultPrevented,false);
});
