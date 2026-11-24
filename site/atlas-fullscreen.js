import {icon} from './ui-icons.js';

// Fullscreen is a browser permission and can also end through system controls.
// Keep the button tied to the actual document state, never an optimistic flag.
export function bindFullscreenControl({button,document:doc=document,onUnavailable=()=>{}}){
  const root=doc.documentElement;
  const active=()=>Boolean(doc.fullscreenElement||doc.webkitFullscreenElement);
  function sync(){
    const enabled=active(),label=enabled?'退出全屏':'全屏';
    button.innerHTML=icon(enabled?'fullscreenExit':'fullscreen')+`<span>${label}</span>`;
    button.setAttribute('aria-pressed',String(enabled));
    button.setAttribute('aria-label',enabled?'退出全屏':'进入全屏');
    button.title=enabled?'退出全屏':'全屏显示地图';
  }
  async function toggle(){
    if(button.disabled)return;
    const exiting=active();
    const standard=exiting?doc.exitFullscreen:root.requestFullscreen;
    const method=standard||(exiting?doc.webkitExitFullscreen:root.webkitRequestFullscreen);
    const allowed=exiting||(standard?doc.fullscreenEnabled:doc.webkitFullscreenEnabled)!==false;
    if(!method||!allowed){onUnavailable(exiting?'exit':'unsupported');return;}
    button.disabled=true;
    try{
      // Invoke synchronously inside the click: awaiting first loses user activation.
      await method.call(exiting?doc:root,...(!exiting&&standard?[{navigationUI:'hide'}]:[]));
    }catch{onUnavailable(exiting?'exit':'denied');}
    finally{button.disabled=false;sync();}
  }
  button.addEventListener('click',toggle);
  for(const name of ['fullscreenchange','webkitfullscreenchange'])doc.addEventListener(name,sync);
  doc.addEventListener('webkitfullscreenerror',()=>onUnavailable(active()?'exit':'denied'));
  sync();
  return {toggle,sync};
}

export function createFullscreenButton(){
  const button=document.createElement('button');button.id='fullscreenMap';button.type='button';
  const help=document.createElement('dialog');help.className='map-guide fullscreen-guide';help.id='fullscreenHelp';
  help.setAttribute('aria-labelledby','fullscreenTitle');
  help.innerHTML=`<div class="guide-head"><h2 id="fullscreenTitle">全屏显示</h2><button type="button" aria-label="关闭全屏说明">${icon('close')}</button></div><p class="fullscreen-status" role="status"></p><p>想减少地址栏和工具栏占用，也可以将网站添加到主屏幕，再从桌面图标打开。</p><ol><li>iPhone / iPad：打开浏览器的分享菜单，选择“添加到主屏幕”；如有“作为网页 App 打开”，保持开启。</li><li>安卓：打开浏览器菜单，选择“添加到主屏幕”或“安装应用”。</li></ol><p class="guide-note">全屏后可再次点“退出全屏”，或使用系统返回手势；电脑也可按 Esc 退出。</p>`;
  help.querySelector('button').onclick=()=>help.close();document.body.append(help);
  bindFullscreenControl({button,onUnavailable:reason=>{
    help.querySelector('.fullscreen-status').textContent={unsupported:'此浏览器暂不支持网页直接进入全屏。',denied:'浏览器未允许本次全屏，请关闭说明后重试，或从浏览器菜单检查相关设置。',exit:'浏览器未能退出全屏，请使用系统返回手势或 Esc。'}[reason];
    if(!help.open)help.showModal();
  }});
  return button;
}
