// Run after restoring the pinned runtime assets; portable tests use synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {firstPersonEntryPosition,selectSectors} from '../../site/atlas-navigation.js';
import {volumeDisplayPosition} from '../../site/atlas-volumes.js';
import {emptySettings,pointSettingKey,validateSettings} from '../../site/factory-icon-settings.js';
import {createPointFilter,pointMatches,candidatesFor} from '../lib/factory-data.mjs';

test('first-person entry stays at the visible Woods keeper5 slice and preserves source coordinates',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../../site/data/tasks/maps/woods.json',import.meta.url)));
  const areas=JSON.parse(fs.readFileSync(new URL('../../site/data/tasks/volumes/woods.json',import.meta.url)));
  const original=data.points.find(point=>point.sourceId==='quest_zone_keeper5'),point={...original,volumes:areas.points[original.id]},before=structuredClone(point.position);
  assert.equal(point.position.y,45.7);
  const low=5.7,high=13.7,anchor=volumeDisplayPosition(point,low,high);
  const entry=firstPersonEntryPosition({point,low,high,surface:()=>{throw new Error('an explicit area must keep its selected slice');}});
  assert.deepEqual(entry.toArray(),[anchor.x,13.7,-anchor.z]);
  assert.deepEqual(point.position,before);
  assert.equal(firstPersonEntryPosition({point,low,high:18.7}).y,18.7,'a height change after focusing resolves the current slice');
  assert.equal(firstPersonEntryPosition({point,low,high:90}).y,45.7,'all-height entry keeps the real source anchor');
});

test('custom icon exports can round-trip overrides for every Streets point',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../../site/data/streets-atlas.json',import.meta.url)));
  const settings=emptySettings();
  for(const point of data.points)settings.points[pointSettingKey(point)]='map-icon';
  const exported=JSON.stringify(settings,null,2);
  assert.ok(Buffer.byteLength(exported)<4*1024*1024);
  assert.deepEqual(validateSettings(JSON.parse(exported),{'map-icon':{}}),settings);
});

test('optimized street search agrees with root, attached, category and scene-ID matching',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../../site/data/streets-atlas.json',import.meta.url)));
  assert.ok(data.points.filter(createPointFilter(data,'显示卡')).length>0);
  for(const [query,category] of [['',''],['显示卡',''],['5d1b36a186f7742523398433',''],['','医疗'],['盒','弹药'],['container_City_SE_02_DesignStuff_00091','']]){
    const match=createPointFilter(data,query,category);
    assert.deepEqual(data.points.filter(match).map(p=>p.id),data.points.filter(p=>pointMatches(p,data,query,category)).map(p=>p.id));
  }
  const forced=data.points.find(p=>p.kind==='container'&&p.forcedItems?.length);
  assert.ok(candidatesFor(forced,data).some(c=>c.forced&&c.weight===null&&c.tpl===forced.forcedItems[0].tpl));
});

test('full mode retains every restored Streets sector',()=>{
 const actual=JSON.parse(fs.readFileSync(new URL('../../site/data/atlas/streets/streets-sectors.json',import.meta.url)));
 const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.updateMatrixWorld();
 assert.ok(actual.sectors.length>0);
 assert.equal(selectSectors(actual,camera,camera.position,{low:{value:-1},high:{value:4}},{mode:'all',distance:50}).length,actual.sectors.length);
});
