import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pointTypeKeys,matchesPointTypes,buildPointTypes} from '../../site/atlas-point-types.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url)));
const source=read('data/spt-source.json');
const templates=read(`${source.databasePath}/templates/items.json`);
const documents=Object.values(templates).filter(item=>item._parent==='6a28212a0368f4438b0d0a45').map(item=>item._id);
const seasonKey='loose:season_document';
const loose=candidates=>({kind:'loose',candidates});

test('every active BattlePassDocument has its own filter type, independent of localized names and baked families',()=>{
  assert.equal(documents.length,9);
  for(const tpl of documents){
    const data={items:{[tpl]:{zh:'renamed',markerFamily:'other'}}};
    const keys=pointTypeKeys(loose([{tpl,weight:1}]),data);
    assert.deepEqual(keys,[seasonKey],tpl);
    assert.equal(matchesPointTypes(keys,new Set([seasonKey])),true);
    assert.equal(matchesPointTypes(keys,new Set(['loose:other'])),false);
  }
});

test('ordinary intelligence, quest documents and document cases do not become season documents',()=>{
  for(const [tpl,family] of [['590c60fc86f77412b13fddcf','equipment'],['689b51de2c175da5bf083b9f','intel'],['61a00bcb177fb945751bbe6a','intel'],['60915994c49cf53e4772cc38','intel']]){
    const data={items:{[tpl]:{zh:'赛季文件',markerFamily:'intel'}}};
    assert.deepEqual(pointTypeKeys(loose([{tpl}]),data),['loose:'+family],tpl);
  }
});

test('season document filtering uses eligible roots, keeps mixed candidates and leaves container types intact',()=>{
  const tpl=documents[0],data={items:{[tpl]:{markerFamily:'other'},ammo:{markerFamily:'ammo'}}};
  const mixed=loose([{tpl:'ammo',weight:3},{tpl,weight:null},{tpl,weight:1}]);
  assert.deepEqual(pointTypeKeys(mixed,data),['loose:ammo',seasonKey]);
  assert.equal(matchesPointTypes(pointTypeKeys(mixed,data),new Set([seasonKey])),true);
  for(const weight of [0,-1])assert.deepEqual(pointTypeKeys(loose([{tpl,weight},{tpl:'ammo',weight:1,included:[{tpl}]}]),data),['loose:ammo']);
  assert.deepEqual(pointTypeKeys({kind:'container',containerTpl:'safe',candidates:[{tpl}],forcedItems:[{tpl}]},data),['container:safe']);
  assert.deepEqual(pointTypeKeys({kind:'poi',quest:true,poiTypes:['quest_item'],itemId:tpl,questObjectives:[{questId:'q',objectiveId:'find'}]},data),['quest:q:find']);
});

test('all thirteen maps expose exactly their located season candidates and exclude them from other-only filters',()=>{
  const expected={customs:30,factory:30,ground_zero:30,icebreaker:0,interchange:31,labs:36,labyrinth:30,lighthouse:32,reserve:32,shoreline:30,streets:30,terminal:0,woods:30};
  let total=0;
  for(const [map,count] of Object.entries(expected)){
    const data=read(`site/data/${map}-atlas.json`),taxonomy=buildPointTypes(data);
    const actual=data.points.filter(p=>p.kind==='loose'&&p.position&&!p.outsideClientEnvelope&&(p.candidates||[]).some(c=>documents.includes(c.tpl)&&(c.weight==null||c.weight>0)));
    assert.equal(actual.length,count,map);
    const type=taxonomy.types.find(t=>t.key===seasonKey);
    assert.equal(type?.count||0,count,map);
    if(count){assert.equal(type.label,'赛季文件');assert.equal(type.group,'loose');}
    for(const point of data.points){
      const keys=taxonomy.members.get(point.id);
      assert.equal(keys.includes(seasonKey),point.kind==='loose'&&(point.candidates||[]).some(c=>documents.includes(c.tpl)&&(c.weight==null||c.weight>0)),`${map}: ${point.id}`);
    }
    for(const point of actual)assert.equal(matchesPointTypes(taxonomy.members.get(point.id),new Set(['loose:other'])),false,`${map}: ${point.id}`);
    total+=count;
  }
  assert.equal(total,341);
});
