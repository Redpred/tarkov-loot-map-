import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { classifyPointMarker, itemMarkerFamily,FAMILIES,SEASON_DOCUMENTS } from '../../site/factory-marker-rules.js';

const data={items:{a:{zh:'急救包',markerFamily:'medical'},b:{markerFamily:'bandage'},c:{markerFamily:'ammo'},d:{markerFamily:'electronics'}}};
const loose=candidates=>({kind:'loose',candidates});

test('same-family roots share a category icon; zero-weight and attached items do not change it',()=>{
  const point=loose([{tpl:'a',weight:1,included:[{tpl:'c'}]},{tpl:'b',weight:2},{tpl:'c',weight:0}]);
  const result=classifyPointMarker(point,data);
  assert.equal(result.key,'medical');assert.equal(result.mode,'category');
  assert.match(result.description,/2 种候选/);
});
test('mixed classes stay mixed regardless of how skewed their raw weights are',()=>{
  const point=loose([{tpl:'a',weight:100000},{tpl:'d',weight:1}]);
  assert.equal(classifyPointMarker(point,data).key,'mixed');
  assert.equal(classifyPointMarker(loose([{tpl:'a',weight:1},{tpl:'missing',weight:null}]),data).key,'mixed');
});
test('only a verified icon mapping and a single unique root produce an exact item icon',()=>{
  const point=loose([{tpl:'a',weight:1},{tpl:'a',weight:2}]);
  assert.equal(classifyPointMarker(point,data).mode,'category');
  const result=classifyPointMarker(point,data,{items:{a:'verified-a'}});
  assert.equal(result.mode,'item');assert.equal(result.key,'verified-a');
  assert.match(result.description,/不代表每局必出/);
});
test('container symbols follow the container type even with an unknown or mixed loot pool',()=>{
  const result=classifyPointMarker({kind:'container',containerTpl:'578f8778245977358849a9b5',pool:null},data);
  assert.equal(result.key,'jacket');assert.equal(result.mode,'container');
  assert.equal(classifyPointMarker({kind:'container',containerTpl:'6ab0ec1bf193bffd360d9d10'},data).key,'map-container_cash-register');
  assert.equal(classifyPointMarker({kind:'container',containerTpl:'658420d8085fea07e674cdb6'},data).key,'body');
});
test('template inheritance chooses the nearest family and terminates on invalid data',()=>{
  const templates={item:{_id:'item',_name:'propital',_parent:'stim'},stim:{_id:'stim',_name:'Stimulator',_parent:'medical'},medical:{_id:'medical',_name:'Medical'},cycle:{_id:'cycle',_parent:'cycle'}};
  assert.equal(itemMarkerFamily('item',templates),'stim');
  assert.equal(itemMarkerFamily('cycle',templates),'other');
  assert.equal(itemMarkerFamily('missing',templates),'other');
});
test('every real point has an intact local icon and a valid atlas rectangle',()=>{
  const root=path.resolve(import.meta.dirname,'../..');
  const load=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
  const data=load('site/data/factory-atlas.json'),icons=load('site/data/icons/factory/manifest.json');
  const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,'site',file))).digest('hex');
  assert.equal(hash(icons.atlas.file),icons.atlas.sha256);
  for(const entry of Object.values(icons.entries)){
    assert.equal(hash(entry.file),entry.sha256);
    const [x,y,w,h]=entry.rect;
    assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=icons.atlas.width&&y+h<=icons.atlas.height);
  }
  for(const p of data.points){const result=classifyPointMarker(p,data,icons);assert.ok(icons.entries[result.key],`${p.id}: ${result.key}`);}
});

test('all maps use SVG symbols for multi-root and container points and game inventory icons only for single roots',()=>{
  const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
  const icons=read('site/data/icons/factory/manifest.json'),catalog=read('site/data/icons/items/manifest.json'),extras=read('site/data/icons/items/spt-extras.json');
  icons.items={...icons.items,...catalog.items,...extras.items};icons.entries={...icons.entries,...catalog.entries,...extras.entries};
  for(const family of [...Object.keys(FAMILIES),'mixed'])assert.match(icons.entries[family].file,/\.svg$/,family);
  assert.equal(icons.entries.valuable.sourceFile,'icon/symbols/valuable.svg');
  const maps=['customs','factory','ground_zero','icebreaker','interchange','labs','labyrinth','lighthouse','reserve','shoreline','streets','terminal','woods'];
  let multi=0,exact=0;
  for(const map of maps){const data=read(`site/data/${map}-atlas.json`);
    for(const point of data.points){
      const descriptor=classifyPointMarker(point,data,icons),entry=icons.entries[descriptor.key];assert.ok(entry,`${map}:${point.id}:${descriptor.key}`);
      const roots=new Set((point.candidates||[]).filter(c=>c.weight==null||c.weight>0).map(c=>c.tpl));
      if(descriptor.mode==='item'){assert.equal(roots.size,1);assert.doesNotMatch(entry.file,/\.svg$/);exact++;}
      else{assert.match(entry.file,/\.svg$/,`${map}:${descriptor.key}`);if(roots.size>1)multi++;}
    }
  }
  assert.ok(multi>1000);assert.ok(exact>1000);
  const [a,b]=[...SEASON_DOCUMENTS];assert.equal(classifyPointMarker(loose([{tpl:a,weight:1},{tpl:b,weight:1}]),{items:{}}).key,'season_document');
});
