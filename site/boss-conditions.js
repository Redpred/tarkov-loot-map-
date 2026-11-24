import {bossName} from './boss-presentation.js';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>value.toLocaleString('zh-CN',{maximumSignificantDigits:8});
const modes={regular:'PvP 常规',pve:'PvE','pvp-season':'PvP 赛季'};
const specialTimes=new Set([9999,99999]);
// Existing map display names from scripts/lib/boss-data.mjs, scoped to Labs.
// Reusing a name does not establish a new coordinate or a current spawn point.
const zoneNames={labs:{BotZoneArmory:'军械库',BotZoneGreenOffice:'绿色办公室',BotZoneGate1:'一号闸门',BotZoneGate2:'二号闸门',BotZoneFloor1:'实验室一层',BotZoneFloor2:'实验室二层',BotZoneBasement:'实验室地下层'}};

function seconds(value){
  const minutes=Math.floor(value/60),rest=Math.round((value-minutes*60)*1000)/1000;
  return minutes?`${number(minutes)} 分钟${rest?' '+number(rest)+' 秒':''}`:`${number(value)} 秒`;
}

function roleName(value){
  if(typeof value!=='string'||!value.trim())return '角色名称未收录';
  const name=bossName(value);
  return name===value?'角色名称未收录':name;
}

function amounts(value){
  const parts=Array.isArray(value)?value:typeof value==='string'?value.split(','):finite(value)?[value]:[];
  const parsed=parts.map(v=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN);
  if(!parsed.length||parsed.some(v=>!Number.isInteger(v)||v<0))return {text:'数量未明确',positive:false,unknown:true,repeated:false};
  const unique=[...new Set(parsed)].sort((a,b)=>a-b),positive=unique.some(v=>v>0),repeated=unique.length<parsed.length;
  const text=unique.length===1?`${number(unique[0])} 名`:`候选数量 ${unique.map(number).join(' / ')} 名`;
  return {text:text+(repeated?'（原配置有重复项）':''),positive,unknown:false,repeated,multiple:unique.length>1};
}

function usableZoneName(value){
  return typeof value==='string'&&value.trim()&&!/^(?:Bot)?Zone|^[a-f\d]{24}$|_|^命名区域$/.test(value);
}

/**
 * Read-only presentation of a saved wave, an encyclopedia entry, or a legacy
 * catalog appearance. Missing fields remain unknown; no runtime availability,
 * encounter probability, trigger mapping, or guard total is inferred here.
 */
