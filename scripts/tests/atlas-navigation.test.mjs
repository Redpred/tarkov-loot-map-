import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {rebaseOrbitPivot,selectSectors,sectorDistance,firstPersonEntryPosition,createSceneOverview} from '../../site/atlas-navigation.js';
import {volumeDisplayPosition} from '../../site/atlas-volumes.js';
import {validateViewSettings} from '../../site/atlas-view-settings.js';
import {SceneCollision} from '../../site/atlas-collision.js';
import {createFirstPerson} from '../../site/atlas-first-person.js';

test('first-person entry stays at the visible volume slice and preserves source coordinates',()=>{
  const point={position:{x:2,y:45.7,z:3},volumes:[{polygon:[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}],minY:0,maxY:60}]},before=structuredClone(point.position);
  assert.equal(point.position.y,45.7);
  const low=5.7,high=13.7,anchor=volumeDisplayPosition(point,low,high);
  const entry=firstPersonEntryPosition({point,low,high,surface:()=>{throw new Error('an explicit area must keep its selected slice');}});
  assert.deepEqual(entry.toArray(),[anchor.x,13.7,-anchor.z]);
  assert.deepEqual(point.position,before);
  assert.equal(firstPersonEntryPosition({point,low,high:18.7}).y,18.7,'a height change after focusing resolves the current slice');
  assert.equal(firstPersonEntryPosition({point,low,high:90}).y,45.7,'all-height entry keeps the real source anchor');
});

test('zoomed orthographic rotation uses the observed surface without a reframe or scale change',()=>{
  const camera=new THREE.OrthographicCamera(-50,50,50,-50,.1,2000);camera.zoom=12;camera.position.set(90,100,90);
  const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
  controls.update();camera.updateProjectionMatrix();
  const dir=camera.getWorldDirection(new THREE.Vector3()),pivot=controls.target.clone().addScaledVector(dir,-7);
  const sample=new THREE.Vector3(1,2,3),before=sample.clone().project(camera);
  rebaseOrbitPivot(camera,controls,pivot);const after=sample.clone().project(camera);
  assert.ok(Math.abs(before.x-after.x)<1e-9&&Math.abs(before.y-after.y)<1e-9);assert.equal(camera.zoom,12);
  const offset=camera.position.clone().sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),.5);camera.position.copy(pivot).add(offset);controls.update();
  const projected=pivot.clone().project(camera);assert.ok(Math.hypot(projected.x,projected.y)<1e-9);
});

test('the scene overview keeps the whole model inside the viewport and depth range',()=>{
  const bounds={min:[-408,-13,-322],max:[475,87,599]},overview=createSceneOverview(bounds);
  assert.deepEqual(overview.center.toArray(),[33.5,37,-138.5]);
  for(const aspect of [16/9,390/790]){
    for(const [pitch,heading] of [[.00001,Math.PI],[.85,.4],[Math.PI/2-.02,1.5]]){
      const camera=new THREE.OrthographicCamera(-120*aspect,120*aspect,120,-120,.1,2000);
      camera.position.copy(overview.center).add(new THREE.Vector3().setFromSphericalCoords(overview.distance,pitch,heading));
      camera.lookAt(overview.center);camera.zoom=overview.zoom(camera);
      camera.updateProjectionMatrix();camera.updateMatrixWorld();
      for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]]){
        const point=new THREE.Vector3(x,y,-z).project(camera);
        assert.ok(Math.max(Math.abs(point.x),Math.abs(point.y))<.91);
        assert.ok(Math.abs(point.z)<1);
      }
    }
  }
});

