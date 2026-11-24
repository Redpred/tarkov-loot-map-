import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAtlasPois} from '../lib/atlas-pois.mjs';
import {pointTypeKeys,matchesPointTypes,buildPointTypes,POI_TYPES} from '../../site/atlas-point-types.js';
import {typeSettingKey,resolveMarker,emptySettings} from '../../site/factory-icon-settings.js';
const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url)));

test('special layers sharing an image can still be customized independently',()=>{
  const gun={kind:'poi',sourceId:'a',position:{x:0,y:0,z:0},poiTypes:['machinegun']},launcher={...gun,sourceId:'b',poiTypes:['grenade_launcher']};
  const base={mode:'poi',key:'map-stationarygun',description:'固定武器'},settings=emptySettings(),entries={'map-stationarygun':{},custom:{name:'custom'}};
  settings.types[typeSettingKey(gun,base)]='custom';
  assert.equal(resolveMarker(gun,base,settings,entries).key,'custom');assert.equal(resolveMarker(launcher,base,settings,entries).key,'map-stationarygun');
});

test('multi-select uses any eligible loose root family, preserves containers and ignores zero-weight attachments',()=>{
  const data={items:{a:{markerFamily:'ammo'},b:{markerFamily:'medical'},c:{markerFamily:'key'}},points:[]};
  const mixed={kind:'loose',candidates:[{tpl:'a',weight:2},{tpl:'b',weight:null},{tpl:'c',weight:0}]};
  assert.deepEqual(pointTypeKeys(mixed,data),['loose:ammo','loose:medical']);
  assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set(['loose:ammo'])),true);
  assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set(['loose:key'])),false);
  assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set()),false);
  assert.deepEqual(pointTypeKeys({kind:'container',containerTpl:'safe',candidates:mixed.candidates},data),['container:safe']);
  assert.deepEqual(pointTypeKeys({kind:'loose',candidates:[]},data),['loose:other']);
});

test('client POIs exclude disabled objects and unknown category bits; side masks are not guessed from scene names',()=>{
  const make=(id,side,categories,extra={})=>({id,pos:[10,2,30],name:'PMCspawn',side,categories,active:true,...extra});
  const data=buildAtlasPois({spawn_points:[make('all','all',['player']),make('ai','savage',['bot']),make('unknown','pmc',['bit8','bit32']),make('off','all',['player'],{active:false})]},{});
  assert.equal(data.points.length,2);assert.equal(data.skipped.unknownSpawnMask,1);assert.equal(data.skipped.inactive,1);
  assert.deepEqual(data.points[0].position,{x:-10,y:2,z:30});
  assert.deepEqual(data.points[0].poiTypes,['spawn_pmc','spawn_scav']);assert.deepEqual(data.points[1].poiTypes,['scav_ai']);
});

test('door key association and area outlines retain the exact client reference and handedness',()=>{
  const data=buildAtlasPois({doors:[{pos:[9,1,3],kind:'door',state:'locked',key_id:'key',active:true},{pos:[2,1,3],kind:'door',state:'locked',active:true}],exfils:[{name:'Exit',pos:[1,2,3],faction:'secret',outline:[[1,0,2],[3,0,2],[3,0,4]],active:true}]},{},{ch:{'key Name':'测试钥匙'}});
  const door=data.points.find(p=>p.keyId);assert.equal(door.keyId,'key');assert.equal(data.items.key.zh,'测试钥匙');assert.deepEqual(door.position,{x:-9,y:1,z:3});
  assert.equal(data.points.filter(p=>p.poiTypes.includes('locked_door')).length,1);
  assert.ok(data.points.filter(p=>p.poiTypes.includes('locked_door')).every(p=>p.keyId));
  assert.deepEqual(data.points.find(p=>p.faction==='secret').outline[0],{x:-1,y:0,z:2});
});

test('boss configuration requires an exact current-client zone; unrelated AI place names are not treated as spawns',()=>{
  const atlas={bot_zones:[{name:'known',pos:[2,3,4]}],ai_places:[{name:'AIPlace_Kolontay',pos:[10,10,10]}]};
  const data=buildAtlasPois(atlas,{BossLocationSpawn:[{BossName:'bossKolontay',BossZone:'known,missing'},{BossName:'pmcBEAR',BossZone:'known'}]});
  assert.equal(data.points.length,1);assert.equal(data.points[0].zone,'known');assert.equal(data.points[0].outline.length,0);assert.match(data.points[0].note,/不是精确出生坐标/);
});

test('both generated map layers have unique IDs, resolvable icons, valid keys and current-client weapon types',()=>{
  const icons=read('site/data/icons/factory/manifest.json').entries;
  for(const map of ['factory','streets']){
    const data=read(`site/data/${map}-pois.json`);assert.equal(new Set(data.points.map(p=>p.id)).size,data.points.length);
    for(const p of data.points){assert.ok(Object.values(p.position).every(Number.isFinite));assert.ok(icons[p.icon]);assert.ok(p.poiTypes.every(t=>POI_TYPES[t]));if(p.keyId)assert.ok(data.items[p.keyId]);}
    const taxonomy=buildPointTypes(data);assert.ok(taxonomy.types.every(t=>t.group==='poi'));
    if(map==='streets'){assert.equal(data.points.filter(p=>p.poiTypes.includes('machinegun')).length,6);const source=read('work/tarkmap/out/streets/gamedata.json');assert.equal(data.points.filter(p=>p.poiTypes.includes('grenade_launcher')).length,source.stationary.filter(s=>s.active!==false&&s.weapon_id==='5d7296aea4b93651e424b443').length);assert.equal(source.stationary.filter(s=>s.active===false).length,1);assert.ok(data.points.filter(p=>p.poiTypes.includes('boss')).length>=4);}
  }
});
