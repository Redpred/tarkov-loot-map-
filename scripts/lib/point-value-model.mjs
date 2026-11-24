// Price-independent, deterministic estimates for the pinned loot generator.
// The exponential-race identity is equivalent to successive weighted sampling
// without replacement. Integrating each point's own clock preserves rare tails.
export const positive=n=>Number.isFinite(n)&&n>0?n:0;
export function randomSeed(seed=1){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function roundEven(n){const f=Math.floor(n),r=n-f;return r===.5?f+(f%2):Math.round(n);}
export const adjustedStaticWeight=(weight,percent)=>percent==null?weight:roundEven(percent*(weight/100));
export function normalNonnegative(mean,std,rng){if(!std)return Math.max(0,mean);for(let i=0;i<100;i++){const x=mean+std*Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng())))*Math.sin(2*Math.PI*rng());if(x>=0)return x;}return .01+rng()*Math.max(0,2*mean-.01);}
export const chance100=n=>Math.min(99,Math.max(0,Math.floor(n)))/99;
// Forced groups consume a shared template cap once per group, in source order.
// Any cap that may already have been consumed by containers stays unresolved.
export function forcedCapPlan(points,limits,staticLimited=new Set()){
  const groups=new Map(),counts=new Map(),uncertain=new Set(staticLimited),allowed=new Map();
  for(const p of points){if(p.disabled||!(p.forced||p.alwaysSpawn))continue;const g=groups.get(p.sourceId)||[];g.push(p);groups.set(p.sourceId,g);}
  for(const group of groups.values()){
    const tpls=new Set(group.map(p=>p.rootTpl));
    if(tpls.size!==1){for(const tpl of tpls)if(Object.hasOwn(limits,tpl))uncertain.add(tpl);for(const p of group)if(Object.hasOwn(limits,p.rootTpl))allowed.set(p.id,null);continue;}
    const tpl=group[0].rootTpl;if(!Object.hasOwn(limits,tpl))continue;
    if(uncertain.has(tpl)){for(const p of group)allowed.set(p.id,null);continue;}
    const count=counts.get(tpl)||0;for(const p of group)allowed.set(p.id,count<limits[tpl]);counts.set(tpl,count+1);
  }
  return {allowed,exhausted:new Set([...counts].filter(([tpl,n])=>n>=limits[tpl]&&!uncertain.has(tpl)).map(([tpl])=>tpl))};
}
export function weightedIndex(weights,rng){const total=weights.reduce((s,x)=>s+positive(x),0);if(!total)return-1;let value=rng()*total;for(let i=0;i<weights.length;i++){value-=positive(weights[i]);if(value<0)return i;}return weights.length-1;}
export function normalized(rows,key='weight'){const total=rows.reduce((s,r)=>s+positive(r[key]),0);return total?rows.filter(r=>positive(r[key])).map(r=>({...r,weight:r[key]/total})):[];}

export function groupedContainerProbability(weight,weights,min,max){
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min)return null;
  const total=weights.reduce((s,w)=>s+positive(w),0);
  let sum=0;for(let n=min;n<=max;n++)sum+=n>weights.length?1:n>0&&total&&positive(weight)?-Math.expm1(n*Math.log1p(-Math.min(1,weight/total))):0;
  return sum/(max-min+1);
}
export function ungroupedContainerProbabilities(weights,{samples=4096,seed=13}={}){
  const rng=randomSeed(seed),result=weights.map(()=>0),rates=weights.map(w=>chance100(w*100));
  for(let s=0;s<samples;s++){
    const picked=rates.map(p=>rng()<p),total=weights.reduce((sum,w,i)=>sum+(picked[i]?positive(w):0),0),count=picked.filter(Boolean).length;
    weights.forEach((w,i)=>{if(w<=0)return;const otherWeight=total-(picked[i]?w:0),n=count-(picked[i]?1:0)+1;result[i]+=rates[i]*-Math.expm1(n*Math.log1p(-w/(otherWeight+w)));});
  }
  return result.map(p=>p/samples);
}

