import {readSceneryMode,saveSceneryMode} from './atlas-scenery-details.js';

export function createScenerySettings(dialog,{home=false,onApplied=()=>{}}={}){
  const apply=dialog.querySelector('#applySceneryDetails');
  const input=dialog.querySelector('#loadSceneryDetails');
  const status=dialog.querySelector('#sceneryDetailsStatus');
  const help=dialog.querySelector('#sceneryDetailsHelp');
  if(home)apply.textContent='保存资源设置';
  let saved=readSceneryMode(),active=saved,warning='',stats;
  input.checked=saved==='full';
  const value=()=>input.checked?'full':'simple';
  function sync(){
    const changed=value()!==saved||value()!==active;
    apply.hidden=!changed;
    const savings=stats?`本图少载入 ${((stats.sourceBytes-stats.bytes)/2**20).toFixed(1)} MiB 模型数据。`:'';
    help.textContent='关闭可减少下载和内存占用。此设置适用于所有地图。'+savings;
    status.textContent=warning;
  }
  input.onchange=sync;
  apply.onclick=()=>{
    if(!saveSceneryMode(value())){status.textContent='当前浏览器无法保存设置，请允许网站存储后重试。';return;}
    if(home){
      saved=active=value();sync();onApplied();
    }else{apply.disabled=true;location.reload();}
  };
  sync();
  return {loaded(result){active=result.scenery;warning=result.sceneryWarning||'';stats=result.sceneryStats;sync();},reset(){input.checked=true;sync();}};
}
