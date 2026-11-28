import {accessLabels,preparationGroups} from './task-preparation.js';
import {createMapMarketSession} from './atlas-map-market.js';
import {marketMoney,marketTime,itemPriceDisplay} from './atlas-market-client.js';
import {getGameMode,subscribeGameMode} from './game-mode.js';
import {atlasMapHref} from './atlas-maps.js';

const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const clean=value=>String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').trim();
const traderNames={Prapor:'俄商',Therapist:'医生',Fence:'黑商',Skier:'滑雪者',Peacekeeper:'维和',Mechanic:'机械师',Ragman:'服装商',Jaeger:'猎人',Ref:'裁判'};
function image(file,cls){
  if(!/^data\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpg)$/.test(file||''))return null;
  const img=make('img',cls);img.src=file;img.alt='';img.loading='lazy';img.decoding='async';
  img.addEventListener('error',()=>img.hidden=true,{once:true});return img;
}
export function createPreparationView({store,openDetail,setView,opened,rememberGroup}){
  const session=createMapMarketSession({initialMode:getGameMode()});
  let active=false,catalogue,assets,host,status,retry;
  subscribeGameMode(mode=>{if(active)session.load(mode);});
  function priceCell(id,item){const node=make('div','prep-prices');node.dataset.preparationPrice=id;node.dataset.questItem=String(Boolean(item.questItem));return node;}
  function paintPrices(){
    if(!active||!host?.isConnected)return;
    const state=session.state,market=state.market;
    if(status)status.textContent=state.status==='loading'?'正在获取价格…':state.status==='error'?'价格暂不可用，准备清单仍可查看。':market?`${market.stale?'缓存报价 · ':''}更新于 ${marketTime(market.fetchedAt)} · 商人购买价 / 跳蚤最低价`:'选择游戏模式查看价格';
    if(retry)retry.disabled=state.status==='loading';
    for(const node of host.querySelectorAll('[data-preparation-price]')){
      node.replaceChildren();
      const id=node.dataset.preparationPrice;
      if(node.dataset.questItem==='true'){node.append(make('span','prep-unavailable','任务物品 · 不可购买'));continue;}
      if(!market){node.append(make('span','prep-unavailable',state.status==='loading'?'价格加载中…':'暂无价格数据'));continue;}
      const quote=market.items[id],buy=quote?.buyFromTrader;
      const merchant=make('div','prep-merchant'),flea=make('div','prep-flea');
      merchant.append(make('span','prep-price-label','商人最低购买价'));
      if(buy){
        const person=market.traders[buy.traderId]||{},trader=catalogue.traders.find(t=>t.id===buy.traderId);
        const line=make('div','prep-merchant-quote'),portrait=image(assets.traders?.[buy.traderId]?.file||person.avatar,'prep-trader-icon');
        if(portrait)line.append(portrait);
        line.append(make('span','',traderNames[person.name]||trader?.name||person.name||'商人'),make('strong','',buy.currency==='RUB'?marketMoney(buy.price):`${buy.price.toLocaleString('zh-CN')} ${buy.currency}`));
        merchant.append(line);
        const conditions=[];
        if(buy.currency!=='RUB')conditions.push(`约 ${marketMoney(buy.priceRUB)}`);
        if(buy.minTraderLevel)conditions.push(`商人等级 ${buy.minTraderLevel}`);
        if(buy.taskUnlock)conditions.push(`完成「${catalogue.tasks.find(t=>t.id===buy.taskUnlock)?.name||'指定任务'}」后解锁`);
        if(buy.buyLimit)conditions.push(`限购 ${buy.buyLimit}`);
        if(conditions.length)merchant.append(make('small','prep-conditions',conditions.join(' · ')));
      }else merchant.append(make('span','prep-unavailable',market.purchaseSchemaVersion===1?'暂无现金购买报价':'购买价格暂不可用'));
      flea.append(make('span','prep-price-label','跳蚤最低价'),make('strong','',itemPriceDisplay(quote).low));
      node.append(merchant,flea);
    }
  }
  session.subscribe(paintPrices);
  function optionItem(id){
    const item=catalogue.items[id]||{},node=make('div','prep-option-item'),info=make('div','prep-item');
    const icon=make('span','prep-item-icon'),photo=image(item.icon||assets.items?.[id]?.file,'');
    if(photo)icon.append(photo);else icon.append(make('span','','◇'));
    info.append(icon,make('strong','',item.name||item.en||'物品名称待补齐'));node.append(info,priceCell(id,item));return node;
  }
  function rowNode(row){
    const article=make('article','prep-row'),purchase=make('div','prep-purchase'),heading=make('div','prep-row-heading');
    heading.append(make('span','prep-kind',row.kind));
    if(row.access){
      const bring=new Set(row.uses.map(use=>use.access.bring||'required'));
      if(bring.size===1)heading.append(make('strong','prep-quantity',accessLabels[bring.values().next().value]));
    }else heading.append(make('strong','prep-quantity',`${row.consumed?'需备':'携带'} × ${row.quantity}`));
    if(row.optional)heading.append(make('span','prep-tag','可选目标'));
    if(row.foundInRaid)heading.append(make('span','prep-tag','须在战局中找到'));
    if(row.options.length>1)heading.append(make('span','prep-tag',`任选 1 ${row.options.some(g=>g.length>1)?'套方案':'种'} · 共 ${row.options.length} 种`));
    purchase.append(heading);
    if(!row.options.length)purchase.append(make('p','',row.label),make('p','prep-unavailable','按右侧目标核对物品，暂无精确报价'));
    function scheme(group,i){
      const box=make('div','prep-scheme');
      if(row.options.length>1&&row.options.some(g=>g.length>1))box.append(make('p','prep-scheme-title',`方案 ${i+1}${group.length>1?' · 以下物品同时携带':''}`));
      else if(row.options.length===1&&group.length>1)box.append(make('p','prep-scheme-title','以下物品同时携带'));
      for(const id of group)box.append(optionItem(id));return box;
    }
    if(row.options.length){
      purchase.append(scheme(row.options[0],0));
      if(row.options.length>1){const more=make('details','prep-alternatives');more.append(make('summary','',`查看其余 ${row.options.length-1} 种选择`));row.options.slice(1).forEach((group,i)=>more.append(scheme(group,i+1)));purchase.append(more);}
    }
    const uses=make('div','prep-uses');
    for(const use of row.uses){
      const box=make('section','prep-use'),title=make('button','prep-task-name',use.task.name);title.type='button';title.addEventListener('click',()=>openDetail(use.task.id));
      const targetCount=use.objective.type==='CounterCreator'&&use.objective.showCount!==false&&Number(use.objective.count)>1?` · 目标数量 ${use.objective.count}`:'';
      box.append(title,make('p','prep-objective',clean(use.objective.text)));
      if(use.access){
        const {bring,location,note}=use.access;
        box.append(make('small','prep-use-count',`${accessLabels[bring||'required']} · ${location}`));
        if(note)box.append(make('p','prep-acquisition',note));
      }else box.append(make('small','prep-use-count',`本目标需备 × ${use.quantity}${row.consumed?'':' · 装备可复用'}${targetCount}`));
      if(use.objective.details?.length){const list=make('ul','prep-requirements');for(const detail of use.objective.details){const text=typeof detail==='string'?detail:[detail.label,detail.text].filter(Boolean).join('：');list.append(make('li','',clean(text)));}box.append(list);}
      if(use.objective.acquisition?.text)box.append(make('p','prep-acquisition',clean(use.objective.acquisition.text)));
      if(use.task.description){const description=make('details','prep-description');description.append(make('summary','','任务描述'),make('p','',clean(use.task.description)));box.append(description);}
      uses.append(box);
    }
    article.append(purchase,uses);return article;
  }
  return {
    deactivate(){active=false;},
    render({target,catalog,assetManifest,traderId,search}){
      active=true;catalogue=catalog;assets=assetManifest;host=target;
      const groups=preparationGroups(catalog,store.getState(),{traderId,search});
      const intro=make('div','prep-intro');intro.append(make('p','','已选任务的未完成目标；放置物品合计数量，装备可复用。跨地图的同一目标可择图完成。'));
      const tools=make('div','prep-market-status');status=make('span');status.setAttribute('role','status');retry=make('button','','刷新价格');retry.type='button';retry.onclick=()=>session.load(getGameMode(),{reload:true});tools.append(status,retry);intro.append(tools);
      intro.append(make('p','prep-footnote','价格为单件最近采样。最低商人报价可能需要等级或任务解锁，不含以物易物。'));host.append(intro);
      if(!groups.length){
        const empty=make('div','empty-state'),selected=store.getState().selected.length;
        empty.append(make('p','',selected?(search||traderId?'没有符合筛选的准备物品':'当前已选任务的未完成目标中，没有明确的携带或装备要求。'):'先在任务总览中勾选任务，即可生成战前准备清单。'));
        const button=make('button','primary',selected?'查看我的任务':'前往任务总览');button.type='button';button.onclick=()=>setView(selected?'mine':'overview');empty.append(button);host.append(empty);
      }
      for(const group of groups){
        const details=make('details','task-group prep-group'),key=`preparation:${traderId}:${group.id}`;
        let open=opened.get(key)??true;details.dataset.groupKey=key;details.open=open;
        const summary=make('summary','',group.name);summary.append(make('span','',`${group.rows.length} 项准备`));
        if(group.id!=='other'){const link=make('a','','进入地图 ↗');link.href=atlasMapHref(group.id);link.addEventListener('click',e=>e.stopPropagation());summary.append(link);}
        const list=make('div','prep-list');group.rows.forEach(row=>list.append(rowNode(row)));details.append(summary,list);
        details.addEventListener('toggle',()=>{if(details.isConnected&&details.open!==open){open=details.open;rememberGroup(key,open);}});
        host.append(details);
      }
      paintPrices();
      if(session.state.mode!==getGameMode())session.load(getGameMode());else session.ensure();
      return groups.reduce((sum,g)=>sum+g.rows.length,0);
    }
  };
}
