import {marketClient} from './atlas-market-client.js';
import {MARKET_MODES} from './atlas-high-value-data.js';

// One explicit price snapshot for filters and every point detail on this page.
export function createMapMarketSession({client=marketClient,initialMode='regular'}={}){
  let state={mode:MARKET_MODES.some(([id])=>id===initialMode)?initialMode:'regular',status:'idle',market:null,error:null};
  let epoch=0,pending=null;const listeners=new Set();
  const emit=()=>{for(const listener of listeners)listener(state);};
  function load(mode=state.mode,{reload=false}={}){
    if(!MARKET_MODES.some(([id])=>id===mode))throw new Error('无效价格模式');
    if(!reload&&mode===state.mode&&pending)return pending;
    if(!reload&&mode===state.mode&&state.status==='ready')return Promise.resolve(state.market);
    const request=++epoch;state={mode,status:'loading',market:null,error:null};emit();
    pending=Promise.resolve().then(()=>client.load(mode,{reload})).then(market=>{
      if(request!==epoch)return null;
      state={mode,status:'ready',market,error:null};pending=null;emit();return market;
    },error=>{if(request===epoch){pending=null;state={mode,status:'error',market:null,error};emit();}return null;});
    return pending;
  }
  return {get state(){return state;},load,ensure:()=>state.status==='idle'?load():pending||Promise.resolve(state.market),
    subscribe(listener){listeners.add(listener);listener(state);return ()=>listeners.delete(listener);}};
}
