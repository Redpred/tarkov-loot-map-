import test from 'node:test';
import assert from 'node:assert/strict';
import {createItemIndex} from '../../site/atlas-item-index.js';
import {highValuePreferences,itemMarketValue,valuableMapItems,priceToSlider,sliderToPrice,createHighValueDraft,createHighValueSelection,searchValueItems} from '../../site/atlas-high-value-data.js';

const market={mode:'regular',fetchedAt:'2026-10-15T16:00:00Z',items:{expensive:{trader:{priceRUB:120000},fleaMin:200000,fleaAvg:230000,offers:3},cheap:{trader:{priceRUB:1000},fleaMin:2000,fleaAvg:2500,offers:9},zero:{trader:null,fleaMin:900000,offers:0}}};
const data={items:{expensive:{zh:'贵重品'},cheap:{zh:'便宜物资'},zero:{zh:'无报价'}},pools:{pool:{items:[{tpl:'expensive',weight:1}]}},points:[
  {id:'loose',kind:'loose',position:{x:1,y:1,z:1},candidates:[{tpl:'expensive',weight:1}]},
  {id:'container',kind:'container',pool:'pool',position:{x:1,y:2,z:1}},
  {id:'zero',kind:'loose',position:{x:1,y:3,z:1},candidates:[{tpl:'expensive',weight:0},{tpl:'cheap',weight:1}]},
  {id:'quest',kind:'poi',poiTypes:['quest_item'],itemId:'expensive',position:{x:1,y:4,z:1}}
]};
test('search accepts Chinese, English tokens and IDs without changing hidden draft choices or confirmation',()=>{
  const rows=[{tpl:'a-123',name:'实体比特币',en:'Physical Bitcoin'},{tpl:'b-456',name:'显卡',en:'Graphics card'}],draft=createHighValueDraft();
  draft.setItem('b-456',false);
  assert.deepEqual(searchValueItems(rows,'BITcoin physical').map(i=>i.tpl),['a-123']);
  assert.equal(searchValueItems(rows,'比特币')[0].tpl,'a-123');assert.equal(searchValueItems(rows,'B-456')[0].tpl,'b-456');
  draft.selectAll(searchValueItems(rows,'BITcoin'),false);assert.equal(draft.selectedRows(rows).length,0);
  draft.selectAll(searchValueItems(rows,'显卡'),true);assert.equal(draft.checked('a-123'),false);assert.equal(draft.checked('b-456'),true);
  assert.equal(searchValueItems(rows,'no match').length,0);assert.equal(draft.checked('b-456'),true);
  const selection=createHighValueSelection(createItemIndex(data));selection.apply({market,minimum:0,basis:'best',...createHighValueDraft({excludedIds:['expensive']}).snapshot()});
  assert.deepEqual(selection.selection().ids,['cheap']);assert.equal(searchValueItems(rows,'').length,2);
});
test('valuation uses the selected basis, highest payout, and no unavailable or prohibited flea listings',()=>{
  assert.equal(itemMarketValue(market.items.expensive),200000);assert.equal(itemMarketValue(market.items.expensive,'trader'),120000);
  assert.equal(itemMarketValue(market.items.expensive,'fleaAvg'),230000);assert.equal(itemMarketValue(market.items.zero),0);
  assert.equal(itemMarketValue({...market.items.expensive,fleaAllowed:false}),120000);assert.equal(itemMarketValue(null),0);
});
test('minimum values are inclusive and map-specific; missing prices cannot qualify even at zero',()=>{
  const index=createItemIndex(data);
  assert.deepEqual(valuableMapItems(index,market,200000).map(i=>i.tpl),['expensive']);
  assert.equal(valuableMapItems(index,market,200001).length,0);
  assert.deepEqual(valuableMapItems(index,market,0).map(i=>i.tpl),['expensive','cheap']);
});
test('confirm is an independent snapshot, matches loose and container candidates, and can be fully cancelled',()=>{
  const selection=createHighValueSelection(createItemIndex(data));assert.equal(selection.active,false);
  const draft=structuredClone(market);selection.apply({market:draft,minimum:100000,basis:'best'});
  assert.equal(selection.active,true);assert.equal(selection.matches(data.points[0]),true);assert.equal(selection.matches(data.points[1]),true);
  assert.equal(selection.matches(data.points[2]),false);assert.equal(selection.matches(data.points[3]),false);
  draft.items.expensive.fleaMin=1;assert.equal(selection.matches(data.points[0]),true);
  assert.deepEqual(selection.selection().ids,['expensive']);selection.cancel();assert.equal(selection.active,false);assert.equal(selection.matches(data.points[0]),false);assert.equal(selection.selection(),null);
});
test('the slider covers zero, useful low thresholds and multi-million-ruble items',()=>{
  for(const max of [1000000,20000000]){
    assert.equal(sliderToPrice(0,max),0);assert.equal(sliderToPrice(1000,max),max);
    for(const value of [10000,100000,500000])assert.ok(Math.abs(sliderToPrice(priceToSlider(value,max),max)-value)<=3000);
  }
});
test('saved price preferences preserve valid choices without automatically activating a filter',()=>{
  assert.deepEqual(highValuePreferences({mode:'pve',basis:'trader',minimum:250000}),{mode:'pve',basis:'trader',minimum:250000});
  assert.deepEqual(highValuePreferences({mode:'bad',basis:'bad',minimum:-1}),{mode:'regular',basis:'best',minimum:100000});
  assert.deepEqual(highValuePreferences(null),{mode:'regular',basis:'best',minimum:100000});
  assert.equal(highValuePreferences({minimum:NaN}).minimum,100000);
});

