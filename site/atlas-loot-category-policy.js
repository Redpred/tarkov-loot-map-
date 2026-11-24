// Player-facing loot categories. Handbook IDs, not translated item names,
// determine ordinary items; template inheritance covers quest/internal items.
export const LOOT_CATEGORIES={
  battery:['能源物品','battery'],fuel:['易燃物品','fuel'],materials:['建筑材料','materials'],
  electronics:['电子产品','electronics'],household:['日常用品','household'],
  medical:['医疗物资','medical'],stim:['注射器','stim'],key:['钥匙','key'],keycard:['钥匙卡','keycard'],
  tools:['工具','tools'],valuable:['贵重物品','valuable'],weapon:['武器及配件','weapon'],
  equipment:['装备','equipment'],ammo:['弹药','ammo'],provisions:['饮食','provisions'],
  intel:['情报文件','intel'],money:['货币','money'],season_document:['赛季文件','season_document'],other:['其他','other'],
};

// Keep old baked map indexes and imported SVG choices readable without
// rewriting original item pools, task layers or runtime version hashes.
export const LEGACY_LOOT_FAMILIES={
  bandage:'medical',meds:'medical',industrial:'fuel',pistol:'weapon',grenade:'weapon',parts:'weapon',
  backpack:'equipment',armor:'equipment',helmet:'equipment',rig:'equipment',food:'provisions',drink:'provisions',
};
export const normalizeLootFamily=family=>Object.hasOwn(LOOT_CATEGORIES,family)?family:Object.hasOwn(LEGACY_LOOT_FAMILIES,family)?LEGACY_LOOT_FAMILIES[family]:'other';

const templateFamilies={
  Medical:'medical',MedKit:'medical',Drugs:'medical',MedicalSupplies:'medical',Stimulator:'stim',
  Ammo:'ammo',AmmoBox:'ammo',ThrowWeap:'weapon',Food:'provisions',Drink:'provisions',
  Pistol:'weapon',Revolver:'weapon',Weapon:'weapon',Knife:'weapon',
  Mod:'weapon',WeaponMod:'weapon',GearMod:'weapon',FunctionalMod:'weapon',MasterMod:'weapon',
  Backpack:'equipment',Armor:'equipment',ArmoredEquipment:'equipment',Vest:'equipment',TacticalVest:'equipment',
  Headwear:'equipment',Headphones:'equipment',FaceCover:'equipment',Visors:'equipment',Equipment:'equipment',
  Key:'key',KeyMechanical:'key',Keycard:'keycard',KeyCard:'keycard',Jewelry:'valuable',Money:'money',
  Info:'intel',Map:'intel',Flyer:'intel',Electronics:'electronics',Battery:'battery',Fuel:'fuel',Lubricant:'fuel',
  Tool:'tools',Multitools:'tools',RepairKits:'tools',BuildingMaterial:'materials',HouseholdGoods:'household',
  BattlePassDocument:'season_document',
};
export function templateLootFamily(tpl,templates){
  let item=templates[tpl];const seen=new Set();
  while(item&&!seen.has(item._id)){
    seen.add(item._id);
    if(Object.hasOwn(templateFamilies,item._name))return templateFamilies[item._name];
    item=templates[item._parent];
  }
  return 'other';
}

const handbookFamilies={
  '5b47574386f77428ca22b2ed':'battery','5b47574386f77428ca22b2f2':'fuel',
  '5b47574386f77428ca22b2ee':'materials','5b47574386f77428ca22b2ef':'electronics',
  '5b47574386f77428ca22b2f0':'household','5b47574386f77428ca22b2f3':'medical',
  '5b47574386f77428ca22b2f6':'tools','5b47574386f77428ca22b2f1':'valuable',
  '5b47574386f77428ca22b2f4':'other','5b47574386f77428ca22b33e':'other',
  '5b47574386f77428ca22b33f':'equipment','6564b96a189fe36f356d177c':'equipment',
  '5b5f78dc86f77409407a7f8e':'weapon','5b5f71a686f77447ed5636ab':'weapon',
  '5b47574386f77428ca22b346':'ammo','5b47574386f77428ca22b340':'provisions',
  '5b47574386f77428ca22b341':'intel','5b47574386f77428ca22b343':'intel',
  '5b5f78b786f77447ed5636af':'money','5b47574386f77428ca22b344':'medical',
  '5b47574386f77428ca22b342':'key','5c518ed586f774119a772aee':'keycard',
  '5b47574386f77428ca22b33a':'stim','6a35427afc3f27b15905a876':'season_document',
};

export function handbookLootFamily(tpl,templates,categories,itemCategories){
  let id=itemCategories.get(tpl);const seen=new Set();
  while(id&&!seen.has(id)){
    seen.add(id);
    const category=categories.get(id);if(!category)break;
    if(id==='5b47574386f77428ca22b345'){
      const family=templateLootFamily(tpl,templates);
      return ['tools','key'].includes(family)?'tools':'equipment';
    }
    if(Object.hasOwn(handbookFamilies,id))return handbookFamilies[id];
    id=category.ParentId;
  }
  return templateLootFamily(tpl,templates);
}
