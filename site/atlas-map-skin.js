import {icon} from './ui-icons.js';

export const MAP_SKIN_KEY='atlas-map-skin-v1';
const palettes=Object.freeze({
  night:Object.freeze({background:'#101820',label:'黑夜',gridOpacity:1}),
  day:Object.freeze({background:'#e5e7e1',label:'白天',gridOpacity:.24})
});
export const validateMapSkin=value=>value==='day'?'day':'night';
export const mapSkinPalette=value=>palettes[validateMapSkin(value)];

// One preference across maps; per-map camera and performance settings stay independent.
export function createMapSkinController({storage,events=globalThis.window,onChange=()=>{}}={}){
  if(storage===undefined)try{storage=globalThis.localStorage;}catch{}
  let skin='night';
  try{skin=validateMapSkin(storage.getItem(MAP_SKIN_KEY));}catch{}
  function apply(value,persist){
    const next=validateMapSkin(value);
    if(persist)try{storage.setItem(MAP_SKIN_KEY,next);}catch{}
    if(next===skin)return;
    skin=next;onChange(skin,mapSkinPalette(skin));
  }
  events?.addEventListener('storage',event=>{
    if(event.storageArea&&event.storageArea!==storage)return;
    if(event.key===MAP_SKIN_KEY)apply(event.newValue,false);
    else if(event.key===null)apply('night',false);
  });
  onChange(skin,mapSkinPalette(skin));
  return {get skin(){return skin;},set:value=>apply(value,true),toggle:()=>apply(skin==='night'?'day':'night',true)};
}

export function createMapSkinUI({settings,onChange=()=>{}}){
  const field=document.createElement('fieldset');field.id='mapSkinSettings';
  field.innerHTML='<legend>显示皮肤</legend><label for="mapSkin">地图皮肤</label><select id="mapSkin"><option value="night">黑夜（默认）</option><option value="day">白天</option></select><p class="hint">白天使用浅色地图背景。</p>';
  settings.querySelector('.view-dialog-head').after(field);
  const select=field.querySelector('select'),button=document.createElement('button');button.id='toggleMapSkin';button.type='button';
  button.setAttribute('aria-controls','mapSkin');
  const controller=createMapSkinController({onChange:(skin,palette)=>{
    document.body.dataset.mapSkin=skin;
    document.body.style.setProperty('--map-background',palette.background);
    select.value=skin;
    const next=skin==='night'?'白天':'黑夜';
    button.innerHTML=icon(skin==='night'?'moon':'sun')+`<span>${palette.label}皮肤</span>`;
    button.setAttribute('aria-label',`切换到${next}皮肤`);button.title=`切换到${next}皮肤`;
    button.setAttribute('aria-pressed',String(skin==='day'));
    onChange(palette);
  }});
  select.addEventListener('change',()=>controller.set(select.value));
  button.addEventListener('click',()=>controller.toggle());
  settings.querySelector('#resetViewPreferences').addEventListener('click',()=>controller.set('night'));
  return {button};
}
