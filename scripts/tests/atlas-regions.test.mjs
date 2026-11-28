import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {layoutRegionLabels,regionVisibleOnFloor,validateRegionSettings} from '../../site/atlas-region-labels.js';

const read=name=>JSON.parse(fs.readFileSync(new URL('../../'+name,import.meta.url)));
const factory=read('site/data/factory-regions.json'),streets=read('site/data/streets-regions.json');
const source=read('data/regions/tarkov-dev-maps.json');
const settings={areas:true,roads:true};
function camera(){
  const c=new THREE.OrthographicCamera(-50,50,50,-50,.1,1000);
  c.position.set(0,100,0);c.up.set(0,0,-1);c.lookAt(0,0,0);c.updateMatrixWorld();return c;
}
const label=(id,x,z,priority=2)=>({id,name:id,kind:'area',position:{x,y:0,z},priority,width:80,height:22});
const options=c=>({camera:c,width:1000,height:1000,settings});

test('every curated name retains its source Unity X/Z anchor and provenance',()=>{
  for(const [data,name,count] of [[factory,'factory',27],[streets,'streets-of-tarkov',46]]){
    const labels=source.find(m=>m.normalizedName===name).maps.find(m=>m.projection==='interactive').labels;
    assert.equal(data.labels.length,count);assert.equal(new Set(data.labels.map(l=>l.id)).size,count);
    assert.match(data.source.snapshotSha256,/^[a-f0-9]{64}$/);
    data.labels.forEach((l,i)=>{
      assert.equal(l.en,labels[i].text);assert.equal(l.position.x,labels[i].position[0]);assert.equal(l.position.z,labels[i].position[1]);
      assert.ok(l.name);assert.ok(Number.isFinite(l.position.y));assert.ok(Math.abs(l.position.y)<20,'unbounded floor ranges must not become actual label heights');
    });
  }
  assert.equal(streets.labels.filter(l=>l.kind==='road').length,13);
  assert.deepEqual(streets.labels.find(l=>l.en==='Lexos').position,{x:66,y:3,z:305});
  assert.deepEqual(factory.labels.find(l=>l.en==='Office Building').position,{x:21,y:1,z:39});
});

test('factory floor labels follow floor selection, all mode and custom clipping',()=>{
  const office=factory.labels.find(l=>l.en==='Main Office'),locker=factory.labels.find(l=>l.en==='Locker Rooms');
  const basement=factory.labels.find(l=>l.en==='Underground Stash'),building=factory.labels.find(l=>l.en==='Office Building');
  assert.equal(regionVisibleOnFloor(office,'ground',-.75,3.25),false);
  assert.equal(regionVisibleOnFloor(office,'office',6.75,40),true);
  assert.equal(regionVisibleOnFloor(office,'office',6.75,7),false);
  assert.equal(regionVisibleOnFloor(locker,'upper',3.25,6.75),true);
  assert.equal(regionVisibleOnFloor(locker,'office',6.75,40),false);
  assert.equal(regionVisibleOnFloor(basement,'underground',-20,-.75),true);
  assert.equal(regionVisibleOnFloor(building,'underground',-20,-.75),false);
  assert.equal(regionVisibleOnFloor(office,'all',-20,40),true);
  assert.equal(regionVisibleOnFloor(basement,'all',-20,40),true);
});

test('names share model handedness; rotation moves anchors but label boxes stay upright',()=>{
  const c=camera(),p=label('asymmetric',10,20);
  const [a]=layoutRegionLabels([p],options(c));
  assert.ok(Math.abs(a.x-600)<.001&&Math.abs(a.y-300)<.001);
  c.up.set(0,0,1);c.lookAt(0,0,0);
  const [b]=layoutRegionLabels([p],options(c));
  assert.ok(Math.abs(b.x-400)<.001&&Math.abs(b.y-700)<.001);
  assert.equal(b.right-b.left,80);assert.equal(b.bottom-b.top,22);
});

test('close labels declutter by importance, with additional names appearing after zoom',()=>{
  const c=camera(),labels=[label('minor',0,0,1),label('major',4,0,4)];
  assert.deepEqual(layoutRegionLabels(labels,options(c)).map(p=>p.label.id),['major']);
  c.zoom=3;c.updateProjectionMatrix();
  assert.equal(layoutRegionLabels(labels,options(c)).length,2);
  assert.equal(layoutRegionLabels([label('offscreen',1000,0)],options(c)).length,0);
});

test('zooming into the factory office reveals rooms instead of their overlapping building caption',()=>{
  const c=camera();c.zoom=2;c.updateProjectionMatrix();
  const room={...label('room',0,0),kind:'room',floor:'office',position:{x:0,y:7.5,z:0}};
  const building={...label('building',0,0,4),overviewFor:['upper','office']};
  const placed=layoutRegionLabels([building,room],{...options(c),band:'office',low:6.75,high:40});
  assert.deepEqual(placed.map(p=>p.label.id),['room']);
  assert.deepEqual(layoutRegionLabels([room,{...building,id:'stairs',overviewFor:[],priority:3}],{...options(c),band:'office',low:6.75,high:40}).map(p=>p.label.id),['room']);
});

test('first person hides behind-camera, distant and other-floor room labels',()=>{
  const c=new THREE.PerspectiveCamera(65,1,.1,1000);c.position.set(0,2,0);c.lookAt(0,2,-10);
  const input=[label('near',0,20),label('behind',0,-20),label('far',0,200),{...label('upstairs',0,20),floor:'office',position:{x:0,y:7.5,z:20}}];
  assert.deepEqual(layoutRegionLabels(input,{...options(c),firstPerson:true,distance:100}).map(p=>p.label.id),['near']);
});

test('first person applies the global cut and local floor presets to region labels',()=>{
  const c=new THREE.PerspectiveCamera(65,1,.1,1000);
  c.position.set(0,4,0);c.lookAt(0,4,-10);
  const lower={...label('lower',-5,20),kind:'room',floor:'ground'};
  const upper={...label('upper',5,20),kind:'room',floor:'upper',position:{x:5,y:4,z:20}};
  const view={...options(c),firstPerson:true,low:-5,high:10,distance:100};
  const visible=overrides=>layoutRegionLabels([lower,upper],{...view,...overrides}).map(p=>p.label.id).sort();
  assert.deepEqual(visible({}),['lower','upper']);
  assert.deepEqual(visible({high:3}),['lower']);
  assert.deepEqual(visible({heightAt:({x},high)=>x>0?3:high}),['lower']);
});

test('area and road switches are independent and untrusted saved settings default off',()=>{
  for(const saved of [null,[],1,'yes',{areas:'false',roads:1}])assert.deepEqual(validateRegionSettings(saved),{areas:false,roads:false,arrivals:true});
  assert.deepEqual(validateRegionSettings({areas:true,roads:false,arrivals:false}),{areas:true,roads:false,arrivals:false});
  const labels=[label('building',-20,0),{...label('street',20,0),kind:'road'}];
  const o=options(camera());
  assert.deepEqual(layoutRegionLabels(labels,{...o,settings:{areas:false,roads:true}}).map(p=>p.label.id),['street']);
  assert.equal(layoutRegionLabels(labels,{...o,settings:{areas:false,roads:false}}).length,0);
});
