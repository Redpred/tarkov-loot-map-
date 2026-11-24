import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {scannerSettings,priceTier,formatK,valueDetection,summarizeDetections,makeNameIndex,matchName,suppressDuplicates,csvText} from '../../site/loot-data.js';
import {grayscale,findGridLines,estimateCell,gridRectangles,recognizePixels} from '../../site/loot-vision.js';

const id='57347ca924597744596b4e71',item={id,name:'显示卡',en:'Graphics card',aliases:['GPU','显卡'],width:2,height:1,stackMax:1};
test('whole-item labels and per-slot colors are independent at every tier boundary',()=>{
  const settings=scannerSettings(),market={items:{[id]:{trader:{priceRUB:25000},fleaAllowed:true,offers:8,fleaMin:80000}}};
  const value=valueDetection({},item,market,settings);
  assert.equal(value.total,80000);assert.equal(value.perSlot,40000);assert.equal(value.tier,2);assert.equal(value.label,'80K');
  assert.deepEqual([9999,10000,39999,40000,99999,100000].map(n=>priceTier(n)),[0,1,1,2,2,3]);
  assert.equal(valueDetection({},item,market,{...settings,label:'slot'}).label,'40K/格');
});
test('banned, empty and unavailable flea prices cannot override the highest trader price',()=>{
  for(const quote of [{fleaAllowed:false},{offers:0}]){
    const value=valueDetection({},item,{items:{[id]:{trader:{priceRUB:30000},fleaMin:100000,...quote}}},scannerSettings());
    assert.equal(value.total,30000);assert.equal(value.source,'商人');
  }
  const missing=valueDetection({},item,{items:{}},scannerSettings());assert.equal(missing.total,null);assert.equal(missing.tier,-1);assert.equal(missing.label,'—');
});
test('stack quantity changes total and per-slot value without multiplying occupied slots',()=>{
  const ammo={...item,width:1,height:1,stackMax:60};
  const v=valueDetection({quantity:30},ammo,{items:{[id]:{trader:{priceRUB:1000}}}},scannerSettings());
  assert.equal(v.total,30000);assert.equal(v.slots,1);assert.equal(v.perSlot,30000);
  assert.equal(valueDetection({quantity:300},ammo,null,scannerSettings()).quantity,1);
});
test('unconfirmed and missing-price items are excluded and accounted for separately',()=>{
  const data=[{itemId:id,confirmed:true},{itemId:id,confirmed:false},{itemId:'other',confirmed:true}];
  const lookup=new Map([[id,item],['other',{...item,id:'other'}]]);
  assert.deepEqual(summarizeDetections(data,lookup,{items:{[id]:{trader:{priceRUB:22000}}}},scannerSettings()),{total:22000,slots:4,priced:1,missing:1,pending:1});
});
test('invalid saved thresholds, colors and modes fall back to safe independent defaults',()=>{
  const s=scannerSettings({thresholds:[40000,10000,100000],colors:['red'],mode:'other',cellSize:4});
  assert.deepEqual(s.thresholds,[10000,40000,100000]);assert.equal(s.colors[0],'#e2e8f0');assert.equal(s.mode,'regular');assert.equal(s.cellSize,0);
  s.thresholds[0]=42;assert.equal(scannerSettings().thresholds[0],10000);
  assert.deepEqual(scannerSettings({thresholds:[5000,10000,20000]}).thresholds,[5000,10000,20000]);
});
test('K notation preserves small positive prices and million-ruble prices',()=>{
  assert.equal(formatK(9999),'10K');assert.equal(formatK(1200000),'1200K');assert.equal(formatK(1),'<0.1K');assert.equal(formatK(null),'—');assert.equal(formatK(0),'0K');
});
test('text matching retains ambiguous aliases and does not invent short-name fuzzy matches',()=>{
  const index=makeNameIndex([item,{...item,id:'second',aliases:['GPU']}]);
  assert.equal(matchName('GPU',index).length,2);assert.equal(matchName('显卡',index)[0].id,id);assert.equal(matchName('GP',index).length,0);
  assert.equal(matchName('Graphics ca rd',index).length,2);assert.equal(matchName('Settings',index).length,0);
});
test('overlapping OCR and icon matches collapse but repeated physical items remain distinct',()=>{
  const one={itemId:id,box:{x:0,y:0,width:126,height:63},confirmed:true,confidence:.8};
  assert.equal(suppressDuplicates([one,{...one,confirmed:false,confidence:.99},{...one,box:{x:190,y:0,width:126,height:63}}]).length,2);
});
test('CSV quoting retains multiline names and neutralizes formula-like values',()=>{
  const csv=csvText([['=IMPORTDATA("x")','a,b','line\nbreak']]);assert.ok(csv.startsWith('\ufeff"\'=IMPORTDATA'));assert.ok(csv.includes('"a,b"'));assert.ok(csv.includes('"line\nbreak"'));
});
test('grid detection finds closed one-slot and multi-slot regions without treating blanks as items',()=>{
  const width=260,height=200,data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=20;data[i+3]=255;}
  for(const x of [20,83,146,209])for(let y=20;y<=146;y++){const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=75;}
  for(const y of [20,83,146])for(let x=20;x<=209;x++){const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=75;}
  const image={data,width,height},lines=findGridLines(grayscale(image),width,height),cell=estimateCell(lines,width,height),boxes=gridRectangles(lines,cell,width,height);
  assert.ok(Math.abs(cell-63)<3);assert.ok(boxes.some(b=>b.cols===2&&b.rows===1));assert.ok(boxes.some(b=>b.cols===1&&b.rows===1));
  const pixels=Buffer.alloc(768,20).toString('base64');assert.equal(recognizePixels(image,[{...item,signature:pixels}]).detections.length,0);
});
test('public navigation hides image valuation while its local source remains available',async()=>{
  const policy=JSON.parse(await fs.readFile(new URL('../../deploy/public-page-policy.json',import.meta.url),'utf8'));
  assert.ok(policy.disabledPages.includes('site/loot.html'));
  for(const page of ['index','tasks','factory','streets','map','loot']){
    const html=await fs.readFile(new URL(`../../site/${page}.html`,import.meta.url),'utf8');
    if(page==='loot')assert.match(html,/<nav class="app-nav"/);
    else assert.doesNotMatch(html,/href="loot\.html"/);
  }
});