test('full mode selects every sector; radius, view and first-person near coverage differ',()=>{
  const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.set(0,2,0);camera.lookAt(0,2,-10);camera.updateMatrixWorld();
  const clip={low:{value:-1},high:{value:4}},settings={mode:'all',distance:50};
  const sector=(id,x,z,y=0)=>({id,bounds:{min:[x,y,z],max:[x+1,y+1,z+1]}});
  const front=sector('front',0,10),back=sector('back',0,-10),far=sector('far',100,100),upper=sector('upper',0,12,8);
  const m={sectors:[front,back,far,upper]};
  assert.equal(selectSectors(m,camera,camera.position,clip,settings).length,m.sectors.length);
  assert.deepEqual(selectSectors(m,camera,camera.position,clip,{mode:'view',distance:50}).map(s=>s.id),['front']);
  assert.equal(selectSectors(m,camera,camera.position,clip,{mode:'radius',distance:50}).length,2);
  assert.equal(selectSectors(m,camera,camera.position,clip,{mode:'view',distance:50,nearRadius:24}).length,2);
  assert.ok(sectorDistance(far,camera.position)>50);
});

test('view settings clamp invalid values and persist map-specific choices',()=>{
  const settings=validateViewSettings({mode:'all',distance:9000,rotationSpeed:NaN,retain:true,fov:-2});
  assert.equal(settings.mode,'all');assert.equal(settings.distance,1500);assert.equal(settings.rotationSpeed,.55);assert.equal(settings.fov,45);
  assert.deepEqual(validateViewSettings(JSON.parse(JSON.stringify(settings))),settings);
});

function group(geometry,x=0,y=0,z=0){
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const matrix=new THREE.Matrix4().makeTranslation(x,y,-z),box=geometry.boundingBox.clone().applyMatrix4(matrix);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  return {mesh,instances:1,matrices:new Float32Array([1,0,0,x,0,1,0,y,0,0,1,-z]),boxes:new Float32Array([...box.min.toArray(),...box.max.toArray()])};
}
test('ray narrow phase does not treat an entire room bounds as a solid and respects Unity Z',()=>{
  const world=new SceneCollision(),walls=group(new THREE.BoxGeometry(.2,3,5),0,1.5,9);world.add([walls]);
  const hit=world.cast(new THREE.Vector3(2,1,9),new THREE.Vector3(-1,0,0),3);
  assert.ok(hit&&Math.abs(hit.point.x-.1)<.001);
  assert.equal(world.cast(new THREE.Vector3(2,1,-9),new THREE.Vector3(-1,0,0),3),null);
});

