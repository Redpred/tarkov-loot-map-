import {atlasToUnity} from './factory-data.mjs';
import {BOSS_NAMES,bossName} from '../../site/boss-presentation.js';

export const ROLE_NAMES=BOSS_NAMES;
export const ZONE_NAMES={
  BotZoneArmory:'军械库',BotZoneGreenOffice:'绿色办公室',BotZoneGate1:'一号闸门',BotZoneGate2:'二号闸门',
  BotZoneFloor1:'实验室一层',BotZoneFloor2:'实验室二层',BotZoneBasement:'实验室地下层',BotZoneUnderground:'地下区域',
  ZoneDormitory:'宿舍区',ZoneGasStation:'加油站',ZoneScavBase:'Scav 基地区域',ZoneWoodCutter:'伐木场',
  ZoneCarShowroom:'汽车展厅',ZoneSnipeCarShowroom:'汽车展厅狙击区',ZoneClimova:'克里莫夫区域',ZoneMvd:'内务部学院',
  ZonePort:'码头',ZoneGreenHouses:'别墅区',ZoneMeteoStation:'气象站',Zone_Island:'灯塔岛',
  Zone_Chalet:'木屋区',Zone_Hellicopter:'直升机区域',ZoneOLI:'OLI 超市',ZoneIDEA:'IDEA 超市',ZoneGoshan:'Goshan 超市',
  ZoneCenterBot:'商场中央区',ZoneCenter:'商场中央区',ZoneTagilla:'塔吉拉区域',ZoneRailStrorage:'铁路仓储区',
  ZonePTOR2:'维修区',ZoneBarrack:'营房',ZoneSubStorage:'地下仓储区',BotZone:'地图内候选区',
};
export const roleName=bossName;
export const zoneName=id=>ZONE_NAMES[id]||'命名区域';
export const isMainRole=id=>/^(boss|sectantpriest|tagillahelperagro|blackdivision|pmcbotblackdiv)/.test(id)||['followerbigpipe','followerbirdeye','sectantoni','sectantpredvestnik','sectantprizrak','infectedtagilla','ravangezryachiyevent','gifter'].includes(id);
export function configurationProbability(config){
  const p=config.BossChance;
  // Preserve conditional raw values in the audit, but do not publish an
  // unconditional rate when the prerequisite or force-spawn semantics differ.
  return Number.isFinite(p)&&p>=0&&p<=100&&!config.TriggerId&&!config.TriggerName&&!config.DependKarma&&!config.DependKarmaPVE&&!config.ForceSpawn
    ? {value:p,basis:'version-configuration',scope:'wave'}:null;
}
export function verifiedCandidate(spawn,client,{allowBot=false}={}){
  if(!client||client.active!==true||!client.categories?.some(c=>c==='boss'||allowBot&&c==='bot'))return {reason:'client-category-or-active'};
  if(!spawn.Categories?.some(c=>c==='Boss'||allowBot&&c==='Bot'))return {reason:'source-category'};
  const p=atlasToUnity(client.pos),s=spawn.Position;
  if(!p||!['x','y','z'].every(k=>Number.isFinite(s?.[k])))return {reason:'invalid-position'};
  const delta=Math.hypot(p.x-s.x,p.y-s.y,p.z-s.z);
  if(delta>.05)return {reason:'coordinate-difference',delta};
  const props=spawn.ColliderParams?._props,center=props?.Center;
  // Only zero-offset spheres with independently matching exported radii.
  // This is the point's associated collider, never an inferred patrol area.
  const range=spawn.ColliderParams?._parent==='SpawnSphereParams'
    &&center&&['x','y','z'].every(k=>center[k]===0)
    &&Number.isFinite(props.Radius)&&props.Radius>0&&Number.isFinite(client.radius)&&Math.abs(client.radius-props.Radius)<=.01
      ? {type:'sphere',center:[s.x,s.y,s.z],radius:props.Radius,meaning:'point-associated-collider'}:null;
  return {position:{...s},range,delta};
}
const internalSlots=new Set(['Pockets','SecuredContainer']);
export function inventoryGroups(bot){
  const groups=[];
  const add=(kind,id,pool,extra={})=>{
    const items=Object.entries(pool||{}).filter(([,w])=>Number.isFinite(w)&&w>0).map(([tpl,weight])=>({tpl,weight}));
    if(items.length)groups.push({kind,id,items,...extra});
  };
  for(const [slot,pool]of Object.entries(bot.inventory.equipment||{})){
    // BotInventoryGenerator.GetDesiredWeaponsForBot forces a pistol when
    // the primary weapon roll fails, even when the Holster chance is zero.
    const fallbackPistol=slot==='Holster'&&Number.isFinite(bot.chances?.equipment?.FirstPrimaryWeapon)&&bot.chances.equipment.FirstPrimaryWeapon<100;
    if(internalSlots.has(slot)||bot.chances?.equipment?.[slot]===0&&!fallbackPistol)continue;
    add('equipment',slot,pool);
  }
  for(const [container,pool]of Object.entries(bot.inventory.items||{})){
    // A non-empty backpack pool does not mean a backpack is equipped.
    if(['Backpack','TacticalVest'].includes(container)&&bot.chances?.equipment?.[container]===0)continue;
    add(container==='SecuredContainer'?'reserve':'loot',container,pool);
  }
  for(const [caliber,pool]of Object.entries(bot.inventory.Ammo||{}))add('ammo',caliber,pool);
  const mods=new Set();
  for(const slots of Object.values(bot.inventory.mods||{}))for(const choices of Object.values(slots||{})){
    for(const id of Array.isArray(choices)?choices:Object.keys(choices||{}))if(/^[0-9a-f]{24}$/.test(id))mods.add(id);
  }
  function builds(value){
    if(!value||typeof value!=='object')return;
    for(const [k,v]of Object.entries(value)){
      if((k==='_tpl'||k==='tpl')&&typeof v==='string')mods.add(v);
      else if(typeof v==='object')builds(v);
    }
  }
  builds(bot.inventory.weaponBuilds);builds(bot.inventory.equipmentBuilds);
  if(mods.size)groups.push({kind:'mods',id:'mods',items:[...mods].map(tpl=>({tpl}))});
  return groups;
}
