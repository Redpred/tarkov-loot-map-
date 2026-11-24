// Presentation only. Raw role IDs, mode flags, probabilities and XYZ stay intact.
// Evidence and review limits: docs/ENCYCLOPEDIA_REVIEW_2026-10-20.md.
export const BOSS_NAMES = {
  bossbully:'Reshala',bossgluhar:'Glukhar',bosskilla:'Killa',bosskojaniy:'Shturman',
  bosssanitar:'Sanitar',bosstagilla:'Tagilla',bossknight:'Knight',followerbigpipe:'Big Pipe',
  followerbirdeye:'Birdeye',bosszryachiy:'Zryachiy',bossboar:'Kaban',bosskolontay:'Kollontay',
  bosspartisan:'Partisan',bosswedge:'The Wedge',bosswedgelab:'The Wedge',bossscourgeeventlab:'Scourge',
  bossbullyblackdiv:'Reshala',bosskillaagro:'Killa',bosstagillaagro:'Tagilla',
  blackdivision:'Black Division',pmcbotblackdiv:'Black Division',pmcbotblackdivseason:'Black Division',
  pmcbot:'Raider',exusec:'Rogue',exusecfree:'Rogue',sectantpriest:'Cultist Priest',
  sectantwarrior:'Cultist Warrior',sectantoni:'Oni',sectantpredvestnik:'Harbinger',
  sectantprizrak:'Ghost',infectedtagilla:'Tagilla',ravangezryachiyevent:'Zryachiy',
  gifter:'Santa Claus',assault:'Scav',marksman:'Sniper Scav',pmcbear:'BEAR',pmcusec:'USEC',
  followerboar:'Kaban 护卫',bossboarsniper:'Kaban 狙击护卫',
  followerboarclose1:'Kaban 近卫（1）',followerboarclose2:'Kaban 近卫（2）',
  followerbully:'Reshala 护卫',followerbullyblackdiv:'Reshala 护卫',
  followergluharassault:'Glukhar 突击护卫',followergluharscout:'Glukhar 侦察护卫',
  followergluharsecurity:'Glukhar 警戒护卫',followergluharsnipe:'Glukhar 狙击护卫',
  followerkojaniy:'Shturman 护卫',followerkolontayassault:'Kollontay 突击护卫',
  followerkolontaysecurity:'Kollontay 警戒护卫',followersanitar:'Sanitar 护卫',
  followertagilla:'Tagilla 护卫',followerzryachiy:'Zryachiy 护卫',followerwedgelab:'The Wedge 护卫',followerscourgeeventlab:'Scourge 护卫',
};
export const bossName = id => BOSS_NAMES[String(id).toLowerCase()] || id;
export const bossFamily = id => ({
  bosswedgelab:'bosswedge',pmcbotblackdiv:'blackdivision',pmcbotblackdivseason:'blackdivision',
  exusecfree:'exusec',
  bossbullyblackdiv:'bossbully',bosskillaagro:'bosskilla',bosstagillaagro:'bosstagilla',
  infectedtagilla:'bosstagilla',ravangezryachiyevent:'bosszryachiy',
})[String(id).toLowerCase()] || String(id).toLowerCase();
export const bossVariant = location => ({
  laboratory_dark:'实验室停电场景',laboratory:'实验室常规场景',
  factory4_day:'白天',factory4_night:'夜间',
})[String(location).toLowerCase()];

export const LAB_CONTEXT = [
  {title:'The Wedge · Blackout 历史活动',text:'The Wedge 曾在停电实验室参与 Blackout（灯火管制）。保存的波次不能说明当前仍会出现；实验室常驻状态未获确认。',url:'https://t.me/s/escapefromtarkovEN?before=6696'},
  {title:'Black Division · 历史活动与赛季规则',text:'官方曾明确调整 Blackout 活动中 PvE 实验室的 Black Division 数量，因此不能笼统称其“只在赛季服出现”。KORD BREACH 的全局规则另有赛季角色限制；当前拉闸后的各模式规则尚未分别核验。',url:'https://t.me/escapefromtarkovEN/6682'},
  {title:'停电场景 · 模式记录有差异',text:'已保存的 48146 版停电实验室中，Black Division 的 6 条波次只标记 PvP 常规；47965 版地图资料的 5 条波次只标记 PvE。两份记录不能合并成当前开放模式，留存点位仅供查阅。'},
];

