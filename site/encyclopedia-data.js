import {sha256} from './atlas-resource-cache.js';
import {extraFieldNames} from './encyclopedia-fields.js';
import {bossFamily,bossName,bossContext} from './boss-presentation.js';

export const fieldNames={
  ...extraFieldNames,
  Weight:'重量（kg）',Width:'宽度（格）',Height:'高度（格）',StackMaxSize:'最大堆叠',Caliber:'口径',Damage:'伤害',PenetrationPower:'穿透力',ArmorDamage:'护甲伤害参数',InitialSpeed:'初速（m/s）',BulletMassGram:'弹头质量（g）',FragmentationChance:'碎片概率参数',RicochetChance:'跳弹概率参数',Tracer:'曳光弹',ammoType:'弹药类型',DurabilityBurnModificator:'耐久消耗系数',HeatFactor:'热量系数',
  armorClass:'护甲等级',ArmorMaterial:'护甲材质',MaxDurability:'最大耐久',Durability:'耐久',speedPenaltyPercent:'移速惩罚参数',mousePenalty:'转向惩罚参数',weaponErgonomicPenalty:'人机工效惩罚参数',BluntThroughput:'钝伤穿透参数',armorZone:'防护部位',Ergonomics:'人机工效',RecoilForceUp:'垂直后坐力',RecoilForceBack:'水平后坐力',bFirerate:'射速（发/分钟）',weapClass:'武器类型',weapFireType:'射击模式',
  MaxHpResource:'治疗资源',hpResourceRate:'治疗消耗速率',medUseTime:'使用时间（秒）',StimulatorBuffs:'注射器效果组',effects_health:'生命效果',effects_damage:'伤害效果',MaxResource:'最大资源',Resource:'资源',
  CanSellOnRagfair:'允许跳蚤出售的模板标志',CanRequireOnRagfair:'允许作为交换条件',RagfairLevelToTrade:'物品交易等级参数',RagFairCommissionModifier:'跳蚤手续费系数',QuestItem:'任务物品',IsUnbuyable:'不可购买标志',IsUnsaleable:'不可售卖标志',InsuranceDisabled:'禁止保险',ExaminedByDefault:'默认已检视',
  BossChance:'波次刷新率（%）',BossName:'首领角色',BossZone:'生成区域',BossEscortType:'随行角色',BossEscortAmount:'随行数量',BossDifficult:'首领难度',BossEscortDifficult:'随行难度',SpawnMode:'模式标志',Time:'生成时间参数（秒）',Delay:'延迟（秒）',TriggerName:'触发事件',TriggerId:'触发标识',ForceSpawn:'强制生成标志',RandomTimeSpawn:'随机生成时间',Supports:'支援波次',IgnoreMaxBots:'忽略 AI 数量上限',Karma:'业力条件',
  Id:'标识',_id:'标识',id:'标识',Enabled:'启用标志',MinPlayers:'最少玩家',MaxPlayers:'最多玩家',EscapeTimeLimit:'战局时限（分钟）',DisabledForScav:'禁用 Scav',RequiredPlayerLevelMin:'最低等级',RequiredPlayerLevelMax:'最高等级',exits:'撤离条件',secretExits:'秘密撤离',transits:'转场',waves:'普通 AI 波次',SpawnPointParams:'出生配置',AirdropParameters:'空投参数',Position:'原始 XYZ 坐标',Rotation:'朝向',Categories:'角色类别',Sides:'阵营',BotZoneName:'区域标识',ColliderParams:'关联范围',Radius:'半径',Center:'中心',Name:'名称',EntryPoints:'入口条件',Chance:'概率参数',ExfiltrationTime:'撤离时间（秒）',
  areaType:'设施',area:'设施',areaLevel:'设施等级',requiredLevel:'所需等级',requirements:'制作要求',type:'类型',templateId:'物品',endProduct:'产物',productionTime:'制作时间（秒）',count:'数量',locked:'锁定标志',continuous:'持续生产',needFuelForAllProductionTime:'全程需要燃料',isEncoded:'加密配方',isCodeProduction:'代码制作',productionLimitCount:'生产上限',isFunctional:'需要功能完整',isSpawnedInSession:'需要战局中发现',QuestComplete:'任务完成',Item:'物品',Tool:'工具',Area:'设施',
  conditions:'条件',rewards:'奖励',conditionType:'条件类型',target:'目标',value:'值',compareMethod:'比较方式',Level:'等级',Quest:'任务',HideoutArea:'藏身处设施',HasItem:'持有物品',Skill:'技能',CustomizationDirect:'直接外观奖励',Stub:'占位奖励',ExtraDailyQuest:'额外每日任务',transferSettings:'转移设置',
  quickTimeEvents:'训练步骤',speed:'速度参数',successRange:'成功判定范围',startDelay:'开始延迟',endDelay:'结束延迟',key:'按键',results:'结果',skill:'技能',energy:'能量',hydration:'水分',
  BodyPart:'身体部位',Side:'阵营',AvailableAsDefault:'默认可用',ProfileVersions:'版本条件',ProfileVersionsIgnoresSide:'忽略阵营的版本',IntegratedArmorVest:'内置护甲',
  chapterId:'所属章节',ChapterId:'章节标识',conditionIds:'条件引用',links:'关联',items:'物品',offers:'交易',crafts:'制作',questId:'任务标识',fullTemplateAvailable:'是否有完整任务模板',references:'引用记录',properties:'物品规则',noteId:'笔记标识',sourceKind:'关联类型',subtitles:'字幕时间轴',start:'开始（秒）',end:'结束（秒）',
  _name:'内部名称',_items:'预设物品',_tpl:'物品',slotId:'装备槽',parentId:'父项',_parent:'父项',_encyclopedia:'主物品',_changeWeaponName:'更改武器名称',_type:'记录类型',upd:'附加属性',
  minUserLevel:'最低角色等级',enabled:'开启',isOnlyFoundInRaidAllowed:'仅限战局中发现',maxActiveOfferCount:'信誉与挂单数',offerDurationTimeInHour:'挂单持续时间（小时）',maxRenewOfferTimeInHour:'最大续期时间（小时）',from:'起始信誉',to:'结束信誉',countForSpecialEditions:'特殊版本数量',communityItemTax:'物品税率参数',communityRequirementTax:'交换条件税率参数',communityTax:'社区税率参数',
  generatorSpeedWithoutFuel:'无燃料运转系数',generatorFuelFlowRate:'燃料消耗参数',airFilterUnitFlowRate:'空气过滤消耗参数',gpuBoostRate:'显卡加成参数',cultistAmuletBonusPercent:'护符加成参数',
  Aiming:'瞄准',Airdrop:'空投',ArmorMaterials:'护甲材质',ArtilleryShelling:'炮击',AudioSettings:'声音',BTRSettings:'BTR',Ballistic:'弹道',Health:'生命与状态',Inertia:'惯性',Insurance:'保险',KarmaCalculationSettings:'业力',Malfunction:'武器故障',Mastering:'武器掌握',MountingSettings:'架枪',Overheat:'过热',RagFair:'跳蚤市场',RepairSettings:'维修',RestrictionsInRaid:'战局限制',SkillsSettings:'技能',Stamina:'耐力',StaminaDrain:'耐力消耗',StaminaRestoration:'耐力恢复',SprintSpeed:'冲刺速度',WalkSpeed:'步行速度',TransitSettings:'转场',TripwiresSettings:'绊线',VaultingSettings:'翻越',QuestSettings:'任务',exp:'经验',rating:'评分',armor:'护甲',EventSettings:'活动',EventType:'活动类型',PveSettings:'PvE 设置',ItemsCommonSettings:'物品通用设置',TradingSettings:'交易设置',DiscardLimitsEnabled:'丢弃限制',GlobalLootChanceModifier:'物资概率全局系数',GlobalLootChanceModifierPvE:'PvE 物资概率全局系数',
};
export const labelField=key=>fieldNames[key]||key;
export function filterEntries(rows,{query='',group='',kind='all',sort='name',scope='all',mode=''}={}){
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result=rows.filter(r=>(!group||r.group===group)&&terms.every(t=>(r.search||`${r.name} ${r.id}`).toLocaleLowerCase().includes(t))
    &&(kind!=='ammo'||r.ammo&&r.type==='Item')&&(kind!=='quest'||r.quest)&&(kind!=='market'||r.market===true)
    &&(kind!=='items'||r.type==='Item')
    &&(!mode||(r.modes||[]).includes(mode))
    &&(scope==='all'||scope==='disabled'&&r.enabled===false||scope==='conditional'&&r.context?.kind==='conditional'||scope==='history'&&r.context?.kind==='history'||scope==='event'&&['event','history'].includes(r.context?.kind)
      ||scope==='season'&&r.context?.kind==='season'||scope==='configuration'&&!['history','disabled','event'].includes(r.context?.kind)));
  return result.sort((a,b)=>sort==='price'?(b.price??-1)-(a.price??-1)||a.name.localeCompare(b.name,'zh-CN'):sort==='chance'?(b.chance??-1)-(a.chance??-1):Number(Boolean(a.internal))-Number(Boolean(b.internal))||a.name.localeCompare(b.name,'zh-CN'));
}
export function groupBossEntries(rows){
  const groups=new Map();
  for(const wave of rows){
    const family=bossFamily(wave.role);
    if(!groups.has(family))groups.set(family,{id:'role:'+family,role:family,name:bossName(wave.role),waves:[],group:'BOSS 与特殊敌人'});
    groups.get(family).waves.push(wave);
  }
  return [...groups.values()].map(r=>({...r,subtitle:[...new Set(r.waves.map(w=>w.group||w.mapName))].join(' · '),
    contexts:[...(r.name===r.role?['角色名称待核验']:[]),...new Set(r.waves.map(w=>bossContext(w).label))],
    locations:new Set(r.waves.map(w=>w.location)).size,
  })).sort((a,b)=>Number(a.name===a.role)-Number(b.name===b.role)||a.name.localeCompare(b.name,'en'));
}
export async function fetchEncyclopediaResource(info,fetcher=fetch){
  if(!/^data\/encyclopedia\/[\w/-]+\.json$/.test(info?.file)||! /^[a-f0-9]{64}$/.test(info.sha256))throw Error('资料清单无效');
  const r=await fetcher(`${info.file}?v=${info.sha256}`,{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('资料暂时无法加载');
  const bytes=await r.arrayBuffer();
  if(bytes.byteLength!==info.bytes||await sha256(bytes)!==info.sha256)throw Error('资料版本校验失败');
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function loadEncyclopediaManifest(fetcher=fetch){
  const r=await fetcher('data/encyclopedia/manifest.json',{cache:'no-cache',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('百科暂时无法加载');
  const m=await r.json();if(m.version!==1||!Array.isArray(m.sections))throw Error('百科版本不兼容');return m;
}
export function boundSnapshot(snapshot,manifest){
  if(snapshot?.version!==1)return null;
  const valid=new Set(Object.keys(snapshot.bindings||{}).filter(id=>snapshot.bindings[id].bossMapSha256===manifest.maps[id]?.sha256));
  return {...snapshot,waves:snapshot.waves.map(w=>({...w,points:valid.has(w.mapId)?w.points:[]}))};
}
