import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {LOOT_CATEGORIES,LEGACY_LOOT_FAMILIES} from '../../site/atlas-loot-category-policy.js';
import {ITEM_LOOT_FAMILIES,LOOT_CATEGORY_SOURCE} from '../../site/data/loot-categories.js';
import {looseMarkerFamily,classifyPointMarker} from '../../site/factory-marker-rules.js';
import {pointTypeKeys,matchesPointTypes,buildPointTypes} from '../../site/atlas-point-types.js';
import {mergeMapData} from '../../site/atlas-runtime.js';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url)));
const loose=(...tpls)=>({kind:'loose',candidates:tpls.map(tpl=>({tpl,weight:1}))});

test('the nineteen agreed categories have no mixed or retired subcategories',()=>{
  assert.deepEqual(Object.values(LOOT_CATEGORIES).map(([label])=>label),['能源物品','易燃物品','建筑材料','电子产品','日常用品','医疗物资','注射器','钥匙','钥匙卡','工具','贵重物品','武器及配件','装备','弹药','饮食','情报文件','货币','赛季文件','其他']);
  for(const legacy of Object.keys(LEGACY_LOOT_FAMILIES))assert.equal(Object.hasOwn(LOOT_CATEGORIES,legacy),false);
});

test('derived classifications match the active project source and verified input hashes',()=>{
  const source=read('data/spt-source.json');
  assert.equal(LOOT_CATEGORY_SOURCE.commit,source.commit);
  assert.equal(LOOT_CATEGORY_SOURCE.eftBuild,source.eftBuild);
  for(const input of LOOT_CATEGORY_SOURCE.inputs){
    const actual=createHash('sha256').update(fs.readFileSync(new URL('../../'+input.file,import.meta.url))).digest('hex');
    assert.equal(actual,input.sha256,input.file);
  }
  const templates=read(source.databasePath+'/templates/items.json');
  assert.equal(Object.keys(ITEM_LOOT_FAMILIES).length,Object.values(templates).filter(item=>item._type==='Item').length);
  for(const family of Object.values(ITEM_LOOT_FAMILIES))assert.ok(Object.hasOwn(LOOT_CATEGORIES,family));
});

test('real incorrectly baked templates follow the handbook, independent of Chinese names',()=>{
  const expected={
    '57347b8b24597737dd42e192':'fuel', // Matches, previously industrial.
    '590c5bbd86f774785762df04':'fuel', // WD-40.
    '590c5a7286f7747884343aea':'fuel', // Gunpowder, previously other.
    '5d1b371186f774253763a656':'fuel',
    '544fb3f34bdc2d03748b456a':'stim', // Morphine, previously meds.
    '5d1b3f2d86f774253763b735':'medical', // Empty syringe is a barter supply.
    '5d235b4d86f7742e017bc88a':'valuable', // GP coin, previously money.
    '5bc9c377d4351e3bac12251b':'valuable', // Antique firesteel, previously tools.
    '60b0f7057897d47c5b04ab94':'valuable',
    '590c60fc86f77412b13fddcf':'equipment', // Document case.
    '689b51de2c175da5bf083b9f':'intel', // Notes, previously other.
    '68889451ad1e91bfa40db8fd':'intel', // Tape, previously other.
  };
  for(const [tpl,family] of Object.entries(expected)){
    const data={items:{[tpl]:{zh:'renamed',markerFamily:'other'}}};
    assert.equal(looseMarkerFamily(tpl,data),family,tpl);
    assert.deepEqual(pointTypeKeys(loose(tpl),data),['loose:'+family],tpl);
  }
});

test('merged baked families still work and unrecognized families safely fall back to other',()=>{
  const items=Object.fromEntries(Object.entries(LEGACY_LOOT_FAMILIES).map(([tpl])=>[tpl,{markerFamily:tpl}]));
  for(const [tpl,family] of Object.entries(LEGACY_LOOT_FAMILIES))assert.equal(looseMarkerFamily(tpl,{items}),family);
  for(const family of ['missing','toString','constructor',null,undefined])assert.equal(looseMarkerFamily('missing',{items:{missing:{markerFamily:family}}}),'other');
});

