import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {describeBuff,rewardItem,paymentText,plainLocale,timecode,requirementExtra} from '../../site/encyclopedia-explain.js';
import {formatNumber,readerLabel,readerNote,isTechnical,enumText} from '../../site/encyclopedia-reader.js';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),rows=id=>read('site/data/encyclopedia/'+id+'.json');
const context=read('site/data/encyclopedia/reader-context.json'),manifest=read('site/data/encyclopedia/manifest.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('state effects never become 0% or zero-duration no-op effects',()=>{
  for(const BuffType of ['RemoveAllBloodLosses','Antidote','HeavyBleeding','ZombieInfection','UnknownToxin']){
    const v=describeBuff({BuffType,Value:0,AbsoluteValue:false,Duration:0,Delay:0,Chance:.5});
    assert.equal(v.amount,'状态效果');assert.match(v.timing,/未设置持续计时/);assert.match(v.timing,/50%/);
  }
  assert.match(describeBuff({BuffType:'UnknownToxin',Value:0,Duration:-1,Chance:1}).timing,/特殊持续规则/);
});
test('absolute and relative rates, skills and uncertain damage directions remain distinct',()=>{
  assert.equal(describeBuff({BuffType:'StaminaRate',Value:3,AbsoluteValue:false}).amount,'+300%');
  assert.equal(describeBuff({BuffType:'StaminaRate',Value:3,AbsoluteValue:true}).amount,'+3 点/秒');
  assert.equal(describeBuff({BuffType:'SkillRate',SkillName:'Strength',Value:20,AbsoluteValue:true}).amount,'+20 级');
  const damage=describeBuff({BuffType:'DamageModifier',Value:.2,AbsoluteValue:false});
  assert.equal(damage.amount,'20%');assert.match(damage.note,/方向/);
});
test('all saved prestige item rewards resolve the root instance to a real item template without mutation',()=>{
  const items=new Set(rows('items').map(r=>r.id));let count=0;
  for(const entry of rows('prestige'))for(const r of entry.detail.rewards)if(r.type==='Item'){
    const before=JSON.stringify(r),v=rewardItem(r);assert.ok(items.has(v.templateId));assert.notEqual(v.templateId,r.target);assert.ok(v.count>0);assert.equal(JSON.stringify(r),before);count++;
  }
  assert.equal(count,17);assert.equal(rewardItem({target:'missing',items:[{_id:'other',_tpl:'unrelated'}]}),null);
});
test('extraction payments retain currency, mode and source amount',()=>{
  const ice=rows('maps').find(r=>r.id==='Icebreaker').detail.exits.find(x=>x.PassageRequirement==='TransferItem');
  assert.equal(paymentText(ice,ice.Count),'2,400 欧元');
  const woods=rows('maps').find(r=>r.id==='Woods').detail.exits.find(x=>x.PassageRequirement==='TransferItem');
  assert.equal(paymentText(woods,woods.Count),'20,000 卢布');assert.equal(paymentText(woods,woods.CountPVE),'5,000 卢布');
  assert.equal(paymentText(ice,undefined),'未提供');
});
test('unit rules do not invent percentages, rates or linear distances',()=>{
  assert.equal(formatNumber(66,'resource'),'66 点');assert.equal(formatNumber(.2,'PlaneAirdropChance'),'20%');
  assert.equal(formatNumber(4,'InteractionSqrDistance'),'4 m²');assert.equal(formatNumber(.95,'transferMultiplier'),'0.95 倍');
  assert.equal(formatNumber(86400,'time','hideout.results.finishEffect'),'1 天');
  assert.match(readerNote('hpResourceRate'),/不是每秒/);assert.match(readerNote('healthPenaltyMin'),/尚未|未说明/);
  assert.match(readerNote('transferMultiplier'),/不能直接/);assert.match(readerNote('weight'),/相对权重/);
  assert.match(requirementExtra({onlyFoundInRaid:true,minDurability:60,maxDurability:90,dogtagLevel:15}),/战局中发现.*60%.*90%.*15 级/);
});
test('subtitle text is complete, from pinned official locale, and rendered as escaped plain text',()=>{
  const source=read('data/spt-source.json'),bytes=fs.readFileSync(new URL(source.databasePath+'/locales/global/ch.json',root)),locale=JSON.parse(bytes);
  assert.equal(context.provenance.localeSha256,hash(bytes));let n=0;
  for(const tape of rows('media'))for(const s of tape.detail.subtitles||[]){assert.equal(context.subtitles[s.id].text,plainLocale(locale[s.id]));assert.equal(context.subtitles[s.id].language,'ch');n++;}
  assert.equal(n,308);assert.equal(Object.keys(context.subtitles).length,308);
  assert.equal(plainLocale('<b>应答机：</b><br>测试 &amp; 文本'),'应答机：\n测试 & 文本');
  // Entity-decoded markup remains text; the UI must escape rather than trusting locale HTML.
  assert.equal(plainLocale('&lt;img src=x onerror=alert(1)&gt;'),'<img src=x onerror=alert(1)>');
  const ui=fs.readFileSync(new URL('site/encyclopedia.js',root),'utf8');assert.match(ui,/e\(readerContext\.subtitles/);
  assert.equal(timecode(12.9),'0:12.9');
});
test('task links use same-build reward templates and never fill the unspecified QuestComplete condition',()=>{
  const bytes=fs.readFileSync(new URL('work/eft-ru-slow-task-market-20261020/parsed/task-definitions.json',root)),input=JSON.parse(bytes);
  assert.equal(hash(bytes),context.provenance.taskDefinitionsSha256);assert.equal(input.provenance.requestedGameVersion,manifest.eftVersion);
  assert.equal(Object.keys(context.craftTasks).length,2);
  for(const [id,links] of Object.entries(context.craftTasks)){
    const craft=rows('crafts').find(r=>r.id===id).detail;
    assert.ok(craft.requirements.some(r=>r.type==='QuestComplete'&&!r.questId));
    for(const link of links){const task=input.tasks.find(t=>t._id===link.taskId);assert.ok(task.rewards.Success.some(r=>r.type==='ProductionScheme'&&r.traderId===craft.areaType&&r.items.some(i=>i._id===r.target&&i._tpl===craft.endProduct)));}
  }
  assert.equal(enumText('eod_tue_edition','gameVersions','',context.names),'无名者版本');
});
test('all non-mechanics nested gameplay fields have readable labels and source resources remain byte-identical',()=>{
  const names={...read('site/data/encyclopedia/reader-names.json').names,...context.names};
  for(const id of ['maps','crafts','hideout','prestige','customization','market','story','media'])for(const r of rows(id)){
    function visit(v,path){if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(!/^\d+$/.test(k)&&!isTechnical(k))assert.ok(readerLabel(k,path,names),path+'.'+k);visit(x,path+'.'+k);}}
    visit(r.detail,id);
  }
  const before=read('work/encyclopedia-details-20261023/backup/site/data/encyclopedia/manifest.json');
  assert.deepEqual(manifest.itemChunks,before.itemChunks);assert.deepEqual(manifest.mapSnapshot,before.mapSnapshot);
  for(const s of manifest.sections)assert.deepEqual(s.resource,before.sections.find(x=>x.id===s.id).resource);
});
