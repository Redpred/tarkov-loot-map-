import {LOOT_CATEGORIES,LEGACY_LOOT_FAMILIES,normalizeLootFamily,templateLootFamily} from './atlas-loot-category-policy.js';
import {ITEM_LOOT_FAMILIES} from './data/loot-categories.js';
export {LEGACY_LOOT_FAMILIES};

// Exact children of BattlePassDocument (6a28212a0368f4438b0d0a45) in the
// active SPT 1ee2b75 templates. Resolve at runtime so existing versioned loot
// and prepared item indexes remain valid; names alone do not define this type.
export const SEASON_DOCUMENTS=new Set([
  '6a317b9692cfdcddcb02a58e', // PMC 个人档案
  '6a31807f17005505b70d5827', // 财务文件
  '6a3181f178450ec91c0ea1aa', // 项目文件
  '6a31824878450ec91c0ea1ae', // 蓝图与技术文档
  '6a31828557705071410ca00e', // 测试文档
  '6a3182b72fd891345e047eef', // 员工文档
  '6a3182dc6cd8de21cf0a3a7d', // 医疗文件
  '6a31830dde69ceafd805afa0', // 技术文档
  '6a3183258f113efdb7093622', // 秘密文件（当前地图无候选点）
]);
// Classification uses all eligible root candidates, never the current search
// results, attached weapon parts, or a conversion of weights into probabilities.
export const FAMILIES=LOOT_CATEGORIES;
export function itemMarkerFamily(tpl,templates){
  return Object.hasOwn(ITEM_LOOT_FAMILIES,tpl)?ITEM_LOOT_FAMILIES[tpl]:templateLootFamily(tpl,templates);
}

export const CONTAINERS={
  '6ab0ec1bf193bffd360d9d10':['map-container_cash-register','收银机 TAR2-2'],
  '6a8d772580569cbd9a0332be':['map-container_crate','撬开的医疗物资箱'],
  '6a8d758da91ec469b7006699':['technical-crate','撬开的技术物资箱'],
  '6a8d775c1bfd020505051676':['map-container_crate','撬开的配给物资箱'],
  '6a8d777cac12ffbbc2013fe3':['crate','撬开的木制板条箱'],
  '6a8d8368ac12ffbbc201438d':['body','USEC 尸体'],
  '658420d8085fea07e674cdb6':['body','死去的平民'],
  '6582e6c6edf14c4c6023adf2':['body','实验室技术员尸体'],
  '6582e6bb0c3b9823fe6d1840':['body','Scav 尸体'],
  '6a6a4b2d0e3d3ccf830a7e7d':['body','PMC 尸体'],
  '6a6a4caf52af1d96d90e9b35':['body','平民尸体'],
  '6a6a4c751cac0620b20ad5fb':['safe','保险箱'],
  '6a6a4c0152af1d96d90e9b2f':['weapon-box','武器箱'],
  '6a6a5d72aea4403293078e59':['medbag','医疗包'],
  '5d6d2b5486f774785c2ba8ea':['crate','物资埋藏箱'],
  '5937ef2b86f77408a47244b3':['jacket','黄色夹克'],
  '59387ac686f77401442ddd61':['jacket','夹克'],
  '5914944186f774189e5e76c2':['jacket','夹克'],
  '6aa31b9cc7786a441c08d085':['safe','保险箱弹药隔间'],
  '67adf4db515e3dd542077a1d':['crate','木制板条箱'],
  '67adf4eb110ba15da90c6413':['grenade-box','手榴弹箱'],
  '67adf5f7adc1f43b0702b826':['technical-crate','技术物资箱'],
  '67adf4b81c58bd68b2002fec':['map-container_wooden-ammo-box','木制弹药箱'],
  '67adf5752fc5ee84020a9940':['body','Scav 尸体'],
  '67adf4a95247ac91530fcec7':['jacket','夹克'],
  '67adf54d1c58bd68b2002ff0':['toolbox','工具箱'],
  '61aa1e9a32a4743c3453d2cf':['duffle','旅行包'],
  '61aa1ead84ea0800645777fd':['medbag','SMU06 医疗包'],
  '6851450d30cad62593003fa8':['body','士兵尸体'],
  '69122598e5b8725fb10f6a93':['body','士兵尸体'],
  '69122762e5b8725fb10f6b32':['weapon-box','武器箱'],
  '691226272a5ee538f10d2f11':['safe','保险箱'],
  '68a5b9af76a25d8e6e0e2e56':['crate','装备柜'],
  '67a0e494e8fc6968ef0fc9da':['crate','装备柜'],
  '5d07b91b86f7745a077a9432':['crate','公共基金储藏处'],
  '578f879c24597735401e6bc6':['map-container_cash-register','收银机'],
  '5ad74cf586f774391278f6f0':['map-container_cash-register','大型收银机'],
  '64d116f41a9c6143a956127d':['map-container_cash-register','银行收银柜'],
  '64d11702dd0cd96ab82c3280':['safe','银行保险箱'],
  '5d6d2bb386f774785b07a77a':['map-container_buried-barrel-cache','物资埋藏桶'],
  '59139c2186f77411564f8e42':['map-container_pc-block','电脑机箱'],
  '5909d7cf86f77470ee57d75a':['weapon-box','武器箱'],
  '5909d89086f77472591234a0':['weapon-box','大型武器箱'],
  '5909d45286f77465a8136dc6':['map-container_wooden-ammo-box','木制弹药箱'],
  '5909d4c186f7746ad34e805a':['map-container_medcase','医药箱'],
  '5c052cea86f7746b2101e8d8':['map-container_plastic-suitcase','塑料手提箱'],
  '5d6fe50986f77449d97f7463':['map-container_crate','医疗物资箱'],
  '5d6fd13186f77424ad2a8c69':['map-container_crate','配给物资箱'],
  '578f87ad245977356274f2cc':['crate','木制板条箱'],
  '5d6fd45b86f774317075ed43':['technical-crate','技术物资箱'],
  '6582e6d7b14c3f72eb071420':['body','PMC 尸体'],
  '5909e4b686f7747f5b744fa4':['body','Scav 尸体'],
  '66acff0a1d8e1083b303f5af':['safe','银行保险箱'],
  '578f8782245977354405a1e3':['safe','保险箱'],
  '578f87a3245977356274f2cb':['duffle','旅行包'],
  '578f8778245977358849a9b5':['jacket','夹克'],
  '5909d24f86f77466f56e6855':['medbag','医疗包'],
  '5909d36d86f774660f0bb900':['grenade-box','手榴弹箱'],
  '5909d50c86f774659e6aaebe':['toolbox','工具箱'],
  '578f87b7245977356274f2cd':['drawer','抽屉'],
  '5909d76c86f77471e53d2adf':['weapon-box','武器箱'],
  '5909d5ef86f77467974efbd8':['weapon-box','武器箱'],
};