test('mixed markers keep all category memberships without becoming other; single roots retain artwork',()=>{
  const data={items:{batteryA:{markerFamily:'battery'},batteryB:{markerFamily:'battery'},food:{markerFamily:'food'},drink:{markerFamily:'drink'},med:{markerFamily:'medical'},bandage:{markerFamily:'bandage'},stim:{markerFamily:'stim'}}};
  const mixed=loose('batteryA','food');
  assert.deepEqual(pointTypeKeys(mixed,data),['loose:battery','loose:provisions']);
  for(const key of ['loose:battery','loose:provisions'])assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set([key])),true);
  assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set(['loose:other'])),false);
  assert.equal(classifyPointMarker(mixed,data).key,'mixed');
  assert.equal(classifyPointMarker(loose('food','drink'),data).key,'provisions');
  assert.equal(classifyPointMarker(loose('med','bandage'),data).key,'medical');
  assert.equal(classifyPointMarker(loose('med','stim'),data).key,'mixed');
  assert.equal(classifyPointMarker(loose('batteryA'),data,{items:{batteryA:'inventory'}}).key,'inventory');
  assert.deepEqual(pointTypeKeys({kind:'loose',candidates:[{tpl:'food',weight:1,included:[{tpl:'stim'}]},{tpl:'stim',weight:0},{tpl:'batteryA',weight:-1}]},data),['loose:provisions']);
});

test('all maps retain every located loose point and expose only the nineteen category keys',()=>{
  const union=new Set();let located=0;
  for(const map of Object.values(ATLAS_MAPS)){
    const data=mergeMapData(read('site/'+map.data),read(`site/data/${map.id}-pois.json`),read(`site/data/tasks/maps/${map.id}.json`));
    const taxonomy=buildPointTypes(data),expectedCounts=new Map();
    for(const point of data.points){
      if(point.kind==='poi'||point.kind==='container')continue;
      const keys=taxonomy.members.get(point.id);assert.ok(keys.length);
      assert.equal(matchesPointTypes(keys,new Set(Object.keys(LOOT_CATEGORIES).map(f=>'loose:'+f))),true);
      for(const key of keys)assert.ok(Object.hasOwn(LOOT_CATEGORIES,key.slice(6)),`${map.id}: ${key}`);
      if(!point.position||point.outsideClientEnvelope)continue;
      located++;
      for(const key of keys){union.add(key);expectedCounts.set(key,(expectedCounts.get(key)||0)+1);}
      const families=new Set((point.candidates||[]).filter(c=>c.weight==null||c.weight>0).map(c=>looseMarkerFamily(c.tpl,data)));
      if(families.size&&!families.has('other'))assert.equal(keys.includes('loose:other'),false);
      const descriptor=classifyPointMarker(point,data);
      if(families.size>1)assert.equal(descriptor.key,'mixed');
    }
    for(const row of taxonomy.types.filter(t=>t.group==='loose'))assert.equal(row.count,expectedCounts.get(row.key)||0,`${map.id}: ${row.key}`);
  }
  assert.equal(located,30021);
  assert.equal(union.size,19);
});

test('merged SVG aliases preserve existing icon imports while exact inventory mappings remain separate',()=>{
  const manifest=read('site/data/icons/factory/manifest.json');
  for(const [legacy,target] of Object.entries(LEGACY_LOOT_FAMILIES)){
    assert.equal(manifest.entries[legacy].file,manifest.entries[target].file);
    assert.equal(manifest.entries['symbol-'+legacy].file,manifest.entries[target].file);
    assert.match(manifest.entries[legacy].file,/\.svg$/);
  }
  for(const key of Object.values(manifest.items))assert.doesNotMatch(manifest.entries[key].file,/\.svg$/);
});