export function describeBossWave(input={}){
  const wave=object(input),raw=object(wave.detail||wave.raw||wave);
  const facts=[],notes=[];
  const add=(label,value)=>facts.push({label,value});
  const note=value=>{if(!notes.includes(value))notes.push(value);};
  const get=(keys,aliases=[])=>{
    for(const key of keys)if(own(raw,key))return {present:true,value:raw[key]};
    for(const key of aliases)if(own(wave,key))return {present:true,value:wave[key]};
    return {present:false,value:undefined};
  };

  const mode=get(['SpawnMode'],['modes']);
  const modeValues=Array.isArray(mode.value)?[...new Set(mode.value)]:[];
  add('配置模式',modeValues.length?modeValues.map(v=>modes[v]||'其他模式（名称未核验）').join(' / '):mode.present?'未列出模式':'此记录未提供');
  const enabled=get(['Enabled'],['enabled','Enabled']);
  add('场景启用标志',enabled.value===true?'快照中开启':enabled.value===false?'快照中关闭':'此记录未提供');
  note('模式与场景开关来自保存的配置，不代表活动当前开放或已分别实测这些模式。');

  const chance=get(['BossChance'],['chance']);
  const legacy=wave.probability;
  const probability=chance.present?chance.value:legacy?.basis==='version-configuration'&&legacy?.scope==='wave'?legacy.value:undefined;
  add('波次配置概率',finite(probability)&&probability>=0&&probability<=100?`${number(probability)}%（不等于实际遭遇率）`:'未提供可解释的概率');

  const trigger=get(['TriggerName'],['trigger']),triggerId=get(['TriggerId'],['triggerId']);
  const triggered=Boolean(trigger.value||triggerId.value||wave.triggered===true);
  if(trigger.value==='interactObject')add('触发条件','与场景物件交互；具体开关尚未核验');
  else if(trigger.value==='botEvent')add('触发条件','游戏事件；具体事件尚未核验');
  else if(triggered)add('触发条件','有事件或交互触发记录；具体条件尚未核验');
  else if(trigger.present||own(wave,'triggered'))add('触发条件','此条未设置事件或交互触发');
  if(triggered)note('触发标识只说明配置关联；没有确认具体开关、事件及条件组合时，不推断实际触发操作。');

  const force=get(['ForceSpawn'],['force','forceSpawn']);
  if(force.value===true){
    add('强制生成标志','开启（不等于每局必刷）');
    note('强制生成标志不能脱离模式、场景和触发条件解释，也不能用来覆盖波次概率。');
  }else if(force.value===false)add('强制生成标志','关闭');

  const random=get(['RandomTimeSpawn'],['randomTime']);
  if(random.value===true)add('生成时机','配置为随机时机；随机范围未提供');
  else if(random.value===false)add('随机时机标志','关闭');
  const time=get(['Time'],['time']);
  if(finite(time.value)){
    if(time.value<0)add('生成时间参数',`特殊值 ${number(time.value)}；未设常规倒计时`);
    else if(specialTimes.has(time.value))add('生成时间参数',`特殊配置值 ${number(time.value)}；不按倒计时解读`);
    else{
      add('生成时间参数',seconds(time.value)+'（配置值）');
      if(time.value>0)note('非零时间可能参与生成时机或触发门限判断，不能据此承诺该时刻必定出现。');
      else note('时间参数为零不等于已确认开局必刷。');
    }
  }
  const delay=get(['Delay'],['delay']);
  if(finite(delay.value))add('延迟参数',delay.value>=0?seconds(delay.value):`特殊值 ${number(delay.value)}；未设常规延迟`);
  const randomDelay=get(['RandomDelay'],['randomDelay']);
  if(randomDelay.present&&randomDelay.value!=null){
    const value=randomDelay.value;
    add('随机延迟参数',typeof value==='boolean'?(value?'开启':'关闭'):finite(value)?`${number(value)}（单位未核定）`:'已配置；数值含义与单位未核定');
  }

  const karma=get(['DependKarma']),karmaPve=get(['DependKarmaPVE']);
  for(const [field,label] of [[karma,'PvP 业力依赖'],[karmaPve,'PvE 业力依赖']]){
    if(field.present)add(label,field.value===true?'启用':field.value===false?'未启用':'未提供明确值');
  }
  if((karma.present||karmaPve.present)&&(!karma.present||!karmaPve.present)){
    add(karma.present?'PvE 业力依赖':'PvP 业力依赖','此记录未提供，不能按关闭处理');
  }else if(!karma.present&&!karmaPve.present&&own(wave,'karma')){
    add('业力依赖',wave.karma===true?'旧版有依赖记录；未分别记录 PvP 与 PvE':'旧版未标出依赖；未分别记录 PvP 与 PvE');
  }
  if(karma.value===true||karmaPve.value===true||wave.karma===true)note('业力依赖标志未给出具体阈值或触发公式，不据此计算遭遇概率。');

  const escort=get(['BossEscortType'],['escort']),escortAmount=get(['BossEscortAmount'],['escortAmount']);
  const supports=get(['Supports'],['supports']);
  const hasRawCompanions=escort.present||escortAmount.present||supports.present;
  const escortParsed=amounts(escortAmount.value);
  if(escort.present||escortAmount.present){
    add('基础随行配置',!escortParsed.positive&&!escortParsed.unknown?'未配置随行人数（0 名）':`${roleName(escort.value)} · ${escortParsed.text}`);
    if(escortParsed.multiple||escortParsed.repeated)note('逗号分隔的是数量候选记录；重复值不作为已确认的概率或额外人数。');
  }
  if(Array.isArray(supports.value)){
    let skipped=0;
    for(const support of supports.value){
      const amount=amounts(support?.BossEscortAmount);
      if(!amount.positive&&!amount.unknown){skipped++;continue;}
      add('随行分组配置',`${roleName(support?.BossEscortType)} · ${amount.text}`);
      if(amount.multiple||amount.repeated)note('逗号分隔的是数量候选记录；重复值不作为已确认的概率或额外人数。');
    }
    if(skipped)note(`另有 ${skipped} 条随行分组的配置数量为零，未列作会出现的随行成员。`);
    if(supports.value.length&&(escort.present||escortAmount.present))note('基础随行字段与随行分组可能描述同一支队伍，不相加推算总人数。');
  }
  if(!hasRawCompanions&&Array.isArray(wave.companions)&&wave.companions.length){
    for(const companion of wave.companions){
      const amount=amounts(companion?.amounts);
      if(amount.positive||amount.unknown)add('旧版随行记录',`${roleName(companion?.role)} · ${amount.text}`);
    }
    note('旧版随行记录合并了基础字段与分组，条目可能重叠，不累加为总人数。');
  }

  const zone=get(['BossZone'],['zones']);
  if(zone.present){
    const entries=Array.isArray(zone.value)?zone.value:typeof zone.value==='string'?zone.value.split(',').map(v=>v.trim()).filter(Boolean):[];
    const unique=[...new Map(entries.map(v=>[typeof v==='string'?v:v?.id||v?.name,v])).values()];
    const named=unique.map(v=>typeof v==='object'?v?.name:zoneNames[wave.mapId]?.[v]).filter(usableZoneName);
    // A raw identifier may have a human-readable counterpart on a legacy row.
    const providedNames=Array.isArray(wave.zones)?wave.zones.filter(v=>v&&typeof v==='object'&&usableZoneName(v.name)).map(v=>v.name):[];
    const labels=[...new Set(named.length?named:providedNames)];
    add('生成区域',labels.length?labels.join('、')+(unique.length>labels.length?'；另有区域名称未关联':''):unique.length?`已配置 ${unique.length} 个区域；名称尚未关联`:'此条未指定固定区域');
    note('区域配置不是精确出生点；未填写区域也不能直接解释为全图随机生成。');
  }
  const ignore=get(['IgnoreMaxBots']);
  if(ignore.value===true)add('AI 数量上限标志','忽略数量上限（配置标志）');
  else if(ignore.value===false)add('AI 数量上限标志','未启用忽略上限');
  return {facts,notes};
}
