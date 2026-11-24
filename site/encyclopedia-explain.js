// Context-specific presentation. Never mutate the captured records.
import {duration,readableNumber,enumText} from './encyclopedia-reader.js';

const stateEffects=new Set(['HandsTremor','QuantumTunnelling','Contusion','Pain','RemoveAllBloodLosses','Antidote','Fracture','HeavyBleeding','LightBleeding','ZombieInfection','FrostbiteBuff','UnknownToxin']);
const effectNames={HandsTremor:'手部颤抖',QuantumTunnelling:'视野收窄',ZombieInfection:'感染状态',FrostbiteBuff:'冻伤状态',UnknownToxin:'未知毒素',DamageModifier:'伤害修正'};
export function describeBuff(b,names={}){
  const label=effectNames[b.BuffType]||enumText(b.BuffType,'BuffType','',names);
  const signed=v=>(v>0?'+':'')+readableNumber(v);
  let amount,note='';
  if(stateEffects.has(b.BuffType))amount='状态效果';
  else if(b.BuffType==='DamageModifier'){
    amount=b.AbsoluteValue?readableNumber(b.Value):readableNumber(b.Value*100)+'%';
    note='伤害修正参数；增减方向与适用伤害类型尚未核验。';
  }else if(b.AbsoluteValue===false){amount=signed(b.Value*100)+'%';note='相对修正量，最终效果取决于作用前的基础数值。';}
  else if(['HealthRate','EnergyRate','HydrationRate','StaminaRate'].includes(b.BuffType))amount=signed(b.Value)+' 点/秒';
  else if(b.BuffType==='SkillRate')amount=signed(b.Value)+' 级';
  else if(b.BuffType==='MaxStamina')amount=signed(b.Value)+' 点';
  else {amount=signed(b.Value);note='绝对变化量；该效果的计量单位尚未核验。';}
  const timing=b.Duration>0?'持续 '+duration(b.Duration):b.Duration===0?'未设置持续计时（不代表没有效果）':b.Duration<0?'采用特殊持续规则（不据此判断永久生效）':'持续时间未提供';
  const chance=Number.isFinite(b.Chance)?readableNumber(b.Chance*100)+'% 概率触发':'触发概率未提供';
  return {label:b.BuffType==='SkillRate'&&b.SkillName?enumText(b.SkillName,'SkillName','',names)+' · '+label:label,amount,note,
    timing:[b.Delay>0?duration(b.Delay)+' 后生效':b.Delay===0?'即时生效':'生效延迟未明确',timing,chance].join(' · ')};
}
export function rewardItem(reward){
  const root=(reward.items||[]).find(i=>i._id===reward.target);
  return root?{templateId:root._tpl,count:reward.value??root.upd?.StackObjectsCount??1,attachments:(reward.items||[]).filter(i=>i._id!==root._id)}:null;
}
export const currencies={'5449016a4bdc2d6f028b456f':'卢布','5696686a4bdc2da3298b456a':'美元','569668774bdc2da2298b4568':'欧元'};
export function paymentText(exit,count,names={}){
  if(!Number.isFinite(count))return '未提供';
  if(currencies[exit.Id])return readableNumber(count)+' '+currencies[exit.Id];
  return `${readableNumber(count)} 件${names[exit.Id]?' '+names[exit.Id]:'指定物品（名称未收录）'}`;
}
export function plainLocale(value){
  // Text only. The caller must still escape this string when inserting HTML.
  return String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').trim();
}
export function timecode(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '时间未明确';
  const ms=Math.round(seconds*1000),rest=(ms%60000)/1000;
  return `${Math.floor(ms/60000)}:${rest<10?'0':''}${rest}`;
}
export function requirementExtra(v){
  return [v.isSpawnedInSession||v.onlyFoundInRaid?'须在战局中发现':'',v.isFunctional?'须功能完整':'',
    v.minDurability>0?`耐久至少 ${readableNumber(v.minDurability)}%`:'',
    Number.isFinite(v.maxDurability)&&v.maxDurability<100?`耐久不高于 ${readableNumber(v.maxDurability)}%`:'',
    v.dogtagLevel>0?`狗牌等级至少 ${readableNumber(v.dogtagLevel)} 级`:''].filter(Boolean).join('；');
}
