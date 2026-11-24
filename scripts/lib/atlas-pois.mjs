import {atlasToUnity} from './factory-data.mjs';
import {POI_TYPES} from '../../site/atlas-point-types.js';
import {createExfilLocalizer} from './atlas-exfil-names.mjs';

export function buildAtlasPois(atlas,base,locales={},sptSource={version:'4.1.2',eftBuild:40743}){
  const points=[],items={},skipped={inactive:0,unknownSpawnMask:0};
  const name=id=>locales.ch?.[`${id} Name`]||locales.en?.[`${id} Name`]||id;
  const item=id=>{if(id)items[id]={tpl:id,zh:name(id),en:locales.en?.[`${id} Name`]||id};};
  const exfilName=createExfilLocalizer(locales);
  function add(row,types,label,note,extra={}){
    if(row.active===false){skipped.inactive++;return;}
    const position=atlasToUnity(row.pos);if(!position)return;
    const sourceId=String(row.id||row.name||label),id=`poi:${types[0]}:${sourceId}:${row.lv??''}:${row.pos.join(',')}`;
    points.push({id,sourceId,kind:'poi',poiTypes:types,label,position,positionSource:'atlas-client',sceneLevel:row.lv,
      icon:POI_TYPES[types[0]][1],note,source:'Atlas 当前客户端场景',
      outline:(row.outline||[]).map(atlasToUnity).filter(Boolean),...extra});
  }
  for(const row of atlas.exfils||[]){
    const faction=['pmc','scav','shared'].includes(row.faction)?row.faction:'secret';
    const localized=exfilName(row);
    add(row,['extract_'+faction],localized.label,'客户端撤离触发区域。是否开放、所需条件与阵营资格由对局决定；这里只显示场景记录。',{faction,...localized});
  }
  for(const row of atlas.transit_points||[])add(row,['transit'],row.name,'客户端地图转移触发区域；具体开放条件以对局为准。');
  for(const row of atlas.doors||[])if(row.kind==='door'&&typeof row.key_id==='string'&&row.key_id.trim()){
    item(row.key_id);add(row,['locked_door'],`上锁的门 · ${name(row.key_id)}`,'钥匙 ID 直接来自客户端门对象；显示的是初始门状态。',{keyId:row.key_id,doorState:row.state});
  }
  for(const row of atlas.stationary||[]){
    const type=row.weapon_id==='5d319c3748f0354602135916'?'machinegun':row.weapon_id==='5d7296aea4b93651e424b443'?'grenade_launcher':'stationary';
    item(row.weapon_id);add(row,[type],`${POI_TYPES[type][0]} · ${name(row.weapon_id)||row.name}`,'固定武器位置来自客户端，弹药和可用状态依对局而定。',{weaponId:row.weapon_id});
  }
  for(const row of [...(atlas.minefields||[]),...(atlas.mines_directional||[])])add(row,['mine'],row.kind||'地雷区','危险物体 / 触发器位置。轮廓仅为已提取的触发器投影，不是完整爆炸半径或安全边界。');
  for(const row of atlas.sniper_zones||[])add(row,['sniper_zone'],'边界狙击危险区','这是越界狙击触发区，不是可击杀的狙击 Scav；轮廓为客户端触发器的水平投影。');
  for(const row of atlas.spawn_points||[]){
    const types=[],cats=row.categories||[],side=row.side||'';
    if(cats.includes('player')){
      if(['all','pmc','usec','bear','usec+savage','bear+savage'].includes(side))types.push('spawn_pmc');
      if(['all','savage','usec+savage','bear+savage'].includes(side))types.push('spawn_scav');
    }
    if(cats.includes('bot')&&['all','savage','usec+savage','bear+savage'].includes(side))types.push('scav_ai');
    if(row.zone?.startsWith('ZoneSnipe')&&cats.includes('bot'))types.push('sniper');
    if(!types.length){if(cats.some(c=>c.startsWith('bit')))skipped.unknownSpawnMask++;continue;}
    // Prefer the sniper icon for explicitly named sniper bot zones.
    if(types.includes('sniper'))types.unshift(types.splice(types.indexOf('sniper'),1)[0]);
    add(row,types,types.map(t=>POI_TYPES[t][0]).join(' / '),'客户端候选生成位置，不保证本局使用。同一点可同时适用于多个阵营或 AI。未解码的类别位不会被推断成玩家出生点。',{zone:row.zone||null,spawnSide:side,spawnCategories:cats});
  }
  const bossNames={bossBoar:'Kaban / 卡班',bossKolontay:'Kollontay / 科隆泰',bossTagilla:'Tagilla / 塔吉拉',bossBoarSniper:'卡班狙击护卫'};
  for(const boss of base.BossLocationSpawn||[])if(boss.BossName?.startsWith('boss')){
    for(const zone of (boss.BossZone||'').split(',').filter(Boolean)){
      const row=(atlas.bot_zones||[]).find(z=>z.name===zone);if(!row)continue;
      add({...row,id:`${boss.BossName}:${zone}`,outline:[]},['boss'],`${bossNames[boss.BossName]||boss.BossName} · ${zone}`,
        'SPT 的 BOSS 配置通过区域名关联到当前客户端的 AI 区域中心。这是候选区域参考点，不是精确出生坐标；没有将 SPT 权重当作官服刷新率。',
        {zone,boss:boss.BossName,source:`SPT ${sptSource.version} BossLocationSpawn + Atlas 同名 AI 区域`});
    }
  }
  return {version:1,sources:{spt:sptSource},points:[...new Map(points.map(p=>[p.id,p])).values()],items,skipped,
    pending:['BTR 停车点：尚未核验当前版本的停车路径节点。','地区名称：尚未关联可靠的区域名称和边界。']};
}
