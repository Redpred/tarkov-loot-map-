import {getGameMode,subscribeGameMode} from './game-mode.js';
import {marketClient,marketModeName,marketTime,itemPriceDisplay,traderAvatar} from './atlas-market-client.js';

const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
export function attachPointPrices(details,{client=marketClient,summary,initialMode,session}={}){
  const slots=[...details.querySelectorAll('[data-price-item]')];if(!slots.length&&!summary)return;
  let mode=session?.state.mode||getGameMode(),request=0,loadedMarket=null,unsubscribe;
  const controls=make('div','point-price-controls');
  const retry=make('button','','刷新价格');retry.type='button';retry.setAttribute('aria-label','刷新点位物资价格');
  const status=make('p','point-price-status');status.setAttribute('role','status');controls.append(retry,status);details.querySelector('.pool-note').after(controls);
  const visible=new Set();
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.isIntersecting){visible.add(entry.target);if(loadedMarket)renderItem(entry.target,loadedMarket);}else visible.delete(entry.target);}
  },{root:details,rootMargin:'240px'}):null;
  if(observer){for(const slot of slots)observer.observe(slot);}else for(const slot of slots)visible.add(slot);
  // Discard detached rows and observers when a different point/POI is chosen.
  const lifecycle=new MutationObserver(()=>{if(!controls.isConnected){observer?.disconnect();lifecycle.disconnect();unsubscribe?.();visible.clear();loadedMarket=null;}});lifecycle.observe(details,{childList:true});
  function renderItem(slot,market){
    const value=market.items[slot.dataset.priceItem],prices=itemPriceDisplay(value),person=market.traders[value?.trader?.traderId]||{};
    const trader=make('div','point-price-trader'),heading=make('span','','商人最高收购'),quote=make('strong','',prices.trader);trader.append(heading,quote);
    if(value?.trader){const avatar=traderAvatar(person.avatar);if(avatar){const img=make('img');img.src=avatar;img.alt=person.name||'商人';img.width=22;img.height=22;img.loading='lazy';img.addEventListener('error',()=>img.hidden=true,{once:true});trader.append(img);}trader.append(make('span','point-price-person',person.name||'商人'));
      if(value.trader.currency!=='RUB')trader.append(make('small','',`${value.trader.price.toLocaleString('zh-CN')} ${value.trader.currency}`));}
    const flea=make('div','point-price-flea');flea.append(make('span','','跳蚤最低'),make('strong','',prices.low));
    const extra=make('small','point-price-extra',`24 小时均价 ${prices.average} · 上架 ${prices.offers}`);
    slot.replaceChildren(trader,flea,extra);slot.title=`${marketModeName(mode)} · 最近采样：${marketTime(value?.scannedAt)}；数据更新：${marketTime(value?.updatedAt)}`;
  }
  async function load(reload=false){
    const current=++request,chosen=mode;loadedMarket=null;summary?.loading();retry.disabled=true;status.textContent='正在获取价格…';for(const slot of slots)slot.textContent='价格加载中…';
    try{const market=await client.load(chosen,{reload});if(current!==request||!controls.isConnected)return;
      loadedMarket=market;summary?.market(market);for(const slot of slots)slot.textContent='参考价格';for(const slot of visible)renderItem(slot,market);
      status.textContent=`${market.stale?'缓存价格，更新暂不可用。 ':''}获取：${marketTime(market.fetchedAt)} · tarkov.dev · 未扣手续费`;
    }catch{if(current!==request||!controls.isConnected)return;summary?.error();status.textContent='价格暂不可用，可刷新重试。';for(const slot of slots)slot.textContent='暂无价格数据';}
    if(current===request)retry.disabled=false;
  }
  if(session){
    retry.onclick=()=>session.load(session.state.mode,{reload:true});
    unsubscribe=session.subscribe(s=>{
      mode=s.mode;loadedMarket=s.market;retry.disabled=s.status==='loading';
      if(s.market){summary?.market(s.market);for(const slot of slots)slot.textContent='参考价格';for(const slot of visible)renderItem(slot,s.market);status.textContent=`${s.market.stale?'缓存价格 · ':''}${marketTime(s.market.fetchedAt)} · 与全图筛选共用 · 未扣手续费`;}
      else if(s.status==='error'){summary?.error();status.textContent='价格暂不可用，可刷新重试。';for(const slot of slots)slot.textContent='暂无价格数据';}
      else{summary?.loading();status.textContent='正在获取全图价格…';for(const slot of slots)slot.textContent='价格加载中…';}
    });session.ensure();
  }else{unsubscribe=subscribeGameMode(value=>{mode=value;load();});retry.onclick=()=>load(true);load();}
}
