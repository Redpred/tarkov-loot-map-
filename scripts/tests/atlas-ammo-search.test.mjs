import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {buildAmmoGroups} from '../../site/atlas-ammo-search.js';

test('ammo groups use exact caliber and include verified ammo boxes without unrelated rounds',()=>{
  const data={items:{round:{zh:'子弹'},box:{zh:'盒装子弹'},wrong:{zh:'另一口径'}},points:[{kind:'loose',position:{x:1,y:2,z:3},candidates:[{tpl:'box',weight:1}]},{kind:'loose',position:{x:2,y:2,z:3},candidates:[{tpl:'wrong',weight:1}]}]};
  const index=createItemIndex(data),catalog={items:[{tpl:'round',name:'型号 A',caliber:'A',caliberName:'口径 A',searchIds:['round','box']},{tpl:'wrong',name:'型号 B',caliber:'B',caliberName:'口径 B',searchIds:['wrong']},{tpl:'absent',name:'无点位',caliber:'C',caliberName:'口径 C'}]};
  const before=JSON.stringify(catalog),groups=buildAmmoGroups(catalog,index);
  assert.equal(groups.length,2);assert.deepEqual(groups[0].items[0].searchIds,['box']);
  assert.equal(index.matches(data.points[0],groups[0].items[0].searchIds),true);assert.equal(index.matches(data.points[1],groups[0].items[0].searchIds),false);
  assert.equal(JSON.stringify(catalog),before);
});

test('generated ammo catalogue agrees with the active map database, including every cartridge box mapping',()=>{
  const read=p=>JSON.parse(fs.readFileSync(new URL('../../'+p,import.meta.url)));
  const catalog=read('site/data/ammo-catalog.json'),source=read('data/spt-source.json'),items=read(source.databasePath+'/templates/items.json');
  assert.equal(catalog.source.commit,source.commit);
  for(const row of catalog.items){
    assert.equal(items[row.tpl]._props.Caliber,row.caliber);
    for(const box of row.searchIds.slice(1))assert.ok(items[box]._props.StackSlots.some(slot=>slot._props.filters.some(f=>f.Filter.includes(row.tpl))));
  }
  for(const id of ['factory','streets']){
    const data=read(`site/data/${id}-atlas.json`),index=createItemIndex(data),groups=buildAmmoGroups(catalog,index),actual=new Set(groups.flatMap(g=>g.items.flatMap(i=>i.searchIds)));
    const expected=new Set(catalog.items.flatMap(i=>i.searchIds).filter(id=>index.byId.has(id)));
    assert.deepEqual([...actual].sort(),[...expected].sort());assert.ok(groups.length>10);
  }
});
