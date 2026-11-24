import {MARKET_MODES} from './atlas-high-value-data.js';

export const GAME_MODE_KEY='tarkov-game-mode-v1';
const valid=value=>MARKET_MODES.some(([id])=>id===value);
const listeners=new Set();
function savedMode(){
  try{
    const current=JSON.parse(localStorage.getItem(GAME_MODE_KEY));
    if(valid(current))return current;
    const previous=JSON.parse(localStorage.getItem('atlas-map-price-mode-v1'));
    if(valid(previous))return previous;
    const scanner=JSON.parse(localStorage.getItem('tarkov-image-loot-v1'))?.mode;
    if(valid(scanner))return scanner;
  }catch{}
  return 'regular';
}
let mode=savedMode();
export const getGameMode=()=>mode;
export function setGameMode(next,{persist=true}={}){
  if(!valid(next)||next===mode)return;
  mode=next;
  if(persist)try{localStorage.setItem(GAME_MODE_KEY,JSON.stringify(mode));}catch{}
  for(const listener of listeners)listener(mode);
}
export function subscribeGameMode(listener){listeners.add(listener);return()=>listeners.delete(listener);}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key===GAME_MODE_KEY||event.key===null)setGameMode(savedMode(),{persist:false});
});
export function mountGameMode(){
  const host=document.querySelector('body > header');
  if(!host||host.querySelector('[data-game-mode]'))return;
  const label=document.createElement('label');label.className='header-game-mode';
  const caption=document.createElement('span');caption.textContent='游戏模式';
  const select=document.createElement('select');select.dataset.gameMode='';select.id='gameMode';select.setAttribute('aria-label','游戏模式');
  for(const [id,name] of MARKET_MODES){const option=document.createElement('option');option.value=id;option.textContent=name;select.append(option);}
  select.value=mode;select.addEventListener('change',()=>setGameMode(select.value));
  subscribeGameMode(value=>select.value=value);label.append(caption,select);host.append(label);
}
if(typeof document!=='undefined')mountGameMode();
