import {itemMarketValue,MARKET_MODES} from './atlas-high-value-data.js';

export const DEFAULT_SETTINGS={mode:'regular',label:'total',thresholds:[10000,40000,100000],colors:['#e2e8f0','#65df96','#c69aff','#ffd260'],fontSize:16,language:'both',cellSize:0};
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function scannerSettings(value={}){
  const thresholds=Array.isArray(value.thresholds)&&value.thresholds.length===3&&value.thresholds.every((n,i,a)=>finite(n,1,1e10)&&(!i||n>a[i-1]))?value.thresholds:DEFAULT_SETTINGS.thresholds;
  return {mode:MARKET_MODES.some(([id])=>id===value.mode)?value.mode:'regular',label:['total','slot','both'].includes(value.label)?value.label:'total',
    thresholds:[...thresholds],colors:DEFAULT_SETTINGS.colors.map((c,i)=>/^#[a-f0-9]{6}$/i.test(value.colors?.[i])?value.colors[i]:c),
    fontSize:finite(value.fontSize,10,48)?value.fontSize:16,language:['both','en','zh'].includes(value.language)?value.language:'both',
    cellSize:finite(value.cellSize,24,240)?value.cellSize:0};
}
export function priceTier(perSlot,thresholds=DEFAULT_SETTINGS.thresholds){
  if(!finite(perSlot,0,1e15))return -1;
  return thresholds.reduce((tier,threshold)=>tier+(perSlot>=threshold?1:0),0);
}
// Keep K as the base unit, including million-ruble prices. Never round a
// nonzero price down to 0K, and don't let formatting choose a value tier.
export function formatK(value){
  if(!finite(value,0,1e15))return '—';
  if(value>0&&value<100)return '<0.1K';
  return `${(Math.round(value/100)/10).toLocaleString('en-US',{maximumFractionDigits:1,useGrouping:false})}K`;
}
export function valueDetection(detection,item,market,settings=DEFAULT_SETTINGS){
  const quote=market?.items?.[item?.id];
  const value=itemMarketValue(quote)||null;
  const quantity=Number.isSafeInteger(detection.quantity)&&detection.quantity>=1&&detection.quantity<=Math.max(1,item?.stackMax||1)?detection.quantity:1;
  const slots=Number.isInteger(detection.slots)&&detection.slots>=1&&detection.slots<=100?detection.slots:(item?.width||1)*(item?.height||1);
  const total=value===null?null:value*quantity,perSlot=total===null?null:total/slots;
  const tier=priceTier(perSlot,settings.thresholds);
  const source=!value?'暂无价格':quote.trader?.priceRUB===value?'商人':'跳蚤市场';
  const label=settings.label==='slot'?`${formatK(perSlot)}/格`:settings.label==='both'?`${formatK(total)} · ${formatK(perSlot)}/格`:formatK(total);
  return {value,quantity,slots,total,perSlot,tier,color:settings.colors[tier]||'#a1a1aa',source,label,quote};
}
export function summarizeDetections(detections,items,market,settings){
  let total=0,slots=0,priced=0,missing=0,pending=0;
  for(const detection of detections){
    if(!detection.confirmed){pending++;continue;}
    const item=items.get(detection.itemId);if(!item){pending++;continue;}
    const row=valueDetection(detection,item,market,settings);slots+=row.slots;
    if(row.total===null)missing++;else{total+=row.total;priced++;}
  }
  return {total,slots,priced,missing,pending};
}
export const normalizeName=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function makeNameIndex(items){
  const aliases=new Map();
  for(const item of items)for(const name of new Set([item.name,item.en,...item.aliases].map(normalizeName))){
    if(name.length<2)continue;
    if(!aliases.has(name))aliases.set(name,[]);aliases.get(name).push(item.id);
  }
  return aliases;
}
function editDistance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
  return row[b.length];
}
export function matchName(text,index){
  const name=normalizeName(text);if(name.length<2||name.length>100)return [];
  const exact=index.get(name);if(exact)return exact.map(id=>({id,score:1}));
  if(name.length<4)return [];
  const matches=new Map();
  for(const [alias,ids] of index){
    if(Math.abs(alias.length-name.length)>Math.max(1,Math.floor(name.length*.18)))continue;
    const score=1-editDistance(name,alias)/Math.max(name.length,alias.length);
    if(score<.81)continue;for(const id of ids)matches.set(id,Math.max(score,matches.get(id)||0));
  }
  return [...matches].map(([id,score])=>({id,score})).sort((a,b)=>b.score-a.score).slice(0,8);
}
export function overlap(a,b){
  const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area/Math.max(1,Math.min(a.width*a.height,b.width*b.height));
}
export function suppressDuplicates(rows){
  const result=[];
  for(const row of [...rows].sort((a,b)=>(b.confirmed-a.confirmed)||b.confidence-a.confidence)){
    if(!result.some(other=>overlap(row.box,other.box)>.58))result.push(row);
  }
  return result.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}
export function csvText(rows){
  const escape=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,'\'$&').replace(/"/g,'""')+'"';
  return '\ufeff'+rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