export const looseMarkerFamily=(tpl,data)=>SEASON_DOCUMENTS.has(tpl)?'season_document':Object.hasOwn(ITEM_LOOT_FAMILIES,tpl)?ITEM_LOOT_FAMILIES[tpl]:normalizeLootFamily(data.items[tpl]?.markerFamily);

export function classifyPointMarker(point,data,icons={items:{}}){
  if(point.kind==='container'){
    const [key,label]=CONTAINERS[point.containerTpl]||['crate',data.items[point.containerTpl]?.zh||'容器'];
    return {key,label,mode:'container',description:`容器外观示意：${label}；点击查看内容物候选池。`};
  }
  const unique=[...new Set((point.candidates||[]).filter(c=>c.weight==null||c.weight>0).map(c=>c.tpl))];
  if(!unique.length)return {key:'other',label:'候选物资未知',mode:'unknown',description:'未收录可用候选物资。'};
  if(unique.length===1&&icons.items[unique[0]]){
    const label=data.items[unique[0]]?.zh||unique[0];
    return {key:icons.items[unique[0]],label,mode:'item',description:`物品图标：${label}；候选池仅收录这一种，不代表每局必出。`};
  }
  const families=[...new Set(unique.map(tpl=>looseMarkerFamily(tpl,data)))];
  // Unknown plus known candidates is still mixed; never hide an unknown class.
  const family=families.length===1?families[0]:'mixed';
  const label=family==='mixed'?'混合物资':(FAMILIES[family]||FAMILIES.other)[0];
  return {key:family,label,mode:family==='mixed'?'mixed':'category',
    description:`${label} · ${unique.length} 种候选；${family==='mixed'?'跨类别候选使用混合图标':'图标仅代表类型，并非固定刷新图中物品'}。`};
}
