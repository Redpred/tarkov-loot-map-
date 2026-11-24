import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {filterEntries,fetchEncyclopediaResource,boundSnapshot,groupBossEntries,fieldNames} from '../../site/encyclopedia-data.js';
import {bossName,bossContext,presentBossCatalog} from '../../site/boss-presentation.js';
import {translatedValue,caliberLabel} from '../../site/encyclopedia-fields.js';
import {allowedAppearance} from '../../site/boss-data.js';
import {duration,formatNumber,readerLabel,enumText,presentEntry} from '../../site/encyclopedia-reader.js';
const root=new URL('../../',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,root)));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=read('site/data/encyclopedia/manifest.json');
const rows=id=>read('site/'+manifest.sections.find(s=>s.id===id).resource.file);

test('all encyclopedia resources are complete, hashed, and contain no collection credentials or private paths',()=>{
  const resources=[...manifest.sections.map(s=>s.resource),...Object.values(manifest.itemChunks),manifest.mapSnapshot,manifest.readerNames,manifest.readerContext].filter(Boolean);
  for(const info of resources){
    const bytes=fs.readFileSync(new URL('site/'+info.file,root));assert.equal(hash(bytes),info.sha256);assert.equal(bytes.length,info.bytes);
    const text=bytes.toString();
    assert.doesNotMatch(text,/PHPSESSID|"Authorization"\s*:|access_token|refresh_token|\/home\/ubuntu|D:\\\\Git|InventoryTarcoinMigrationProdAllowedAids/i);
  }
  assert.equal(manifest.sources.length,15);
  for(const section of manifest.sections){const entries=rows(section.id);assert.equal(entries.length,section.count);assert.equal(new Set(entries.map(r=>r.id)).size,entries.length);}
});

test('reader distinguishes stored percentage points, probability fractions, units and special values',()=>{
  assert.equal(formatNumber(.08,'Weight'),'80 g');
  assert.equal(formatNumber(1.2,'Weight'),'1.2 kg');
  assert.equal(formatNumber(.44,'FragmentationChance'),'44%');
  assert.equal(formatNumber(47,'ArmorDamage'),'47%');
  assert.equal(formatNumber(.1,'LightBleedingDelta'),'+10 个百分点');
  assert.equal(formatNumber(100,'Chance','maps.exits'),'100%');
  assert.equal(formatNumber(1,'Chance','Buffs'),'100%');
  assert.equal(formatNumber(1,'Chance','unreviewed'),'1');
  assert.equal(formatNumber(-4,'speedPenaltyPercent'),'-4%');
  assert.equal(duration(39600),'11 小时');
  assert.equal(duration(90),'1 分钟 30 秒');
  assert.match(duration(-1),/特殊值/);
  assert.equal(formatNumber(0.000001319,'generatorFuelFlowRate'),'0.000001319');
  assert.equal(formatNumber(null,'Weight'),'未提供');
});

