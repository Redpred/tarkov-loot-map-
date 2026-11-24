import {itemMarketValue,MARKET_MODES} from './atlas-high-value-data.js';

export const DEFAULT_POINT_TIERS={thresholds:[10000,40000,100000],colors:['#e2e8f0','#65df96','#c69aff','#ffd260']};
export const POINT_VALUE_REASONS={
  'missing-content':'缺少物资池或数量资料','unknown-size':'物品占格资料不完整','without-replacement-content':'此容器的抽取规则尚未核实',
  'missing-template':'物品资料不完整','unknown-stack':'堆叠数量资料不完整','unknown-ammo-box':'弹药盒内容不完整',
  'assembly-price':'整套装备与配件的报价包含关系待核实','magazine-ammo':'弹匣内随机弹药尚未计价','quest-only':'含不可出售的任务物品',
  'missing-weights':'候选权重不完整','global-limit':'受全图数量上限影响，最终概率待核实','missing-price':'部分物品暂无有效售价','missing-probability':'暂无可靠的有货概率',
};
export const shortValue=n=>Number.isFinite(n)?n>0&&n<100?'<0.1K':`${(n/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})}K`:'—';
export const stockPercent=n=>!Number.isFinite(n)?'—':n>0&&n<.001?'<0.1%':`${(n*100).toLocaleString('zh-CN',{maximumFractionDigits:1})}%`;
export function pointValuePreferences(value={}){
  const thresholds=Array.isArray(value?.thresholds)&&value.thresholds.length===3&&value.thresholds.every((n,i,a)=>Number.isFinite(n)&&n>0&&n<=1e12&&(!i||n>a[i-1]))?[...value.thresholds]:[...DEFAULT_POINT_TIERS.thresholds];
  const colors=DEFAULT_POINT_TIERS.colors.map((fallback,i)=>/^#[a-f0-9]{6}$/i.test(value?.colors?.[i]||'')?value.colors[i]:fallback);
  return {thresholds,colors,mode:MARKET_MODES.some(([id])=>id===value?.mode)?value.mode:'regular',metric:value?.metric==='conditional'?'conditional':'expected',
    kinds:(Array.isArray(value?.kinds)?value.kinds:['container','loose']).filter(k=>['container','loose'].includes(k)),tiers:(Array.isArray(value?.tiers)?value.tiers:[0,1,2,3]).filter(t=>Number.isInteger(t)&&t>=0&&t<4),unknown:value?.unknown===true};
}
export function pointTier(value,thresholds=DEFAULT_POINT_TIERS.thresholds){if(!Number.isFinite(value)||value<0)return null;let tier=0;while(tier<thresholds.length&&value>=thresholds[tier])tier++;return tier;}
export const pointTierLabel=(i,t)=>i===0?`< ${shortValue(t[0])}`:i===3?`≥ ${shortValue(t[2])}`:`${shortValue(t[i-1])}–${shortValue(t[i])}`;

export function valueContent(model,market){
  if(!model)return {total:null,known:0,coverage:0,contributions:[],issues:['missing-content']};
  const contributions=[],missing=[],issues=new Set(model.issues||[]);let known=0,quantity=0,priced=0;
  for(const [tpl,count] of model.coefficients||[]){
    if(!(count>0))continue;quantity+=count;
    const price=tpl==='5449016a4bdc2d6f028b456f'?1:itemMarketValue(market.items[tpl]);
    if(price>0){const value=price*count;known+=value;priced+=count;contributions.push({tpl,count,price,value});}else missing.push(tpl);
  }
  if(missing.length)issues.add('missing-price');
  return {total:issues.size?null:known,known,coverage:quantity?priced/quantity:1,missing,contributions:contributions.sort((a,b)=>b.value-a.value),issues:[...issues]};
}
export function valuePoint(record,model,content){
  const probability=record?.probability,stock=Number.isFinite(probability)&&Number.isFinite(model?.stock)?probability*model.stock:null;
  const issues=[...new Set([...(record?.issues||[]),...content.issues,...(stock==null?['missing-probability']:[])])];
  const expected=stock===0&&Number.isFinite(probability)&&!record?.issues?.length?0:stock!=null&&content.total!=null&&!record?.issues?.length?probability*content.total:null;
  const conditional=stock!==0&&model?.stock>0&&content.total!=null&&!record?.issues?.length?content.total/model.stock:null;
  return {stock,conditional,expected,knownExpected:Number.isFinite(probability)?probability*content.known:null,knownConditional:model?.stock>0?content.known/model.stock:null,
    count:Number.isFinite(probability)&&Number.isFinite(model?.roots)?probability*model.roots:null,
    error:Number.isFinite(stock)?(record.error||0)*(model.stock||0)+(model.stockError||0)*(probability||0):null,issues,content};
}
export function createPointValuation(dataset,market){
  const values=new Map(),contents=new Map(Object.entries(dataset.models).map(([id,model])=>[id,valueContent(model,market)]));
  for(const [id,record] of Object.entries(dataset.points)){const model=dataset.models[record.model],content=contents.get(record.model)||valueContent(null,market);values.set(id,valuePoint(record,model,content));}
  return values;
}
export function pointMatches(point,value,preferences){if(!preferences.kinds.includes(point.kind))return false;const tier=pointTier(value?.[preferences.metric],preferences.thresholds);return tier==null?preferences.unknown:preferences.tiers.includes(tier);}
export function createPointValueSelection(){let snapshot=null;return {
  get active(){return Boolean(snapshot);},get current(){return snapshot;},
  apply({preferences,market,values}){snapshot={...pointValuePreferences(preferences),fetchedAt:market.fetchedAt,values:new Map(values)};},cancel(){snapshot=null;},
  matches(point){return Boolean(snapshot&&pointMatches(point,snapshot.values.get(point.id),snapshot));},
  value(point){return snapshot?.values.get(point.id);},
  color(point){if(!snapshot)return null;const tier=pointTier(snapshot.values.get(point.id)?.[snapshot.metric],snapshot.thresholds);return tier==null?'#84939f':snapshot.colors[tier];},
  compare(a,b){const x=snapshot?.values.get(a.id)?.[snapshot.metric],y=snapshot?.values.get(b.id)?.[snapshot.metric];return(Number.isFinite(y)?y:-1)-(Number.isFinite(x)?x:-1)||a.id.localeCompare(b.id);},
  export(){if(!snapshot)return null;const {values,...prefs}=snapshot;return {type:'point',...prefs};}
};}
export function createPointModelClient({fetchImpl=fetch}={}){const cache=new Map();return {load(map){if(!cache.has(map))cache.set(map,(async()=>{const response=await fetchImpl(`data/point-values/${encodeURIComponent(map)}.json`);if(!response.ok)throw new Error('点位估值资料暂不可用');const data=await response.json();if(data.schemaVersion!==1||data.map!==map||!data.points||!data.models)throw new Error('点位估值资料格式无效');return data;})().catch(error=>{cache.delete(map);throw error;}));return cache.get(map);}};}
export const pointModelClient=createPointModelClient();
export function verifyPointModelSource(dataset,data){
  const source=data?.sources?.spt;if(!source){if(Object.keys(dataset.source?.files||{}).length)throw new Error('点位资料版本不匹配');return;}
  if(dataset.source?.commit!==source.commit||Object.entries(dataset.source?.files||{}).some(([file,hash])=>source.files?.[file]!==hash))throw new Error('点位资料版本不匹配');
}