export const SCOURGE_END='2026-10-26T07:00:00Z';
export function bossBriefing(entry,now=Date.now()) {
  const waves=entry.waves||[entry],roles=waves.map(w=>String(w.role||'').toLowerCase()),notes=[];
  if(roles.includes('bossscourgeeventlab'))notes.push({title:'Scourge Incursion · 灾厄活动',text:
    (now<Date.parse(SCOURGE_END)?'官方已宣布延期至北京时间 2026 年 10 月 26 日 15:00。':'已超过官方公布的结束时间（北京时间 2026 年 10 月 26 日 15:00）；后续是否延长尚未核验。')+
    '10 月 20 日公告还调整了 Scourge 与护卫的生命值、视野、远距离散布及侦测速度。下方是 10 月 20 日保存的波次，100% 配置值与三种模式标记均不代表当前逐模式实测。',url:'https://t.me/escapefromtarkovEN/6935'});
  if(roles.includes('bosspartisan'))notes.push({title:'Partisan · 业力按模式区分',text:'官方公布灯塔、海岸线、森林、海关的基础出现概率为 25%；PvP 常规与赛季的最终概率还受战局内 PMC 业力影响，业力越低越容易出现。保存配置的 PvE 业力依赖标记为关闭，不能把 PvP 公式直接套到 PvE。',url:'https://t.me/escapefromtarkovEN/6916'});
  if(waves.some(w=>w.location==='laboratory_dark'||w.role==='bosswedgelab'))notes.push(...LAB_CONTEXT);
  return notes;
}

export function presentBossWave(w) {
  const name=bossName(w.role),context=bossContext(w);
  return {...w,name,context,search:[w.search,name,context.label,w.role==='bossscourgeeventlab'?'灾厄 Scourge Incursion':''].filter(Boolean).join(' ').toLowerCase()};
}

export function bossContext(w) {
  const raw=w.detail||w.raw||w;
  const role=String(w.role||w.BossName||'').toLowerCase();
  const location=String(w.location||'').toLowerCase();
  if(role==='bosswedgelab'||role==='followerwedgelab')return {
    kind:'history',label:'Blackout 活动记录',rateLabel:'活动留存参数',
    note:'The Wedge 的实验室波次属于 Blackout 活动资料。留存参数不证明活动仍在进行，也不代表当前常驻刷新率。',showRate:false,
  };
  if(location==='laboratory_dark')return {
    kind:'conditional',label:'停电场景留存记录',rateLabel:'停电场景参数',
    note:'此处保存的是停电场景波次。当前触发方式和分模式开放状态未确认，不能将下方参数视为拉闸后必刷。',showRate:false,
  };
  if(/scourge|event|infected/.test(role)||role==='gifter')return {
    kind:'event',label:role==='bossscourgeeventlab'?'Scourge Incursion 活动':'活动配置',rateLabel:'活动参数',
    note:'活动角色配置。是否开放及适用模式需以对应活动为准，配置存在不代表当前已启用。',showRate:false,
  };
  if(w.enabled===false)return {
    kind:'disabled',label:'未启用场景',rateLabel:'留存参数',
    note:'该场景的启用标志为关闭，不能把其波次参数当作当前可遇到的敌人。',showRate:false,
  };
  if((w.modes||[]).length===1&&w.modes[0]==='pvp-season')return {
    kind:'season',label:'赛季配置',rateLabel:'波次配置值',
    note:'此波次仅标记 PvP 赛季。配置值并非实际遭遇概率。',showRate:true,
  };
  if(w.trigger||w.triggered||w.force||w.forceSpawn||w.karma||raw.TriggerName||raw.TriggerId||raw.ForceSpawn||raw.DependKarma||raw.DependKarmaPVE)return {
    kind:'conditional',label:'条件触发',rateLabel:'条件波次参数',
    note:'生成受触发事件、业力或强制生成条件影响。数值只属于这条波次，不是每局或每个点的概率。',showRate:false,
  };
  return {kind:'configuration',label:'波次配置',rateLabel:'波次配置值',note:'数值属于这条波次；模式、场景和其他生成规则仍会影响实际遭遇。',showRate:true};
}

export function presentBossCatalog(catalog) {
  for(const role of catalog.roles) {
    role.searchAliases=[role.name,role.id].join(' ');
    role.name=bossName(role.id);
  }
  for(const a of catalog.appearances) {
    a.variant=bossVariant(a.location)||a.variant;
    a.context=bossContext(a);
  }
  return catalog;
}
