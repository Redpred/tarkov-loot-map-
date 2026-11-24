export const STORY_TRADER_ID='67f7af56c117b6140af2a607';
export const KERMAN_TRADER_ID='688246518448b05efd61d461';
export const SEASON_CATEGORY_ID='seasonal';
export const SEASON_CATEGORY={id:SEASON_CATEGORY_ID,name:'赛季任务',category:true};
export function matchesTaskCategory(task,id,{overview=false}={}){
  if(id===SEASON_CATEGORY_ID)return Boolean(task.seasonId||task.seasonFlowId);
  return (!id||task.traderId===id)&&(!overview||!task.seasonId);
}
export const TRADER_ORDER=[
  '54cb50c76803fa8b248b4571', // Prapor
  '54cb57776803fa99248b456e', // Therapist
  '579dc571d53a0658a154fbec', // Fence
  '58330581ace78e27b8b10cee', // Skier
  '5935c25fb3acc3127c3d8cd9', // Peacekeeper
  '5a7c2eca46aef81a7ca2145d', // Mechanic
  '5ac3b934156ae10c4430e83c', // Ragman
  '5c0647fdd443bc2504c2d371', // Jaeger
  '6617beeaa9cfa777ca915b7c', // Ref
  '656f0f98d80a697f855d34b1', // BTR Driver
  '638f541a29ffd1183d187f57', // Lightkeeper
  STORY_TRADER_ID,
];
export function presentTraders(traders){
  const ranks=new Map(TRADER_ORDER.map((id,index)=>[id,index]));
  return traders.map(trader=>({...trader,imageKey:trader.id===STORY_TRADER_ID?KERMAN_TRADER_ID:trader.imageKey||trader.id}))
    .sort((a,b)=>(ranks.get(a.id)??TRADER_ORDER.length)-(ranks.get(b.id)??TRADER_ORDER.length)||a.name.localeCompare(b.name,'zh-CN'));
}