export function looseSelectionProbabilities(points,{mean,std,multiplier=1,samples=4096,seed=7}={}){
  const result=new Map(),forced=new Map(),guaranteed=[],ordinary=[];
  for(const p of points){
    if(p.disabled){result.set(p.id,{probability:0,error:0});continue;}
    if(p.forced||p.alwaysSpawn){const group=forced.get(p.sourceId)||[];group.push(p);forced.set(p.sourceId,group);}
    else if(p.sourceWeight===1)guaranteed.push(p);
    else ordinary.push(p);
  }
  for(const group of forced.values()){
    const total=group.reduce((s,p)=>s+positive(p.sourceWeight??1),0);
    for(const p of group)result.set(p.id,{probability:group.length===1?1:total?positive(p.sourceWeight??1)/total:null,error:0});
  }
  const guaranteedLocations=new Set();
  for(const p of guaranteed){result.set(p.id,{probability:guaranteedLocations.has(p.locationId)?0:1,error:0});guaranteedLocations.add(p.locationId);}
  if(!Number.isFinite(mean)||!Number.isFinite(std)||std<0){for(const p of ordinary)result.set(p.id,{probability:null});return result;}
  // Data(key) in the source returns the first record for a duplicate source ID.
  // Keep every lottery entry in the denominator, but route it to that record.
  const firstBySource=new Map();for(const p of ordinary)if(!firstBySource.has(p.sourceId))firstBySource.set(p.sourceId,p);
  const rows=ordinary.filter(p=>positive(p.sourceWeight)).map(p=>({...p,target:firstBySource.get(p.sourceId).id,locationId:firstBySource.get(p.sourceId).locationId})),rng=randomSeed(seed),sum=new Float64Array(rows.length),sum2=new Float64Array(rows.length),clocks=new Float64Array(rows.length);
  for(let s=0;s<samples;s++){
    const n=Math.min(rows.length,Math.max(0,roundEven(multiplier*normalNonnegative(mean,std,rng))-guaranteed.length));
    if(!n)continue;
    const locations=new Map();
    rows.forEach((p,i)=>{
      const t=-Math.log(Math.max(Number.MIN_VALUE,rng()))/p.sourceWeight;clocks[i]=t;
      let pair=locations.get(p.locationId);if(!pair)locations.set(p.locationId,pair=[Infinity,Infinity,-1]);
      if(t<pair[0]){pair[1]=pair[0];pair[0]=t;pair[2]=i;}else if(t<pair[1])pair[1]=t;
    });
    const sorted=clocks.slice().sort(),cut=sorted[n-1],next=sorted[n]??Infinity;
    rows.forEach((p,i)=>{
      if(guaranteedLocations.has(p.locationId))return;
      const pair=locations.get(p.locationId),otherLocation=pair[pair[2]===i?1:0],threshold=Math.min(clocks[i]<=cut?next:cut,otherLocation);
      const probability=-Math.expm1(-p.sourceWeight*threshold);sum[i]+=probability;sum2[i]+=probability*probability;
    });
  }
  rows.forEach((p,i)=>{const probability=sum[i]/samples,error=1.96*Math.sqrt(Math.max(0,sum2[i]/samples-probability**2)/samples),current=result.get(p.target)||{probability:0,error:0};result.set(p.target,{probability:Math.min(1,current.probability+probability),error:current.error+error});});
  for(const p of ordinary)if(!result.has(p.id))result.set(p.id,{probability:0,error:0});
  return result;
}

// Source scans rows/columns and tries normal then rotated at each position.
export function findSlot(grid,width,height,w,h){
  const fits=(x,y,a,b)=>{if(x+a>width||y+b>height)return false;for(let j=y;j<y+b;j++)for(let i=x;i<x+a;i++)if(grid[j*width+i])return false;return true;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(fits(x,y,w,h))return{x,y,w,h};if(w!==h&&fits(x,y,h,w))return{x,y,w:h,h:w};
  }return null;
}
export function fillSlot(grid,width,slot){for(let y=slot.y;y<slot.y+slot.h;y++)for(let x=slot.x;x<slot.x+slot.w;x++)grid[y*width+x]=1;}

