import {icon} from './ui-icons.js';
import {parseScreenshotFilename,createScreenshotWatcher} from './atlas-screenshot-location.js';
import {createScreenshotDirectoryAccess} from './atlas-screenshot-directory.js';

const preferenceKey='atlas-screenshot-auto-v1';
export function createScreenshotLocationUI({map,tools,viewport,onLocate,onClear,onNotice=()=>{}}){
  const access=createScreenshotDirectoryAccess(),supported=access.supported;
  let directory=null,needsPermission=false,ready=false,suspended=false,busy=false,generation=0,last=null;
  let preferredAuto=false;try{preferredAuto=localStorage.getItem(preferenceKey)==='true';}catch{}
  const group=document.createElement('div');group.className='screenshot-tools';group.setAttribute('role','group');group.setAttribute('aria-label','截图定位');
  group.innerHTML=`<button id="locateScreenshot" type="button" title="读取最新游戏截图并定位">${icon('focus')}<span>截图定位</span><i class="screenshot-auto-dot" hidden></i></button><button id="screenshotSettings" type="button" aria-label="截图定位设置" title="截图目录与自动定位" aria-haspopup="dialog" aria-controls="screenshotDialog" aria-expanded="false"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>`;
  tools.insertBefore(group,tools.querySelector('#extraMapTools'));
  const main=group.querySelector('#locateScreenshot'),settings=group.querySelector('#screenshotSettings');
  const dialog=document.createElement('dialog');dialog.id='screenshotDialog';dialog.className='screenshot-dialog';dialog.setAttribute('aria-labelledby','screenshotTitle');
  dialog.innerHTML=`<div class="screenshot-head"><h2 id="screenshotTitle">截图定位</h2><button type="button" data-close aria-label="关闭截图定位">${icon('close')}</button></div>
    <p class="screenshot-intro">游戏中按 <kbd>Print Screen</kbd> 截图，即可定位。</p>
    <div class="screenshot-directory"><span class="hint">截图目录</span><span data-directory>正在查找截图目录…</span><div class="screenshot-actions"><button type="button" data-detect>自动查找</button><button type="button" data-choose>选择目录</button></div></div>
    <p class="hint" data-support></p>
    <label class="screenshot-auto"><input type="checkbox" data-auto>新截图自动定位</label>
    <button type="button" class="screenshot-read" data-read>立即定位</button>
    <p data-status role="status" aria-live="polite"></p>
    <details class="screenshot-paste"><summary>更多选项</summary>
      <p class="screenshot-map"></p>
      <div class="screenshot-actions"><button type="button" data-file>选择单张截图</button><button type="button" data-clear disabled>清除标记</button><button type="button" data-forget hidden>断开目录</button></div>
      <input type="file" data-file-input accept=".png,.jpg,.jpeg" hidden>
      <form><label for="screenshotFilename">粘贴截图文件名</label><input id="screenshotFilename" type="text" autocomplete="off" spellcheck="false" placeholder="原始文件名或完整路径"><button type="submit">定位</button></form>
      <p data-last class="screenshot-last" hidden></p><p class="hint">只读取文件名和时间，不上传图片。自动定位需保持地图打开。</p>
    </details>`;
  document.body.append(dialog);
  const find=selector=>dialog.querySelector(selector),auto=find('[data-auto]'),status=find('[data-status]'),fileInput=find('[data-file-input]');
  find('.screenshot-map').textContent=`当前地图：${map.name} · 请与游戏地图保持一致`;
  find('[data-support]').textContent=access.native?'自动查找“文档 / Escape from Tarkov / Screenshots”。':supported?'首次选择截图目录后会记住；也可选择“文档”，自动查找其中的游戏截图目录。':'当前浏览器不支持目录读取，请在“更多选项”选择单张截图。';
  find('[data-detect]').hidden=!access.native;
  const marker=document.createElement('div');marker.id='screenshotPlayerMarker';marker.hidden=true;marker.innerHTML='<i></i><span>截图位置</span>';viewport.append(marker);
  function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);onNotice(text);}
  function remember(){try{localStorage.setItem(preferenceKey,String(preferredAuto));}catch{}}
  function sync(){
    main.disabled=!ready||busy;main.classList.toggle('active',watcher.automatic);
    main.title=directory?'读取最新游戏截图并定位':'设置截图目录或选择单张截图';
    main.setAttribute('aria-label',watcher.automatic?'截图定位，自动定位已开启':'截图定位');
    group.querySelector('.screenshot-auto-dot').hidden=!watcher.automatic;
    auto.checked=watcher.automatic;auto.disabled=!directory||!supported||busy;
    find('[data-choose]').disabled=!supported||busy;find('[data-choose]').textContent=directory?'更换':'选择目录';
    find('[data-detect]').disabled=busy;
    find('[data-forget]').hidden=!directory;find('[data-forget]').disabled=busy;
    find('[data-read]').disabled=!ready||!directory||busy;find('[data-file]').disabled=!ready||busy;
    find('form button').disabled=!ready||busy;
    find('[data-directory]').textContent=directory?`${directory.displayPath||directory.name}${needsPermission?' · 需要重新授权':''}`:access.native?'未找到截图目录，请先在游戏中截图':'尚未选择截图目录';
    find('[data-directory]').title=directory?.displayPath||directory?.name||'';
    find('[data-clear]').disabled=!last;
  }
  function located(screenshot){
    onLocate(screenshot);last=screenshot;
    const {x,y,z}=screenshot.position,coords=`X ${x.toFixed(2)} · Y ${y.toFixed(2)} · Z ${z.toFixed(2)}`;
    marker.title=`截图位置 · ${coords}`;marker.setAttribute('aria-label',marker.title);
    const time=screenshot.name.match(/^\d{4}-\d{2}-\d{2}\[[^\]]+\]/)?.[0]||'';
    message(`已定位到${map.name} · ${coords}`);
    find('[data-last]').hidden=false;find('[data-last]').textContent=`截图时间 ${time}（游戏电脑时间）\n${screenshot.name}`;
    sync();
  }
  const watcher=createScreenshotWatcher({onLocate:located,onError(error){
    needsPermission=['NotAllowedError','SecurityError'].includes(error.name);
    if(!watcher.automatic){preferredAuto=false;remember();}
    message(needsPermission?'请点击“立即定位”重新授权。':error.message,true);sync();
  }});
  function open(){if(!dialog.open)dialog.showModal();settings.setAttribute('aria-expanded','true');}
  dialog.addEventListener('close',()=>{settings.setAttribute('aria-expanded','false');settings.focus({preventScroll:true});});
  find('[data-close]').onclick=()=>dialog.close();settings.onclick=open;
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  async function run(action){
    if(busy)return;busy=true;sync();
    try{await action();}catch(error){if(error.name!=='AbortError')message(error.message||'截图目录读取失败，请重新选择目录。',true);}
    finally{busy=false;sync();}
  }
  async function authorize(){
    if(needsPermission){const granted=await directory.requestPermission({mode:'read'});if(granted!=='granted')throw Error('尚未获得截图目录的读取权限。');needsPermission=false;}
  }
  async function connect(chosen){
    if(!chosen)return false;
    directory=chosen;needsPermission=false;watcher.connect(chosen);watcher.setAutomatic(preferredAuto);
    message('目录已连接，可立即定位。');
    try{await access.save(chosen);}catch{await access.forget().catch(()=>{});message('目录已连接，本次无法记住目录。');}
    return true;
  }
  function read(){
    if(!directory){open();if(access.native)return run(async()=>{generation++;if(await connect(await access.detect()))await watcher.read();});return;}
    return run(async()=>{await authorize();await watcher.read();});
  }
  main.onclick=read;find('[data-read]').onclick=read;
  find('[data-choose]').onclick=()=>run(async()=>{
    generation++;await connect(await access.choose());
  });
  find('[data-detect]').onclick=()=>run(async()=>{generation++;if(!await connect(await access.detect()))message('未找到默认目录，请先按 Print Screen 截图，或手动选择目录。',true);});
  find('[data-forget]').onclick=()=>run(async()=>{
    generation++;watcher.setAutomatic(false);watcher.connect(null);preferredAuto=false;remember();directory=null;needsPermission=false;
    await access.forget();message('已断开截图目录。');
  });
  auto.onchange=()=>{const enabled=auto.checked;void run(async()=>{await authorize();preferredAuto=enabled;remember();watcher.setAutomatic(enabled);message(enabled?'自动定位已开启，等待新截图。':'自动定位已关闭，可点击按钮读取最新截图。');});};
  find('[data-file]').onclick=()=>fileInput.click();
  function locateName(name){
    if(!ready)return;const screenshot=parseScreenshotFilename(name);
    if(!screenshot){message('文件名中没有可识别的坐标，请选择游戏内 Print Screen 保存的原始截图。',true);return;}
    try{located(screenshot);}catch(error){message(error.message,true);}
  }
  fileInput.onchange=()=>{const file=fileInput.files?.[0];if(file)locateName(file.name);fileInput.value='';};
  find('form').onsubmit=event=>{event.preventDefault();locateName(find('#screenshotFilename').value);};
  find('[data-clear]').onclick=()=>{last=null;marker.hidden=true;onClear();find('[data-last]').hidden=true;message('已清除截图位置标记。');sync();};
  const resume=()=>{if(ready&&!suspended&&watcher.automatic)void watcher.poll();};
  const visibility=()=>{if(!document.hidden)resume();};
  const hide=()=>watcher.setSuspended(true),show=()=>{watcher.setSuspended(!ready||suspended);};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  const stamp=generation;
  void (async()=>{
    try{
      const saved=await access.restore();if(stamp!==generation||!saved||!supported)return;
      const permission=await saved.queryPermission({mode:'read'});if(stamp!==generation)return;
      directory=saved;needsPermission=permission!=='granted';watcher.connect(saved);
      if(needsPermission)message('已记住目录，点击“立即定位”授权。');
      else if(preferredAuto){watcher.setAutomatic(true);message('自动定位已恢复，等待新截图。');}
      else message(access.native?'已连接截图目录，可立即定位。':'已恢复截图目录，可立即定位。');
    }catch{message('无法恢复截图目录，请重新选择。');}finally{sync();}
  })();
  sync();
  return {
    marker,
    ready(){ready=true;watcher.setSuspended(suspended);sync();},
    setSuspended(value){suspended=value;watcher.setSuspended(!ready||suspended);if(value&&dialog.open)dialog.close();},
    dispose(){generation++;watcher.dispose();window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);dialog.remove();marker.remove();group.remove();},
  };
}
