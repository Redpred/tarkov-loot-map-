// Display rules only. Source values remain untouched; units are explicit, never inferred from magnitudes.
import {fieldNames} from './encyclopedia-data.js';
import {fieldNotes,translatedValue,caliberLabel} from './encyclopedia-fields.js';
import {extraLabels,extraUnits,extraNote} from './encyclopedia-schema.js';

export const readerNames={
  Weight:'重量',Width:'宽度',Height:'高度',InitialSpeed:'弹丸初速',BulletMassGram:'弹头质量',BulletDiameterMilimeters:'弹头直径',
  Damage:'基础伤害',PenetrationPower:'穿透力',ArmorDamage:'护甲伤害',FragmentationChance:'碎片概率',RicochetChance:'跳弹概率',
  LightBleedingDelta:'轻度出血概率修正',HeavyBleedingDelta:'重度出血概率修正',BluntThroughput:'钝伤透过比例',
  speedPenaltyPercent:'移动速度修正',mousePenalty:'转向速度修正',weaponErgonomicPenalty:'人机工效修正',
  bFirerate:'全自动射速',SingleFireRate:'单发射速',medUseTime:'单次使用时间',foodUseTime:'进食时间',
  productionTime:'基础制作时间',EscapeTimeLimit:'战局时限',ExfiltrationTime:'撤离倒计时',ExfiltrationTimePVE:'PvE 撤离倒计时',
  ChancePVE:'PvE 出现概率',Count:'要求数量',CountPVE:'PvE 要求数量',PlayersCount:'所需人数',PlayersCountPVE:'PvE 所需人数',
  ExfiltrationType:'撤离方式',PassageRequirement:'撤离要求',RequiredSlot:'要求装备槽',RequirementTip:'要求说明',EntryPoints:'适用出生区域',
  MinTime:'最早开放参数',MaxTime:'最晚开放参数',MinTimePVE:'PvE 最早开放参数',MaxTimePVE:'PvE 最晚开放参数',EventAvailable:'活动可用标志',
  EligibleForPMC:'PMC 可用',EligibleForScav:'Scav 可用',active:'已启用',activateAfterSec:'开局后开放时间',location:'目标地图',description:'说明',events:'活动标志',time:'所需时间',
  DelayToCanSpawnSec:'允许生成前的延迟',Infiltration:'进入区域',CorePointId:'核心点位标识',ShowOnTarkovMap:'在地图显示',ShowOnTarkovMapPvE:'在 PvE 地图显示',
  BotPreset:'AI 难度',BotSide:'AI 阵营',KeepZoneOnSpawn:'生成后保持区域',SpawnPoints:'生成区域',WildSpawnType:'AI 角色',isPlayers:'玩家角色',number:'波次序号',slots_min:'最少人数',slots_max:'最多人数',time_min:'最早生成参数',time_max:'最晚生成参数',
  BuffType:'效果类型',SkillName:'作用技能',AbsoluteValue:'使用绝对数值',Duration:'持续时间',Delay:'生效延迟',Value:'效果数值',Chance:'触发概率',
  Buffs:'注射器效果',Effects:'状态效果',Stimulator:'注射器',HealthRate:'生命恢复速度',EnergyRate:'能量变化速度',HydrationRate:'水分变化速度',
  HealthRateMultiplier:'生命恢复倍率',StaminaRate:'耐力恢复速度',StaminaRateMultiplier:'耐力恢复倍率',SkillRate:'技能加成',MaxStamina:'耐力上限加成',
  WeightLimit:'负重上限加成',DamageModifier:'受到伤害修正',RemoveAllBloodLosses:'止血',Antidote:'解毒',BodyTemperature:'体温',
  Head:'头部',Chest:'胸部',Stomach:'腹部',LeftArm:'左臂',RightArm:'右臂',LeftLeg:'左腿',RightLeg:'右腿',Common:'全身',
  Endurance:'耐力',Strength:'力量',Vitality:'活力',Health:'生命与状态',StressResistance:'抗压',Metabolism:'代谢',Immunity:'免疫',Charisma:'魅力',Perception:'感知',Intellect:'智力',Attention:'专注',Memory:'记忆',Surgery:'手术',Search:'搜索',CovertMovement:'隐蔽行动',TroubleShooting:'故障排除',
  Dehydration:'脱水',Exhaustion:'精疲力竭',LightBleeding:'轻度出血',HeavyBleeding:'重度出血',Pain:'疼痛',PainKiller:'镇痛',Fracture:'骨折',Contusion:'震荡',Tremor:'颤抖',DestroyedPart:'损毁部位',Intoxication:'中毒',RadExposure:'辐射暴露',
  effects_health:'能量与水分',effects_damage:'伤势处理',delay:'生效延迟',duration:'持续时间',fadeOut:'效果消退时间',cost:'治疗资源消耗',
  Destructibility:'耐久损耗系数',ExplosionDestructibility:'爆炸耐久损耗系数',MinRepairDegradation:'商人维修最低耐久损失比例',MaxRepairDegradation:'商人维修最高耐久损失比例',MinRepairKitDegradation:'维修包最低耐久损失比例',MaxRepairKitDegradation:'维修包最高耐久损失比例',
  Capacity:'耐力容量',HandsCapacity:'手臂耐力容量',OxygenCapacity:'屏息容量',OxygenRestoration:'屏息恢复参数',AimDrainRate:'瞄准耐力消耗',SprintDrainRate:'冲刺耐力消耗',BaseRestorationRate:'基础耐力恢复',HandsRestoration:'手臂耐力恢复',
  JumpConsumption:'跳跃耐力消耗',ProneConsumption:'卧倒耐力消耗',SitToStandConsumption:'起立耐力消耗',GrenadeHighThrow:'高抛手雷耐力消耗',GrenadeLowThrow:'低抛手雷耐力消耗',WeaponFastSwitchConsumption:'快速切枪耐力消耗',
  AimingSpeedMultiplier:'瞄准速度倍率',BipodAimDrainRateMultiplier:'两脚架瞄准消耗倍率',MountingHorizontalAimDrainRateMultiplier:'水平架枪消耗倍率',MountingVerticalAimDrainRateMultiplier:'垂直架枪消耗倍率',ExhaustedMeleeDamageMultiplier:'力竭近战伤害倍率',FallDamageMultiplier:'坠落伤害倍率',
  BaseOverweightLimits:'基础负重阈值',SprintOverweightLimits:'冲刺负重阈值',WalkOverweightLimits:'步行负重阈值',WalkSpeedOverweightLimits:'步速负重阈值',AimConsumptionByPose:'各姿态瞄准消耗',RestorationMultiplierByPose:'各姿态恢复倍率',
  MaxInLobby:'仓库携带上限',MaxInRaid:'战局携带上限',TemplateId:'物品',Templates:'适用物品',Level2:'二级所需经验',Level3:'三级所需经验',
  FireMode:'射击模式',Repairable:'耐久状态',Foldable:'折叠功能',Folded:'已折叠',StackObjectsCount:'堆叠数量',SpawnedInSession:'战局中发现',
  index:'顺序',dynamicLocale:'动态文本',visibilityConditions:'显示条件',globalQuestCounterId:'全局任务计数标识',dialogId:'对话标识',entryPoint:'进入点',fromTraderId:'来源商人',props:'附属条件',questNoteId:'任务笔记标识',status:'任务状态',
  Completed:'已完成',Failed:'已失败',Started:'已接取',QuestId:'任务',questId:'任务',quests:'相关任务',availableAfter:'解锁延迟',dispersion:'随机偏差',isFinisher:'完成条件标志',
  unknown:'内容未明确',availableInGameEditions:'适用版本',gameMode:'适用模式',illustrationConfig:'展示图片',isBigImage:'使用大图',isHidden:'隐藏奖励',isImportant:'重点奖励',image:'图片',bigImage:'大图',
  linkKind:'关联类型',linkId:'关联对象',internalName:'内部名称',conditionIndex:'条件序号',sourceCondition:'关联条件',itemId:'物品',
  rcid:'资源标识',isNotRandom:'不参与随机选择',NotRandom:'不参与随机选择',body:'上装',hands:'手部',feet:'下装',head:'头部',
  position:'位置参数',results:'训练结果',success:'成功结果',failure:'失败结果',probability:'触发概率',
  generatorSpeedWithoutFuel:'无燃料时的制作速度',generatorFuelFlowRate:'发电机燃料消耗参数',airFilterUnitFlowRate:'空气过滤消耗参数',gpuBoostRate:'显卡加成系数',cultistAmuletBonusPercent:'护符加成',
  Falling:'坠落伤害',HealPrice:'治疗价格',ProfileHealthSettings:'角色生命设置',
  ChangeForReturnItemsInOfflineRaid:'离线战局物品返还参数',CoefOfHavingMarkOfUnknown:'未知标记系数',CoefOfSendingMessageTime:'返还通知时间系数',EditionSendingMessageTime:'各版本返还通知时间',MaxStorageTimeInHour:'返还物品保存时间',OnlyInDeathCase:'仅在死亡后返还',
  ItemEnhancementSettings:'维修强化效果',MinimumLevelToApplyBuff:'获得强化所需等级',RepairStrategies:'维修方式',armorClassDivisor:'护甲等级除数',durabilityPointCostArmor:'护甲每点耐久维修成本系数',durabilityPointCostGuns:'武器每点耐久维修成本系数',GlobalDamageDegradationCoefficient:'远距离伤害衰减系数',
  AutoshotChance:'过热走火概率参数',AutoshotMinOverheat:'开始走火的热量阈值',AutoshotPossibilityDuration:'走火判定持续时间',BarrelMoveMaxMult:'枪管偏移最大倍率',BarrelMoveRndDuration:'枪管随机偏移持续时间',DurReduceMaxMult:'耐久消耗最大倍率',DurReduceMinMult:'耐久消耗最小倍率',
  EnableSlideOnMaxOverheat:'最大过热时允许枪机故障',FirerateOverheatBorder:'射速变化热量阈值',FireratePitchMult:'射速音调倍率',FirerateReduceMaxMult:'射速变化最大倍率',FirerateReduceMinMult:'射速变化最小倍率',FixSlideOverheat:'枪机恢复热量阈值',MaxCOIIncreaseMult:'散布最大增幅倍率',
  MaxMalfChance:'最高故障概率参数',MinMalfChance:'最低故障概率参数',MaxOverheat:'最大热量',MinOverheat:'最低热量',MaxOverheatCoolCoef:'最大过热冷却系数',MaxWearOnMaxOverheat:'最大过热耐久损耗上限',MinWearOnMaxOverheat:'最大过热耐久损耗下限',MaxWearOnOverheat:'过热耐久损耗上限',MinWearOnOverheat:'过热耐久损耗下限',ModCoolFactor:'配件冷却系数',ModHeatFactor:'配件产热系数',OverheatProblemsStart:'过热故障起始阈值',OverheatWearLimit:'过热磨损阈值',StartSlideOverheat:'枪机故障热量阈值',
  AllowMalfForBots:'AI 武器允许故障',AmmoFeedWt:'弹药供弹故障权重',AmmoJamWt:'弹药卡壳权重',AmmoMalfChanceMult:'弹药故障概率倍率',AmmoMisfireWt:'弹药哑火权重',DurFeedWt:'耐久导致供弹故障的权重',DurHardSlideMaxWt:'耐久导致严重枪机故障的最高权重',DurHardSlideMinWt:'耐久导致严重枪机故障的最低权重',DurJamWt:'耐久导致卡壳的权重',DurMisfireWt:'耐久导致哑火的权重',DurRangeToIgnoreMalfs:'忽略故障的耐久范围',DurSoftSlideWt:'耐久导致轻微枪机故障的权重',
  MagazineMalfChanceMult:'弹匣故障概率倍率',MalfRepairHardSlideMult:'严重枪机故障排除倍率',MalfRepairOneHandBrokenMult:'单臂骨折排障倍率',MalfRepairTwoHandsBrokenMult:'双臂骨折排障倍率',TimeToQuickdrawPistol:'快速切换手枪时间',OverheatFeedWt:'过热导致供弹故障的权重',OverheatJamWt:'过热导致卡壳的权重',OverheatSoftSlideWt:'过热导致轻微枪机故障的权重',OverheatHardSlideMaxWt:'过热导致严重枪机故障的最高权重',OverheatHardSlideMinWt:'过热导致严重枪机故障的最低权重',ShowGlowAttemptsCount:'显示提示的尝试次数',IdleToOutSpeedMultOnMalf:'故障时收枪速度倍率',OutToIdleSpeedMultForPistol:'手枪就绪速度倍率',
  AimRangeFinderDrainRate:'测距仪瞄准耐力消耗',BaseHoldBreathConsumption:'基础屏息耐力消耗',ClimbLegsConsumption:'攀爬腿部消耗参数',ClimbOneHandConsumption:'单手攀爬消耗参数',ClimbTwoHandsConsumption:'双手攀爬消耗参数',CrouchConsumption:'下蹲耐力消耗参数',CrouchLevelConsumptionMultipliers:'蹲姿高度消耗倍率',ExhaustedMeleeSpeed:'力竭近战速度',FatigueAmountToCreateEffect:'触发疲劳的累积量',FatigueRestorationRate:'疲劳恢复参数',HoldBreathStaminaMultiplier:'屏息耐力倍率',OverweightConsumptionByPose:'各姿态超重消耗参数',PoseLevelConsumptionPerNotch:'姿态每档调整消耗',PoseLevelDecreaseSpeed:'降低姿态速度',PoseLevelIncreaseSpeed:'抬高姿态速度',SafeHeightOverweight:'超重安全落差',SoundRadius:'声音传播范围参数',SprintAccelerationLowerLimit:'冲刺加速度下限',SprintSensitivityLowerLimit:'冲刺灵敏度下限',SprintSpeedLowerLimit:'冲刺速度下限',StaminaExhaustionCausesJiggle:'力竭导致武器晃动',StaminaExhaustionRocksCamera:'力竭导致视角晃动',StaminaExhaustionStartsBreathSound:'力竭时播放喘息',StandupConsumption:'起身消耗参数',TransitionSpeed:'姿态切换速度参数',VaultLegsConsumption:'翻越腿部消耗参数',VaultOneHandConsumption:'单手翻越消耗参数',WalkConsumption:'步行消耗参数',WalkVisualEffectMultiplier:'步行视效倍率',PoseLevel:'姿态高度',
  Minimum:'最低值',Maximum:'最高值',Default:'默认值',Base:'基础值',Multiplier:'倍率',Limit:'上限',Threshold:'阈值',
  COEF_IF_MOVE:'移动时修正系数',FIRST_CONTACT_ADD_SEC:'首次接触额外时间',HearingSense:'听觉灵敏度系数',MAX_AIMING_UPGRADE_BY_TIME:'瞄准随时间提升上限',SCATTERING_DIST_MODIF:'距离散布修正',ScatteringPerMeter:'每米散布参数',UseThis:'启用该预设',VISIBILITY_CHANGE_SPEED:'可见度变化速度',VisibleAngle:'视野角度',VisibleDistance:'视野距离',
};
const units={
  Weight:'kg',BulletMassGram:'g',BulletDiameterMilimeters:'mm',InitialSpeed:'m/s',SightingRange:'m',CalibrationDistances:'m',
  Width:'格',Height:'格',StackMaxSize:'件',MaxHpResource:'点',Damage:'点',MaxDurability:'点',Durability:'点',armorClass:'级',
  bFirerate:'发/分钟',SingleFireRate:'发/分钟',productionTime:'seconds',medUseTime:'seconds',foodUseTime:'seconds',
  EscapeTimeLimit:'minutes',ExfiltrationTime:'seconds',ExfiltrationTimePVE:'seconds',activateAfterSec:'seconds',DelayToCanSpawnSec:'seconds',
  startDelay:'seconds',endDelay:'seconds',FragmentationChance:'fraction',RicochetChance:'fraction',BluntThroughput:'fraction',
  LightBleedingDelta:'percentagePoints',HeavyBleedingDelta:'percentagePoints',ArmorDamage:'percent',speedPenaltyPercent:'signedPercent',mousePenalty:'signedPercent',weaponErgonomicPenalty:'signedPercent',
  MinRepairDegradation:'fraction',MaxRepairDegradation:'fraction',MinRepairKitDegradation:'fraction',MaxRepairKitDegradation:'fraction',
  DurabilityBurnModificator:'multiplier',HeatFactor:'multiplier',generatorSpeedWithoutFuel:'multiplier',
  offerDurationTimeInHour:'hours',maxRenewOfferTimeInHour:'hours',offerDurationTimeInHourAfterRemove:'hours',
  youSellOfferMaxStorageTimeInHour:'hours',yourOfferDidNotSellMaxStorageTimeInHour:'hours',uniqueBuyerTimeoutInDays:'天',
  minUserLevel:'级',RagfairLevelToTrade:'级',requiredLevel:'级',areaLevel:'级',RequiredPlayerLevelMin:'级',RequiredPlayerLevelMax:'级',
  MaxStorageTimeInHour:'hours',AutoshotPossibilityDuration:'seconds',BarrelMoveRndDuration:'seconds',TimeToQuickdrawPistol:'seconds',SafeHeightOverweight:'m',
  Zooms:'倍',ProjectileCount:'颗',buckshotBullets:'颗',MaximumNumberOfUsage:'次',MaxUsages:'次',
  maxSumForDecreaseRatingPerOneSale:'卢布',maxSumForIncreaseRatingPerOneSale:'卢布',ratingSumForDecrease:'卢布',ratingSumForIncrease:'卢布',
  FIRST_CONTACT_ADD_SEC:'seconds',VisibleAngle:'°',VisibleDistance:'m',
};
export function readableNumber(value){
  if(!Number.isFinite(value))return '未提供';
  // Keep small non-zero settings meaningful instead of rounding them to zero.
  return value.toLocaleString('zh-CN',{maximumSignificantDigits:6});
}
export function duration(value){
  if(!Number.isFinite(value))return '未提供';
  if(value<0)return `特殊值 ${value}（未设定常规时长）`;
  if(value===0)return '0 秒';
  const seconds=Math.round(value*1000)/1000;
  let left=seconds;const parts=[];
  for(const [scale,unit] of [[86400,'天'],[3600,'小时'],[60,'分钟']]){
    const n=Math.floor(left/scale);if(n){parts.push(`${n} ${unit}`);left=Math.round((left-n*scale)*1000)/1000;}
  }
  if(left)parts.push(`${readableNumber(left)} 秒`);
  return parts.join(' ');
}
export function formatNumber(value,key,path=''){
  if(!Number.isFinite(value))return '未提供';
  let unit=extraUnits[key]||units[key];
  if(key==='MinDurability'&&path.includes('BuyoutRestrictions'))unit='fraction';
  if(/^Bot(?:ApplySilence|Follow|GetInCover|Help|Spreadout|Stop)Chance$/.test(key)&&path.includes('FenceSettings'))unit='percent';
  if(['energy','hydration'].includes(key)&&path.startsWith('hideout'))unit='点';
  if(key==='time'&&path.startsWith('hideout.results'))unit='seconds';
  if(key==='multiplier'&&path.startsWith('hideout.results'))unit='multiplier';
  if(['minDurability','maxDurability'].includes(key)&&/conditions|requirements/.test(path))unit='percent';
  if(key==='value'&&path.startsWith('market.maxSumForRarity'))unit='卢布';
  if(['delay','duration','fadeOut','Duration','Delay'].includes(key)&&/effects_|Buffs|bosses/.test(path))unit='seconds';
  if(['start','end'].includes(key)&&/subtitles/.test(path))unit='seconds';
  if(key==='time'&&/transits/.test(path))unit='seconds';
  if(['Chance','ChancePVE','BossChance'].includes(key)&&/maps|bosses/.test(path))unit='percent';
  if(key==='Chance'&&/Buffs/.test(path))unit='fraction';
  if(key==='value'&&/effects_health/.test(path))unit='点';
  if(unit==='kg')return value>0&&value<1?`${readableNumber(value*1000)} g`:`${readableNumber(value)} kg`;
  if(unit==='seconds')return duration(value);
  if(unit==='minutes')return duration(value*60);
  if(unit==='hours')return duration(value*3600);
  if(unit==='fraction')return `${readableNumber(value*100)}%`;
  if(unit==='percentagePoints')return `${value>0?'+':''}${readableNumber(value*100)} 个百分点`;
  if(unit==='percent'||unit==='signedPercent')return `${unit==='signedPercent'&&value>0?'+':''}${readableNumber(value)}%`;
  if(unit==='multiplier')return `${readableNumber(value)} 倍`;
  return `${readableNumber(value)}${unit?' '+unit:''}`;
}
const enums={
  ExfiltrationType:{Individual:'个人撤离',SharedTimer:'共用倒计时',Manual:'手动触发'},
  PassageRequirement:{None:'无额外要求',TransferItem:'交付物品',WorldEvent:'满足场景事件',Empty:'指定装备槽为空',HasItem:'携带指定物品',SkillLevel:'满足技能等级',Train:'列车撤离',ScavCooperation:'PMC 与 Scav 合作',Timer:'等待开放',Reference:'另有装备或场景条件，需在游戏内确认'},
  RequiredSlot:{FirstPrimaryWeapon:'第一主武器',SecondPrimaryWeapon:'第二主武器',Backpack:'背包',ArmorVest:'防弹衣',TacticalVest:'战术胸挂',Headwear:'头部装备',Scabbard:'近战武器'},
  TriggerName:{interactObject:'交互物件',botEvent:'AI 事件','':'无'},
  type:{ShrinkingCircle:'缩圈判定',ExtraDailyQuest:'增加每日任务',CustomizationDirect:'外观奖励',Skill:'技能经验',Stub:'占位记录',Item:'物品奖励',Resource:'资源消耗',GameVersion:'游戏版本要求',MusclePain:'肌肉酸痛',GymArmTrauma:'训练导致手臂受伤',Health:'身体状态要求',BodyPartBuff:'部位状态要求',Tool:'需要工具',Area:'设施要求',QuestComplete:'完成任务'},
  result:{Exit:'结束本轮训练',None:'未要求结束训练'},
  key:{Mouse0:'鼠标左键'},compareMethod:{'>=':'至少','<=':'不高于','==':'等于','>':'高于','<':'低于','!=':'不等于'},
  ArmorType:{Heavy:'重型护甲',Light:'轻型护甲',None:'无'},
  sourceKind:{items:'物品',prestige:'转生',crafts:'制作',offers:'交易','main-quest-note-link':'主线笔记关联','item-quest-condition':'物品任务条件','prestige-condition':'转生条件'},
};
export const languages={ch:'中文',cz:'捷克语',en:'英语',es:'西班牙语','es-mx':'西班牙语（拉丁美洲）',fr:'法语',ge:'德语',hu:'匈牙利语',in:'印度尼西亚语',it:'意大利语',jp:'日语',kr:'韩语',pl:'波兰语',po:'葡萄牙语',ro:'罗马尼亚语',ru:'俄语',sk:'斯洛伐克语',th:'泰语',tu:'土耳其语',vi:'越南语'};
const difficulty={easy:'简单',normal:'普通',hard:'困难',impossible:'极难'};
const bodyParts={HeadCommon:'头部',ParietalHead:'头顶',BackHead:'后脑',Ears:'耳部',Eyes:'眼部',Jaw:'下颌',NeckFront:'颈前',NeckBack:'颈后',RibcageUp:'上胸',RibcageLow:'下胸',Pelvis:'骨盆正面',PelvisBack:'骨盆背面',LeftUpperArm:'左上臂',RightUpperArm:'右上臂',SpineDown:'下背',SpineTop:'上背',LeftSideChestDown:'左侧下胸',RightSideChestDown:'右侧下胸'};
export function enumText(value,key,path='',names={}){
  if(['ProfileVersions','AvailableVersions','availableInGameEditions','gameVersions'].includes(key))return names[value]||value;
  if(['bodyPart','effectName','skillId'].includes(key))return names[value]||readerNames[value]||extraLabels[value]||value;
  if(['armorColliders','armorZone','BodyPartPriority'].includes(key))return bodyParts[value]||readerNames[value]||names[value]||value;
  if(key==='armorPlateColliders')return ({Plate_Granit_SAPI_chest:'前胸插板',Plate_Granit_SAPI_back:'后背插板',Plate_6B13_back:'6B13 后背插板',Plate_Korund_chest:'Korund 前胸插板',Plate_Granit_SSAPI_side_right_low:'右侧下部插板',Plate_Granit_SSAPI_side_right_high:'右侧上部插板',Plate_Granit_SSAPI_side_left_high:'左侧上部插板',Plate_Granit_SSAPI_side_left_low:'左侧下部插板',Plate_Korund_side_left_high:'Korund 左侧上部插板',Plate_Korund_side_right_high:'Korund 右侧上部插板',Plate_Korund_side_left_low:'Korund 左侧下部插板',Plate_Korund_side_right_low:'Korund 右侧下部插板'})[value]||value;
  if(['BossDifficult','BossEscortDifficult','BotDifficulty','Difficulty','difficulty','BotPreset'].includes(key))return difficulty[value]||value;
  if(['SkillName','BuffType','skill'].includes(key))return names[value]||readerNames[value]||value;
  if(['gameMode','SpawnMode'].includes(key))return ({regular:'PvP 常规',pve:'PvE','pvp-season':'PvP 赛季',arena:'Arena'})[value]||value;
  if(key==='FireMode')return translatedValue(value,'weapFireType');
  if(key==='linkKind')return enums.sourceKind[value]||value;
  if(['Caliber','ammoCaliber'].includes(key))return caliberLabel(value).replace('gauge','号径');
  return enums[key]?.[value]??translatedValue(value,key);
}
export function readerLabel(key,path='',names={}){
  if(key==='MinDurability'&&path.includes('BuyoutRestrictions'))return '商人回购的最低耐久比例';
  if(key==='level'&&path==='mechanics.exp')return '等级与经验';
  if(key==='Value'&&path.startsWith('mechanics'))return '配置数值';
  if(path.includes('effects_damage')){
    const treatments={Pain:'镇痛',Contusion:'缓解震荡',LightBleeding:'止住轻度出血',HeavyBleeding:'止住重度出血',Fracture:'治疗骨折',DestroyedPart:'修复损毁部位',Intoxication:'治疗中毒',RadExposure:'处理辐射暴露'};
    if(treatments[key])return treatments[key];
  }
  if(key==='Chance'&&path.startsWith('maps'))return '出现概率（配置）';
  // x/y/z are reused for many parameter vectors. They are only coordinates in a position/center context.
  if(['x','y','z'].includes(key))return /Position|Center/.test(path)?`${key.toUpperCase()} 坐标`:`${key.toUpperCase()} 分量`;
  if(path.endsWith('ArmorMaterials'))return translatedValue(key,'ArmorMaterial');
  if(key==='Common'&&/endProducts|maxSumForRarity/.test(path))return '普通';
  const label=extraLabels[key]||readerNames[key]||fieldNames[key]||names[key]||null;
  return label&&units[key]?label.replace(/（(?:kg|g|m\/s|秒|分钟|小时|天|%|格|发\/分钟)）/g,''):label;
}
export function readerNote(key,path=''){return extraNote(key,path)||({
  generatorSpeedWithoutFuel:'以正常制作速度为 1 倍；小于 1 表示制作更慢。',
  generatorFuelFlowRate:'燃料消耗的原始参数；计时单位尚未核定，不直接换算为每小时用量。',
  airFilterUnitFlowRate:'空气过滤资源消耗的原始参数；计时单位尚未核定。',
  Destructibility:'用于计算护甲耐久损耗的系数；数值越大，相同伤害下损耗通常越高。',
  LightBleedingDelta:'这是概率的增减量。例如 +10 个百分点，不代表最终概率只有 10%。',
  HeavyBleedingDelta:'这是概率修正，不是命中后必然出血。',
  ArmorDamage:'弹药对护甲的伤害比例参数，不等于直接扣除的耐久点数。',
  BluntThroughput:'未击穿时的钝伤透过比例；实际伤害还受护甲等因素影响。',
})[key]||fieldNotes[key]||'';}
const technicalKeys=new Set(['id','Id','ID','_id','parentId','ParentId','_parent','_name','internalName','name','Prefab','UsePrefab','ItemSound','DropSoundType','AnimationVariantsNumber','ExamineExperience','LootExperience','ExaminedByDefault','BackgroundColor','Description','ShortName','Name','StimulatorBuffs','RarityPvE','QuestConditions','StackObjectsCount','_tpl','_type','path','rcid','AssetPath','image','bigImage','illustrationConfig','props','dynamicLocale','globalQuestCounterId','dialogId','questNoteId','entryPoint','fromTraderId','index','Order','original','code','TriggerId','BossZone','BotZoneName','CorePointId','Infiltration','SpawnPoints','EntryPoints','RequirementTip','Source','Destination']);
export function isTechnical(key){return technicalKeys.has(key)||/Prefab|Animator|Animation|Audio|Sound|^DiscardLimit$/.test(key);}
export function isIdentifier(value){return typeof value==='string'&&(/^[a-f0-9]{24}$/i.test(value)||/^\/files\/|\.bundle$|^BotZone|^EXFIL_|^INT_TRANSIT_|^Buffs|^mod_/.test(value));}
export function sectionNote(id,fallback){return ({
  items:'查伤害、穿透、防护和使用效果。价格为手册基准价，不是实时跳蚤行情。',
  maps:'先看人数、战局时长与撤离要求；场景变体单独列出。',
  mechanics:'按系统查看规则。数值采用已保存的资料，未确认单位的系数保留原值。',
  story:'这里收录章节和任务关联索引。查看任务目标与进度，请前往顶部“任务”。',
  media:'按时间轴阅读已收录的官方字幕；目前不提供音频播放。',
  crafts:'区分消耗材料、工具、资源点及解锁要求。制作时间为基础值，任务关联单独说明。',
  prestige:'查看转生条件、奖励及可转移内容；模式与版本限制分别列出。',
  languages:'支持语言及已收录的中文提示。',
  hideout:'查看设施参数和健身房训练步骤。',
})[id]||fallback;}
export function presentEntry(row,section,names={},index=0){
  const r={...row,originalName:row.name};
  if(section==='languages'&&languages[r.id])r.name=languages[r.id];
  if(names[r.id]&&section!=='bosses'&&section!=='items')r.name=names[r.id];
  if(section==='mechanics'||section==='market'||section==='hideout')r.name=readerLabel(r.id,'',names)||r.name;
  if(section==='crafts'&&Number.isFinite(r.detail?.productionTime))r.subtitle=`制作 ${duration(r.detail.productionTime)} · 产出 ${r.detail.count??'未提供'} 件`;
  if(section==='crafts'&&r.detail?.endProducts)r.subtitle=`等待 ${duration(r.detail.productionTime)} · 随机产出，按稀有度列出数量范围`;
  if(section==='prestige'){r.name=r.name.replace(/声望/g,'转生');r.group=r.group.replace(/声望/g,'转生');r.subtitle=r.subtitle?.replace(/声望/g,'转生');}
  if(section==='media')r.subtitle=`${r.detail?.subtitles?.length||0} 段字幕 · 可阅读时间轴`;
  if(section==='story'&&isIdentifier(r.subtitle))r.subtitle=names[r.subtitle]||'章节名称尚未收录';
  if(section==='maps'){
    r.subtitle=r.subtitle===r.id?'常规场景':r.subtitle;
    r.facts=[['时限',duration(r.detail.EscapeTimeLimit*60)],['人数',`${r.detail.MinPlayers}–${r.detail.MaxPlayers} 人`]];
  }
  if(section==='items')r.facts=r.facts?.map(([k,v])=>[k,typeof v==='string'&&/^\d*\.?\d+ kg$/.test(v)?formatNumber(parseFloat(v),'Weight'):k==='占格'?v+' 格':v]);
  if(section==='handbook')r.subtitle=r.detail.RagfairLevelToTrade==null?'未单独设定交易等级':`交易等级 ${r.detail.RagfairLevelToTrade} 级`;
  if(section==='customization'&&/[_]|^[a-f0-9]{24}$/.test(r.name))r.name=`${r.group}资料 ${index+1}（名称未收录）`;
  if(section==='customization'&&r.group==='分类模板'&&!Object.keys(r.detail||{}).length)r.name=`外观分类模板 ${index+1}`;
  if(/^[a-f0-9]{24}$/.test(r.name))r.name=`${r.group}记录 ${index+1}`;
  if(r.group==='Lighthouse')r.group='灯塔';
  r.search=[row.search,r.name,r.subtitle].filter(Boolean).join(' ').toLowerCase();
  return r;
}
