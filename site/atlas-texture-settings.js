import {TEXTURE_QUALITIES,readTextureQuality,saveTextureQuality} from './atlas-texture-quality.js';
import {DEFAULT_GEOMETRY_QUALITY,GEOMETRY_QUALITIES,readGeometryQuality,saveGeometryQuality} from './atlas-geometry-quality.js';
import {readSceneryMode,saveSceneryMode} from './atlas-scenery-details.js';

export function createTextureSettings(dialog,{home=false,onApplied=()=>{}}={}){
  const apply=dialog.querySelector('#applyTextureQuality');
  if(home)apply.textContent='保存资源设置';
  const make=(kind,choices,read,save,hint)=>{
    const select=dialog.querySelector(`#${kind}Quality`),status=dialog.querySelector(`#${kind}QualityStatus`),saved=read();
    select.innerHTML=Object.entries(choices).map(([id,{label}])=>`<option value="${id}">${label}</option>`).join('');select.value=saved;
    return {select,status,saved,active:saved,warning:'',locked:false,save,hint};
  };
  const texture=make('texture',TEXTURE_QUALITIES,readTextureQuality,saveTextureQuality,'降低贴图精度可减少下载和显存占用。'),geometry=make('geometry',GEOMETRY_QUALITIES,readGeometryQuality,saveGeometryQuality,'降低模型精度可减少几何数据，近看时细节会减少。'),all=[geometry,texture];
  const changed=entry=>!entry.locked&&(entry.select.value!==entry.active||entry.select.value!==entry.saved);
  const scenery={input:dialog.querySelector('#loadSceneryDetails'),status:dialog.querySelector('#sceneryDetailsStatus'),saved:readSceneryMode(),active:readSceneryMode(),locked:false,warning:'',stats:null};
  scenery.input.checked=scenery.saved==='full';
  const sceneryValue=()=>scenery.input.checked?'full':'simple';
  const sceneryChanged=()=>!scenery.locked&&(sceneryValue()!==scenery.active||sceneryValue()!==scenery.saved);
  function sync(){
    apply.hidden=!all.some(changed)&&!sceneryChanged();
    const pending=home?'保存后在下次进入地图时生效，所有地图共用此设置。':'应用后重新加载地图，所有地图共用此设置。';
    for(const entry of all)entry.status.textContent=entry.locked?'编辑时使用原始模型。':entry.warning||(changed(entry)?pending:entry.hint);
    const savings=scenery.stats?`本图少载入 ${((scenery.stats.sourceBytes-scenery.stats.bytes)/2**20).toFixed(1)} MiB 模型数据。`:'';
    scenery.status.textContent=scenery.locked?'编辑时保留完整场景。':scenery.warning||(sceneryChanged()?pending:'关闭后跳过已筛选的废纸、酒瓶、碎砖和零散垃圾，减少下载与内存占用。'+savings);
  }
  for(const entry of all)entry.select.onchange=sync;
  scenery.input.onchange=sync;
  apply.onclick=()=>{
    for(const entry of all)if(!entry.locked&&!entry.save(entry.select.value)){entry.status.textContent='当前浏览器无法保存设置，请允许网站存储后重试。';return;}
    if(!scenery.locked&&!saveSceneryMode(sceneryValue())){scenery.status.textContent='当前浏览器无法保存设置，请允许网站存储后重试。';return;}
    if(home){
      for(const entry of all)entry.saved=entry.active=entry.select.value;
      scenery.saved=scenery.active=sceneryValue();sync();onApplied();
    }else{apply.disabled=true;location.reload();}
  };
  function loaded(entry,result){entry.active=result.quality;entry.warning=result.warning||'';entry.locked=Boolean(result.locked);if(entry.locked){entry.select.value=result.quality;entry.select.disabled=true;}sync();}
  sync();
  return {loaded:result=>loaded(texture,result),geometryLoaded:result=>loaded(geometry,result),sceneryLoaded(result){scenery.active=result.scenery;scenery.warning=result.sceneryWarning||'';scenery.stats=result.sceneryStats;scenery.locked=Boolean(result.locked);if(scenery.locked){scenery.input.checked=true;scenery.input.disabled=true;}sync();},reset(){if(!geometry.locked)geometry.select.value=DEFAULT_GEOMETRY_QUALITY;if(!texture.locked)texture.select.value='medium';if(!scenery.locked)scenery.input.checked=true;sync();}};
}