test('first-person short key taps move and turn; re-entering never duplicates the animation loop',()=>{
  const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  let counter=0;const frames=new Map(),canvas=new EventTarget(),win=new EventTarget(),doc=new EventTarget();
  canvas.focus=()=>{doc.activeElement=canvas;};doc.querySelector=()=>null;
  Object.assign(globalThis,{window:win,document:doc,requestAnimationFrame:cb=>{frames.set(++counter,cb);return counter;},cancelAnimationFrame:id=>frames.delete(id)});
  const tap=code=>{for(const type of ['keydown','keyup'])win.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code,repeat:false}));};
  let time=performance.now();const tick=()=>{const callbacks=[...frames.values()];frames.clear();for(const cb of callbacks)cb(time+=20);};
  try{
    const fp=createFirstPerson({canvas,settings:validateViewSettings(),onChange(){},onNotice(){}});
    fp.enter(new THREE.Vector3(0,1,0));const before=fp.camera.position.clone();
    tap('KeyW');tap('KeyE');tick();assert.ok(fp.camera.position.z<before.z&&fp.camera.position.y>before.y);
    const height=fp.camera.position.y;
    tap('Space');tick();assert.ok(fp.camera.position.y>height);
    tap('ControlLeft');tick();assert.ok(Math.abs(fp.camera.position.y-height)<1e-9);
    tap('Space');tap('KeyE');tap('KeyQ');tick();assert.ok(Math.abs(fp.camera.position.y-height)<1e-9);
    tap('ControlRight');tick();assert.ok(Math.abs(fp.camera.position.y-height)<1e-9);
    tap('ArrowRight');tick();assert.ok(fp.camera.quaternion.y<0);
    const stopped=fp.camera.position.clone();fp.enter();assert.equal(frames.size,1);tick();assert.ok(fp.camera.position.equals(stopped));
    const retainedPosition=fp.camera.position.clone(),retainedRotation=fp.camera.quaternion.clone();
    tap('KeyW');fp.setSuspended(true);assert.equal(frames.size,0);assert.equal(fp.mode,'fly');
    tap('KeyW');tick();assert.ok(fp.camera.position.equals(retainedPosition));
    fp.setSuspended(false);assert.equal(frames.size,1);tick();assert.ok(fp.camera.position.equals(retainedPosition));
    assert.ok(fp.camera.quaternion.equals(retainedRotation));
    fp.exit();assert.equal(frames.size,0);
    fp.enter(new THREE.Vector3());assert.equal(frames.size,1);fp.exit();
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('first-person left drag turns, tiny clicks still select, and releasing or cancelling ends the gesture',()=>{
  const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const canvas=new EventTarget(),win=new EventTarget(),doc=new EventTarget(),captured=new Set();
  canvas.focus=()=>{doc.activeElement=canvas;};doc.querySelector=()=>null;
  canvas.setPointerCapture=id=>captured.add(id);canvas.hasPointerCapture=id=>captured.has(id);canvas.releasePointerCapture=id=>captured.delete(id);
  Object.assign(globalThis,{window:win,document:doc,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
  const fire=(type,props={})=>{const e=Object.assign(new Event(type,{cancelable:true}),{pointerId:1,button:0,clientX:100,clientY:100,...props});canvas.dispatchEvent(e);return e;};
  try{
    const fp=createFirstPerson({canvas,settings:validateViewSettings(),onChange(){},onNotice(){}});
    fp.enter(new THREE.Vector3());const start=fp.camera.quaternion.clone();
    fire('pointerdown');fire('pointermove',{clientX:102});fire('pointerup',{clientX:102});
    assert.ok(fp.camera.quaternion.equals(start));assert.equal(fp.lookDragged,false);
    fire('pointerdown');fire('pointermove',{clientX:130});assert.ok(!fp.camera.quaternion.equals(start));assert.ok(captured.has(1));
    fire('pointermove');fire('pointerup');assert.equal(fp.lookDragged,true,'returning to the starting pixel must not become a point click');assert.equal(captured.size,0);
    const released=fp.camera.quaternion.clone();fire('pointermove',{clientX:160});assert.ok(fp.camera.quaternion.equals(released));
    fire('pointerdown',{button:2});fire('pointermove',{clientX:160});fire('pointerup',{button:2});assert.ok(fp.camera.quaternion.equals(released));
    assert.ok(fire('contextmenu',{button:2}).defaultPrevented);
    fire('pointerdown');fire('pointerup');assert.equal(fp.lookDragged,false,'a fresh click can select after a drag');
    fire('pointerdown');fire('pointermove',{clientX:130});fire('pointercancel');assert.equal(captured.size,0);
    fire('pointerdown');win.dispatchEvent(new Event('blur'));assert.equal(captured.size,0);
    doc.pointerLockElement=canvas;fire('pointerdown');fire('pointermove',{movementX:30,movementY:0});fire('pointerup');assert.equal(fp.lookDragged,false);assert.ok(!fp.camera.quaternion.equals(released));
    doc.pointerLockElement=null;fp.exit();assert.equal(captured.size,0);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('saved movement speed migrates to flight speed and the new preference takes precedence',()=>{
  const old={walkSpeed:7};
  assert.equal(validateViewSettings(old).flySpeed,7);assert.deepEqual(old,{walkSpeed:7});
  assert.equal(validateViewSettings({walkSpeed:7,flySpeed:12}).flySpeed,12);
  assert.equal(validateViewSettings({walkSpeed:40}).flySpeed,20);
  assert.equal(validateViewSettings({walkSpeed:NaN}).flySpeed,3);
  assert.equal('walkSpeed' in validateViewSettings(old),false);
});