// Each group contains items indistinguishable to packing. At every simulated
// prefix evaluate *all* next groups, not just the sampled item. Rare templates
// retain their analytical share of the expected accepted draws.
export function containerContents({items,counts,width,height,forced=[],multiplier=1,allowDuplicates=true,fitAttempts=3,samples=8192,seed=19}){
  const pool=normalized(items),distribution=normalized(counts.map(r=>({count:roundEven(r.count*multiplier),weight:r.relativeProbability}))),issues=[];
  if(!pool.length||!distribution.length||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return {issues:['missing-content'],stock:null,coefficients:[]};
  if(pool.some(r=>!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1))return {issues:['unknown-size'],stock:null,coefficients:[]};
  const forcedIds=new Set(forced.map(r=>r.tpl)),groups=[];
  for(const item of pool){const skip=forcedIds.has(item.tpl),key=skip?'skip':`${item.width},${item.height}`;let group=groups.find(g=>g.key===key);if(!group){group={key,width:item.width,height:item.height,skip,weight:0,items:[]};groups.push(group);}group.weight+=item.weight;group.items.push(item);}
  const accepted=new Float64Array(groups.length),removedAccepted=new Float64Array(pool.length),forcedAccepted=new Float64Array(forced.length),rng=randomSeed(seed);let stock=0,roots=0,stockError=0;
  for(const dist of distribution){
    if(!dist.count)continue;
    const removal=!allowDuplicates||dist.count>=pool.length;
    let nonemptySum=0,nonempty2=0;
    for(let sample=0;sample<samples;sample++){
      const grid=new Uint8Array(width*height);let failed=0,hasItem=false,stopped=false,expectedNonempty=0;
      for(let i=0;i<forced.length;i++){
        const f=forced[i],slot=findSlot(grid,width,height,f.width,f.height);
        if(slot){fillSlot(grid,width,slot);hasItem=true;forcedAccepted[i]+=dist.weight/samples;}
        else if(failed>fitAttempts){stopped=true;break;}else failed++;
      }
      if(hasItem)expectedNonempty=1;
      const available=removal?pool.map(i=>i.weight):null;
      for(let draw=0;draw<dist.count&&!stopped;draw++){
        if(removal){
          const total=available.reduce((a,b)=>a+b,0);if(!total)break;
          const slots=pool.map((item,i)=>available[i]&&!forcedIds.has(item.tpl)?findSlot(grid,width,height,item.width,item.height):null);
          for(let i=0;i<pool.length;i++)if(slots[i]){const probability=available[i]/total;removedAccepted[i]+=dist.weight*probability/samples;if(!hasItem)expectedNonempty+=probability;}
          const selected=weightedIndex(available,rng),item=pool[selected],slot=slots[selected];
          // Money templates are the source's never-remove whitelist, even on
          // this branch. Ammunition is not on that whitelist.
          if(!item.money)available[selected]=0;
          if(forcedIds.has(item.tpl))continue;
          if(slot){fillSlot(grid,width,slot);hasItem=true;}else if(failed>fitAttempts)stopped=true;else failed++;
          continue;
        }
        const slots=groups.map(g=>g.skip?null:findSlot(grid,width,height,g.width,g.height));
        for(let i=0;i<groups.length;i++)if(slots[i]){accepted[i]+=dist.weight*groups[i].weight/samples;if(!hasItem)expectedNonempty+=groups[i].weight;}
        const selected=weightedIndex(groups.map(g=>g.weight),rng),g=groups[selected],slot=slots[selected];
        if(g.skip)continue;
        if(slot){fillSlot(grid,width,slot);hasItem=true;}else if(failed>fitAttempts)stopped=true;else failed++;
      }
      nonemptySum+=expectedNonempty;nonempty2+=expectedNonempty**2;
    }
    stock+=dist.weight*nonemptySum/samples;stockError+=dist.weight*1.96*Math.sqrt(Math.max(0,nonempty2/samples-(nonemptySum/samples)**2)/samples);
  }
  const coefficients=new Map(),unknown=new Map();
  const add=(item,n)=>{if(!(n>0))return;roots+=n;for(const [tpl,q] of item.coefficients||[])if(q>0)coefficients.set(tpl,(coefficients.get(tpl)||0)+n*q);for(const code of item.issues||[])unknown.set(code,(unknown.get(code)||0)+n);};
  groups.forEach((g,i)=>g.items.forEach(item=>add(item,accepted[i]*item.weight/g.weight)));pool.forEach((item,i)=>add(item,removedAccepted[i]));forced.forEach((f,i)=>add(f,forcedAccepted[i]));
  return {stock:issues.length?null:Math.max(0,Math.min(1,stock)),stockError,roots,coefficients:[...coefficients],issues:[...new Set([...issues,...unknown.keys()])],unknown:[...unknown]};
}