test('reader resolves contextual labels without changing proper names or source values',()=>{
  assert.equal(readerLabel('Pain','items.effects_damage'),'镇痛');
  assert.equal(readerLabel('x','mechanics.Stamina'),'X 分量');
  assert.equal(readerLabel('x','maps.Position'),'X 坐标');
  assert.equal(enumText('Eyes','armorColliders'),'眼部');
  assert.equal(enumText('Ceramic','Name'),'Ceramic');
  const original=rows('crafts').find(r=>r.detail.productionTime===39600),before=JSON.stringify(original);
  const display=presentEntry(original,'crafts');
  assert.match(display.subtitle,/11 小时/);assert.equal(JSON.stringify(original),before);
  const boss=rows('bosses').find(r=>r.name==='The Wedge');
  assert.equal(presentEntry(boss,'bosses',{[boss.id]:'不得使用的别名'}).name,'The Wedge');
  const names=read('site/'+manifest.readerNames.file);
  const source=read('data/spt-source.json');
  const localeBytes=fs.readFileSync(new URL(source.databasePath+'/locales/global/ch.json',root));
  assert.equal(hash(localeBytes),names.localeSha256);
  const locale=JSON.parse(localeBytes);
  for(const [id,name] of Object.entries(names.names))assert.ok([locale[id+' Name'],locale[id+' name'],locale[id]].includes(name),id);
});
test('all item numeric attributes and base prices equal the saved official captures; missing price is never zero',()=>{
  const inv=read('work/eft-collector/data-catalog-20261020-extended.json');
  const source=id=>read(inv.datasets.find(s=>s.endpoint===id).file).data;
  const original=source('items'),prices=new Map(source('handbook').Items.map(r=>[r.Id,r.Price]));
  let count=0,withoutPrice=0;
  for(const info of Object.values(manifest.itemChunks))for(const [id,r] of Object.entries(read('site/'+info.file))){
    assert.deepEqual(r.detail,original[id]._props);assert.equal(r.price,prices.get(id)??null);
    assert.equal(r.market,original[id]._props.CanSellOnRagfair??null);assert.equal(Object.hasOwn(r,'liveMarketPrice'),false);
    if(r.price===null)withoutPrice++;count++;
  }
  assert.equal(count,6006);assert.ok(withoutPrice>0);
  assert.equal(rows('items').filter(i=>i.market===true&&i.type==='Item').length,4458);
});
test('official boss joins preserve scenarios, raw XYZ, modes, disabled scenes and all wave conditions',()=>{
  const original=read('work/eft-live-collection-20261020/locations.json').data.locations;
  const snap=read('site/'+manifest.mapSnapshot.file),bossManifest=read('site/data/bosses/manifest.json');
  assert.equal(snap.waves.length,260);let points=new Set();
  for(const w of snap.waves){
    const loc=Object.values(original).find(l=>l.Id===w.location),index=Number(w.id.split(':').at(-1)),raw=loc.BossLocationSpawn[index];
    assert.deepEqual(w.raw,raw);assert.equal(w.chance,raw.BossChance);assert.equal(w.enabled,loc.Enabled);assert.deepEqual(w.modes,raw.SpawnMode||[]);
    if(!w.points.length)continue;
    const old=read('site/'+bossManifest.maps[w.mapId].file);
    for(const p of w.points){
      const s=loc.SpawnPointParams.find(s=>s.Id===p.sourceId),b=old.points.find(b=>b.id===p.id);
      assert.deepEqual(p.position,s.Position);assert.ok(s.Categories.includes('Boss'));assert.equal(b.zone,s.BotZoneName);
      assert.ok(w.zones.includes(s.BotZoneName));assert.ok(!b.referenceOnly);
      assert.ok(Math.hypot(...['x','y','z'].map(k=>s.Position[k]-b.position[k]))<=.05);
      points.add(p.id);
    }
  }
  assert.equal(points.size,270);
  assert.ok(snap.waves.some(w=>!w.enabled&&w.chance===100&&w.trigger));
  const broken=structuredClone(bossManifest);for(const info of Object.values(broken.maps))info.sha256='x';
  assert.ok(boundSnapshot(snap,broken).waves.every(w=>w.points.length===0));
  assert.ok(boundSnapshot(snap,bossManifest).waves.some(w=>w.points.length));
});
test('search combines Chinese/English terms and respects scope; unknown prices sort last',()=>{
  const items=rows('items');
  assert.ok(filterEntries(items,{query:'M855A1',kind:'ammo'}).every(r=>r.ammo&&r.detail===undefined));
  assert.equal(filterEntries(items,{kind:'ammo'}).length,manifest.counts.ammo);
  assert.ok(filterEntries(items,{query:'显卡'}).length>0);
  assert.equal(filterEntries(items,{query:'does-not-exist-encyclopedia'}).length,0);
  const market=filterEntries(items,{kind:'market',sort:'price'});assert.ok(market.every(r=>r.market===true));
  const nullIndex=market.findIndex(r=>r.price===null);assert.ok(market.slice(nullIndex).every(r=>r.price===null));
});
test('resource loader rejects changed payloads and paths outside the public encyclopedia directory',async()=>{
  const info=manifest.sections[0].resource,bytes=fs.readFileSync(new URL('site/'+info.file,root));
  assert.equal((await fetchEncyclopediaResource(info,async()=>new Response(bytes))).length,6006);
  await assert.rejects(fetchEncyclopediaResource(info,async()=>new Response('{}')),/校验/);
  await assert.rejects(fetchEncyclopediaResource({...info,file:'../private.json'}),/清单/);
});
test('public pages respect temporary page restrictions while local encyclopedia source and icons remain available',()=>{
  const policy=JSON.parse(fs.readFileSync(new URL('deploy/public-page-policy.json',root),'utf8'));
  assert.deepEqual(policy.disabledPages,['site/loot.html','site/encyclopedia.html']);
  for(const name of ['index','factory','streets','map','tasks','loot','encyclopedia']){
    const text=fs.readFileSync(new URL('site/'+name+'.html',root),'utf8');
    if(!policy.disabledPages.includes('site/'+name+'.html')){
      assert.match(text,/<nav[^>]*aria-label="主导航"/);
      assert.doesNotMatch(text,/href="(?:encyclopedia|loot)\.html/);
    }
    assert.doesNotMatch(text,/href="bosses\.html/);
  }
  assert.doesNotMatch(fs.readFileSync(new URL('site/boss-ui.js',root),'utf8'),/href="encyclopedia\.html/);
  assert.equal(fs.existsSync(new URL('site/bosses.html',root)),false);
  assert.equal(fs.existsSync(new URL('site/bosses.js',root)),false);
  for(const s of manifest.sections)for(const r of rows(s.id))if(r.icon)assert.ok(fs.existsSync(new URL('site/'+r.icon,root)),r.icon);
});

test('boss identity grouping does not turn waves, scene variants or archived events into extra bosses',()=>{
  const waves=rows('bosses'),grouped=groupBossEntries(waves);
  assert.equal(grouped.length,manifest.counts.bossIdentities);
  assert.equal(grouped.flatMap(r=>r.waves).length,waves.length);
  assert.equal(grouped.filter(r=>r.name==='Rogue').length,1);
  const wedge=grouped.filter(r=>r.name==='The Wedge');assert.equal(wedge.length,1);
  assert.ok(wedge[0].waves.some(w=>w.role==='bosswedge'));
  const historical=wedge[0].waves.find(w=>w.role==='bosswedgelab');
  assert.equal(historical.chance,33);
  assert.equal(historical.context.kind,'history');assert.equal(historical.context.showRate,false);
  assert.ok(filterEntries(waves,{scope:'history'}).every(w=>w.context.kind==='history'));
  assert.ok(!filterEntries(waves,{scope:'configuration'}).some(w=>w.role==='bosswedgelab'));
  for(const w of waves.filter(w=>w.location==='laboratory_dark')){
    assert.equal(w.variant,'实验室停电场景');assert.equal(w.context.showRate,false);
    assert.doesNotMatch(w.name,/暗区|实验室黑色军团|雷沙拉|塔吉拉/);
  }
});

test('display names use English boss originals and field translation never translates arbitrary proper names',()=>{
  const source=read('data/spt-source.json'),en=read(source.databasePath+'/locales/global/en.json');
  for(const key of Object.keys(en).filter(k=>k.startsWith('QuestCondition/Elimination/Kill/BotRole/boss'))){
    assert.equal(bossName(key.split('/').at(-1)),en[key]);
  }
  assert.equal(bossName('bossWedgeLab'),'The Wedge');
  assert.equal(bossName('unreviewedRole'),'unreviewedRole');
  assert.equal(translatedValue('ArmorMaterial','Name'),'ArmorMaterial');
  assert.equal(translatedValue('Ceramic','ArmorMaterial'),'陶瓷');
  assert.equal(translatedValue('Ceramic','Name'),'Ceramic');
  assert.equal(caliberLabel('Caliber556x45NATO'),'5.56×45 mm');
  assert.equal(caliberLabel('Caliber762x35'),'.300 Blackout');
  assert.equal(caliberLabel('Caliber86x70'),'.338 Lapua Magnum');
  assert.equal(caliberLabel('Caliber725'),'Caliber725');
  assert.equal(caliberLabel('7.62x51mm M80'),'7.62x51mm M80');
});

test('all retained top-level item fields and market rule labels have Chinese explanations',()=>{
  for(const info of Object.values(manifest.itemChunks))for(const entry of Object.values(read('site/'+info.file)))
    for(const key of Object.keys(entry.detail))assert.match(fieldNames[key]||'',/[\u3400-\u9fff]/,key);
  for(const entry of rows('market'))assert.match(entry.name,/[\u3400-\u9fff]/,entry.id);
  const items=rows('items');
  assert.equal(manifest.counts.items,items.filter(i=>i.type==='Item').length);
  assert.equal(manifest.counts.ammo,items.filter(i=>i.type==='Item'&&i.ammo).length);
  assert.equal(manifest.counts.recipes,rows('crafts').filter(r=>r.detail&&typeof r.detail==='object'&&r.detail.areaType!=null).length);
});

test('map presentation preserves raw mode flags and excludes uncertain dark-lab points from default scene selection',()=>{
  const original=read('site/data/bosses/catalog.json'),catalog=presentBossCatalog(structuredClone(original));
  for(const a of catalog.appearances){
    const source=original.appearances.find(s=>s.id===a.id);
    assert.deepEqual(a.modes,source.modes);assert.deepEqual(a.probability,source.probability);
  }
  const lab=catalog.appearances.find(a=>a.role==='bosswedgelab');
  assert.equal(allowedAppearance(lab,'regular'),false);
  assert.equal(allowedAppearance(lab,'regular','laboratory_dark'),true);
  assert.equal(allowedAppearance(lab,'pvp-season','laboratory_dark'),true);
  assert.equal(allowedAppearance(lab,'pvp-season'),false);
  assert.equal(bossContext({role:'bosswedgelab',location:'laboratory_dark',enabled:true,chance:100}).showRate,false);
});