test('point kinds and all individual items start checked, including newly qualifying items',()=>{
  const draft=createHighValueDraft();assert.deepEqual(draft.snapshot().kinds,['container','loose']);
  assert.equal(draft.checked('expensive'),true);assert.equal(draft.checked('new-after-price-change'),true);
  draft.setItem('expensive',false);assert.equal(draft.checked('expensive'),false);
  assert.deepEqual(draft.selectedRows([{tpl:'expensive'},{tpl:'cheap'}]),[{tpl:'cheap'}]);
  const restored=createHighValueDraft(draft.snapshot());assert.equal(restored.checked('expensive'),false);
});

test('bulk item selection covers every filtered page and preserves choices outside the current price range',()=>{
  const rows=Array.from({length:225},(_,i)=>({tpl:'item-'+i})),draft=createHighValueDraft();
  draft.selectAll(rows,false);assert.equal(draft.selectedRows(rows).length,0);assert.equal(draft.checked('item-224'),false);
  draft.selectAll(rows.slice(0,5),true);assert.equal(draft.selectedRows(rows).length,5);assert.equal(draft.checked('item-224'),false);
  assert.equal(draft.checked('new-item'),true);draft.selectAll(rows,true);assert.equal(draft.selectedRows(rows).length,225);
});

test('confirmed item and point-kind choices combine and allow explicitly empty selections',()=>{
  const selection=createHighValueSelection(createItemIndex(data));
  selection.apply({market,minimum:0,basis:'best',kinds:['loose'],excludedIds:['cheap']});
  assert.equal(selection.matches(data.points[0]),true);assert.equal(selection.matches(data.points[1]),false);assert.equal(selection.matches(data.points[2]),false);
  assert.deepEqual(selection.selection().ids,['expensive']);
  selection.apply({market,minimum:0,basis:'best',kinds:['container'],excludedIds:[]});
  assert.equal(selection.matches(data.points[0]),false);assert.equal(selection.matches(data.points[1]),true);
  selection.apply({market,minimum:0,basis:'best',kinds:[],excludedIds:[]});assert.equal(data.points.some(p=>selection.matches(p)),false);
  selection.apply({market,minimum:0,basis:'best',excludedIds:['expensive','cheap']});assert.deepEqual(selection.selection().ids,[]);assert.equal(data.points.some(p=>selection.matches(p)),false);
});

test('editing or exporting a draft cannot mutate the confirmed filter before confirmation',()=>{
  const selection=createHighValueSelection(createItemIndex(data)),draft=createHighValueDraft();
  selection.apply({market,minimum:0,basis:'best',...draft.snapshot()});
  draft.setItem('expensive',false);draft.kinds.delete('container');
  assert.equal(selection.matches(data.points[0]),true);assert.equal(selection.matches(data.points[1]),true);
  const exported=selection.selection();exported.kinds.length=0;exported.ids.length=0;exported.excludedIds.push('expensive');
  assert.equal(selection.matches(data.points[0]),true);assert.equal(selection.matches(data.points[1]),true);
  const reopened=createHighValueDraft(selection.selection());assert.equal(reopened.checked('expensive'),true);assert.ok(reopened.kinds.has('container'));
});
