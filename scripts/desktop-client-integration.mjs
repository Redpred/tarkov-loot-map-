import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runScreenshotIntegration} from './desktop-screenshot-integration.mjs';

export async function runClientDirectoryIntegration(win,{restore=false,screenshots}={}) {
  const evaluate=expression=>win.webContents.executeJavaScript(expression,true);
  const until=async(expression,label,timeout=240000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Client integration timed out: '+label);};
  const networkFetch=globalThis.fetch;let offline=restore,requests=0;
  globalThis.fetch=(...args)=>{requests++;if(offline)throw Error('Client resource network disabled');return networkFetch(...args);};
  try {
    await win.loadURL('tarkov://app/index.html');
    await until(`document.querySelectorAll('.map-card').length===13`,'home');
    assert.equal(await evaluate(`document.querySelector('.client-resource-home')===null`),true);
    await evaluate(`document.getElementById('openHomeSettings').click()`);
    await until(`document.querySelector('[data-managed-status]')?.textContent.includes('客户端本地资源：')`,'local resource settings');
    assert.equal(await evaluate(`!document.querySelector('[data-managed-downloads]').hidden && !document.querySelector('[data-managed-folder]').hidden`),true);
    await evaluate(`document.getElementById('viewSettings').close()`);
    assert.equal(await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.mode())()`),'client');
    const info=await evaluate(`fetch('/api/client-resources').then(r=>r.json())`);
    assert.equal(info.available,true);assert.equal(path.basename(info.path),'map-resources');
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`),0,'First launch requires no directory picker');
    const sentinel=path.join(info.path,'user-sentinel.txt');
    if(!restore)await fs.writeFile(sentinel,'keep');
    await win.loadURL('tarkov://app/desktop-downloads.html');
    await until(`document.querySelector('#map')?.options.length===13`,'download page');
    await evaluate(`localStorage.setItem('atlas-geometry-quality-v1','low');localStorage.setItem('atlas-texture-quality-v1','medium');localStorage.setItem('atlas-scenery-details-v1','full');document.getElementById('geometry').value='low';document.getElementById('texture').value='medium';document.getElementById('scenery').value='full'`);
    if(!restore){
      await evaluate(`document.getElementById('download').click()`);
      await until(`document.getElementById('progress').value>1||document.getElementById('status').textContent.startsWith('未完成')`,'partial save');
      assert.equal(await evaluate(`document.getElementById('status').textContent.startsWith('未完成')`),false,await evaluate(`document.getElementById('status').textContent`));
      await evaluate(`document.getElementById('pause').click()`);
      await until(`document.getElementById('status').textContent.startsWith('已暂停')`,'pause');
    }
    await evaluate(`document.getElementById('download').click()`);
    await until(`document.getElementById('status').textContent.includes('下载并校验完成')||document.getElementById('status').textContent.startsWith('未完成')`,'complete download');
    assert.match(await evaluate(`document.getElementById('status').textContent`),/下载并校验完成/);
    const inventory=await evaluate(`(async()=>(await import('./atlas-resource-cache.js')).resourceCache.inventory())()`);
    assert.equal(inventory.records.filter(row=>/^(geometry|texture)(:|-chunk:)/.test(row.identity)).length,0,'No duplicate model/texture copy in browser cache');
    let count=0,bytes=0;
    async function scan(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await scan(file);else{count++;bytes+=(await fs.stat(file)).size;}}}
    await scan(info.path);assert.ok(count>500);assert.ok(bytes>60*2**20);
    offline=true;const before=requests;
    await win.loadURL('tarkov://app/factory.html');
    await until(`Boolean(window.factoryDebug?.state.groups.length)&&document.getElementById('loading').style.display==='none'&&document.getElementById('streamStatus').hidden`,'offline map');
    assert.equal(requests,before);assert.equal(await fs.readFile(sentinel,'utf8'),'keep');
    assert.equal(await evaluate(`document.querySelectorAll('.resource-location-dialog[open]').length`),0);
    // ESC on a recovery prompt must not switch the desktop back to online.
    await evaluate(`(async()=>{const ui=await import('./atlas-resource-location-ui.js');void ui.showResourceLocation({recovery:true});})()`);
    await until(`Boolean(document.querySelector('.resource-location-dialog[open]'))`,'recovery dialog');
    await evaluate(`document.querySelector('.resource-location-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`);
    assert.equal(await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.mode())()`),'client');
    await evaluate(`document.querySelector('[data-location-client]').click()`);
    await until(`!document.querySelector('.resource-location-dialog[open]')`,'local recovery');
    if(restore)assert.equal(requests,0);
    const screenshotResult=await runScreenshotIntegration(win,{screenshots,restore});
    return {...screenshotResult,homeResourcePanelRemoved:true,resourceSettingsAvailable:true,defaultDirectory:true,requiresPicker:false,restoredProcess:restore,pauseResume:!restore,offlineMap:true,offlineResourceRequests:requests-before,resourceRequests:requests,files:count,bytes,browserCopies:0,unrelatedFilePreserved:true};
  }finally{globalThis.fetch=networkFetch;await win.loadURL('tarkov://app/index.html');}
}
