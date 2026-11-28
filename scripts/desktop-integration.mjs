// Real Chromium directory handles in an isolated OPFS profile. The picker alone
// is substituted: this does not claim to test the OS picker or external grants.
import assert from 'node:assert/strict';
import {runScreenshotIntegration} from './desktop-screenshot-integration.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runDesktopIntegration(win, {restore = false, screenshots} = {}) {
  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  async function until(expression, label, timeout = 120000) {
    const deadline = Date.now() + timeout;
    let nextLog=Date.now()+15000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      if(Date.now()>nextLog){console.log(JSON.stringify({waitingFor:label,state:await evaluate(`({status:document.getElementById('loadMessage')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.textContent)})`)}));nextLog=Date.now()+15000;}
      await sleep(100);
    }
    throw Error(`Integration timed out: ${label}`);
  }
  const originalFetch = globalThis.fetch;
  let offline = restore, requests = 0;
  const offlineUrls = [];
  globalThis.fetch = async (...args) => {
    requests++;
    if (offline) { offlineUrls.push(String(args[0])); throw Error('Integration resource network offline'); }
    return originalFetch(...args);
  };
  const results = {storage: 'Chromium OPFS',nativePickerChecked: false, externalPermissionChecked: false, restoredProcess: restore};
  try {
    await win.loadURL('tarkov://app/index.html');
    const ready=`Boolean(window.factoryDebug?.state.groups.length) && document.getElementById('loading').style.display==='none' && document.getElementById('streamStatus').hidden`;
    if (!restore) {
      await evaluate(`localStorage.setItem('atlas-scenery-details-v1','full')`);
      const supported = await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();globalThis.qaRoot=await root.getDirectoryHandle('resource-test',{create:true});const sentinel=await qaRoot.getFileHandle('outside-managed.txt',{create:true});const writer=await sentinel.createWritable();await writer.write('must remain untouched');await writer.close();globalThis.showDirectoryPicker=async options=>{if(options.mode!=='readwrite')throw Error('Unexpected mode');return qaRoot;};return qaRoot instanceof FileSystemDirectoryHandle;})()`);
      assert.equal(supported, true);
      await evaluate(`(async()=>{await (await import('./atlas-managed-resources.js')).managedResources.choose();})()`);
      await win.loadURL('tarkov://app/factory.html');
      await until(ready,'initial map visit',240000);
      assert.ok(requests>0);
    }
    // Load the map again using only the saved resources and directory handle.
    offline = true;
    const offlineStart = requests;
    await win.loadURL('tarkov://app/factory.html');
    await until(ready,'offline map',180000);
    const directory = await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.stats({scan:true}))()`);
    assert.equal(directory.connected, true); assert.equal(directory.needsPermission, false);
    results.inventory = directory.maps;
    assert.ok(results.inventory.find(map=>map.mapId==='factory')?.count > 100);
    const sentinel = await evaluate(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('resource-test');return (await (await root.getFileHandle('outside-managed.txt')).getFile()).text();})()`);
    assert.equal(sentinel, 'must remain untouched'); results.unrelatedFilePreserved = true;
    assert.equal(await evaluate(`document.querySelector('.map-tools').getBoundingClientRect().bottom <= innerHeight + 1`), true);
    results.offlineMap = true;
    results.offlineResourceRequests = requests - offlineStart;
    if (offlineUrls.length) console.log(JSON.stringify({offlineUrls}));
    assert.equal(results.offlineResourceRequests, 0);
    if (restore) assert.equal(requests, 0);

    Object.assign(results, await runScreenshotIntegration(win, {screenshots, restore}));
    console.log(JSON.stringify({desktopIntegration: 'passed', ...results}));
    return results;
  } finally { globalThis.fetch = originalFetch; await win.loadURL('tarkov://app/index.html'); }
}
