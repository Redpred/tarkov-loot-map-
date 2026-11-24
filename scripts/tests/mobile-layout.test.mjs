import test from 'node:test';
import assert from 'node:assert/strict';
import {createFloatingLayout,bindVisualViewport,bindCompactHeader} from '../../site/atlas-layout.js';

function node(){
  const classes=new Set(),attributes=new Map();
  return {hidden:false,textContent:'',classList:{contains:name=>classes.has(name),toggle(name,active){if(active)classes.add(name);else classes.delete(name);},remove:name=>classes.delete(name)},
    setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),contains(value){return value?.parent===this;}};
}
function environment(run){
  const keys=['window','document','localStorage','requestAnimationFrame'],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  const document=new EventTarget(),window=new EventTarget(),media=new EventTarget(),storage=new Map(),styles=new Map();
  const elements=Object.fromEntries(['leftPanel','rightPanel','leftPanelToggle','rightPanelToggle','filterBody','details','mapNavigator','toggleNavigator'].map(id=>[id,node()]));
  document.body=node();document.body.style={setProperty:(key,value)=>styles.set(key,value)};
  document.activeElement={matches:()=>false};document.querySelector=()=>null;document.querySelectorAll=()=>[];document.getElementById=id=>elements[id];
  window.matchMedia=()=>media;window.innerHeight=844;
  Object.assign(globalThis,{window,document,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:fn=>fn()});
  try{run({document,window,media,storage,styles,elements});}
  finally{for(const key of keys)if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}
}

test('phone panels are exclusive and closing them does not overwrite desktop preferences',()=>environment(({document,media,storage,elements})=>{
  media.matches=true;storage.set('factory-layout-v1',JSON.stringify({left:true,right:true,navigator:true}));
  const layout=createFloatingLayout('factory'),original=storage.get('factory-layout-v1');
  assert.equal(elements.filterBody.hidden,true);assert.equal(elements.details.hidden,true);
  assert.equal(elements.toggleNavigator.getAttribute('aria-expanded'),'false');
  layout.openFilters();assert.equal(elements.filterBody.hidden,false);
  let blurred=false;document.activeElement={parent:elements.filterBody,blur(){blurred=true;}};
  layout.openDetails();assert.equal(elements.filterBody.hidden,true);assert.equal(elements.details.hidden,false);assert.equal(blurred,true);
  layout.closeDetails();elements.toggleNavigator.onclick();
  assert.equal(storage.get('factory-layout-v1'),original);
  media.matches=false;media.dispatchEvent(Object.assign(new Event('change'),{matches:false}));
  assert.equal(elements.filterBody.hidden,false);assert.equal(elements.details.hidden,true);
  assert.equal(elements.toggleNavigator.getAttribute('aria-expanded'),'true');
  media.matches=true;media.dispatchEvent(Object.assign(new Event('change'),{matches:true}));
  assert.equal(elements.filterBody.hidden,true);assert.equal(elements.toggleNavigator.getAttribute('aria-expanded'),'false');
}));

test('Escape closes compact panels but does not close a panel behind an open dialog',()=>environment(({document,media,elements})=>{
  media.matches=true;const layout=createFloatingLayout('labs');layout.openFilters();
  document.querySelector=()=>({open:true});document.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));
  assert.equal(elements.filterBody.hidden,false);
  document.querySelector=()=>null;document.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));
  assert.equal(elements.filterBody.hidden,true);
}));

test('keyboard inset follows visual viewport, clears after blur, and ignores browser pinch zoom',()=>environment(({document,window,styles})=>{
  const viewport=new EventTarget();Object.assign(viewport,{height:844,offsetTop:0,scale:1});window.visualViewport=viewport;
  bindVisualViewport();assert.equal(document.body.classList.contains('keyboard-open'),false);
  document.activeElement={matches:()=>true};viewport.height=470;viewport.offsetTop=20;viewport.dispatchEvent(new Event('resize'));
  assert.equal(document.body.classList.contains('keyboard-open'),true);assert.equal(styles.get('--keyboard-inset'),'354px');
  assert.equal(styles.get('--visual-height'),'470px');assert.equal(styles.get('--visual-top'),'20px');
  document.activeElement={matches:()=>false};document.dispatchEvent(new Event('focusout'));
  assert.equal(document.body.classList.contains('keyboard-open'),false);assert.equal(styles.get('--keyboard-inset'),'0px');
  document.activeElement={matches:()=>true};viewport.scale=2;viewport.dispatchEvent(new Event('resize'));
  assert.equal(document.body.classList.contains('keyboard-open'),false);
}));

test('viewport fallback follows browser chrome, orientation and fullscreen without requiring visualViewport',()=>environment(({document,window,styles})=>{
  bindVisualViewport();assert.equal(styles.get('--app-height'),'844px');
  window.innerHeight=390;window.dispatchEvent(new Event('resize'));assert.equal(styles.get('--app-height'),'390px');
  window.innerHeight=430;document.dispatchEvent(new Event('fullscreenchange'));assert.equal(styles.get('--app-height'),'430px');
  window.innerHeight=390;document.dispatchEvent(new Event('webkitfullscreenchange'));assert.equal(styles.get('--app-height'),'390px');
}));

test('phone header collapse is remembered, restores hidden focus, and never hides desktop navigation',()=>environment(({document,media,storage})=>{
  const header=node(),button=Object.assign(new EventTarget(),node());let focused=false;
  button.focus=()=>{focused=true;document.activeElement=button;};media.matches=true;
  bindCompactHeader({header,button,compact:media,storage:localStorage});
  assert.equal(header.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');
  document.activeElement={parent:header};button.dispatchEvent(new Event('click'));
  assert.equal(header.hidden,true);assert.equal(header.inert,true);assert.equal(focused,true);
  assert.equal(button.getAttribute('aria-label'),'展开顶栏');assert.equal(storage.get('atlas-mobile-header-collapsed-v1'),'true');
  media.matches=false;media.dispatchEvent(new Event('change'));
  assert.equal(header.hidden,false);assert.equal(header.inert,false);assert.equal(button.hidden,true);
  assert.equal(document.body.classList.contains('mobile-header-collapsed'),false);
  media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(header.hidden,true);
  button.dispatchEvent(new Event('click'));assert.equal(header.hidden,false);assert.equal(storage.get('atlas-mobile-header-collapsed-v1'),'false');
}));

test('phone header can expand a saved collapsed choice when preference storage becomes unavailable',()=>environment(({media,storage})=>{
  const header=node(),button=Object.assign(new EventTarget(),node());button.focus=()=>{};media.matches=true;
  storage.set('atlas-mobile-header-collapsed-v1','true');
  bindCompactHeader({header,button,compact:media,storage:{getItem:()=>storage.get('atlas-mobile-header-collapsed-v1'),setItem(){throw Error('disabled');}}});
  assert.equal(header.hidden,true);button.dispatchEvent(new Event('click'));assert.equal(header.hidden,false);
}));
