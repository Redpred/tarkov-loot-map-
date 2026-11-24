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
    while (Date.now() < deadline) { if (await evaluate(expression)) return;if(Date.now()>nextLog){console.log(JSON.stringify({waitingFor:label,state:await evaluate(`({status:document.getElementById('status')?.textContent,progress:document.getElementById('progress')?.value,disabled:document.getElementById('download')?.disabled,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.textContent),fault:globalThis.qaDiskFault})`)}));nextLog=Date.now()+15000;}await sleep(100); }
    throw Error(`Integration timed out: ${label}`);
  }
  const originalFetch = globalThis.fetch;
  let offline = restore, slow = !restore, requests = 0, blocked = 0;
  const offlineUrls = [];
  globalThis.fetch = async (...args) => {
    requests++;
    if (offline) { blocked++; offlineUrls.push(String(args[0])); throw Error('Integration resource network offline'); }
    if (slow) await sleep(100);
    return originalFetch(...args);
  };
  const results = {storage: 'Chromium OPFS',nativePickerChecked: false, externalPermissionChecked: false, restoredProcess: restore};
  try {
    await win.loadURL('tarkov://app/desktop-downloads.html');
    await until(`document.querySelector('#map')?.options.length===13`, 'download page');
    await evaluate(`localStorage.setItem('atlas-geometry-quality-v1','low');localStorage.setItem('atlas-texture-quality-v1','medium');localStorage.setItem('atlas-scenery-details-v1','full');document.getElementById('geometry').value='low';document.getElementById('texture').value='medium';document.getElementById('scenery').value='full'`);
    if (!restore) {
      const supported = await evaluate(`(async()=>{const root=await navigator.storage.getDirectory();globalThis.qaRoot=await root.getDirectoryHandle('resource-test',{create:true});const sentinel=await qaRoot.getFileHandle('outside-managed.txt',{create:true});const writer=await sentinel.createWritable();await writer.write('must remain untouched');await writer.close();globalThis.showDirectoryPicker=async options=>{if(options.mode!=='readwrite')throw Error('Unexpected mode');return qaRoot;};return qaRoot instanceof FileSystemDirectoryHandle;})()`);
      assert.equal(supported, true);
      await evaluate(`(async()=>{await (await import('./atlas-managed-resources.js')).managedResources.choose();})()`);
      await win.loadURL('tarkov://app/desktop-downloads.html');
    }
    await until(`document.getElementById('directory').textContent.includes('资源目录：')`, 'remembered resource directory');
    const directory = await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.stats())()`);
    assert.equal(directory.connected, true); assert.equal(directory.needsPermission, false);
    if (!restore) {
      await evaluate(`globalThis.qaWrite=FileSystemFileHandle.prototype.createWritable;globalThis.qaDiskFault=true;FileSystemFileHandle.prototype.createWritable=function(...args){if(qaDiskFault&&/^0-\\d+$/.test(this.name)){qaDiskFault=false;throw new DOMException('Injected disk full','QuotaExceededError');}return qaWrite.apply(this,args);};document.getElementById('download').click()`);
      await until(`document.getElementById('status').textContent.startsWith('未完成')`, 'injected disk failure');
      assert.match(await evaluate(`document.getElementById('status').textContent`), /磁盘空间不足/);
      await evaluate(`FileSystemFileHandle.prototype.createWritable=qaWrite;void 0`);
      results.injectedDiskFailureRecoverable = true;
      await evaluate(`document.getElementById('download').click()`);
      await until(`document.getElementById('progress').value>0 || document.getElementById('status').textContent.startsWith('未完成')`, 'partial download');
      assert.equal(await evaluate(`document.getElementById('status').textContent.startsWith('未完成')`), false, await evaluate(`document.getElementById('status').textContent`));
      await evaluate(`document.getElementById('pause').click()`);
      await until(`document.getElementById('status').textContent.startsWith('已暂停')`, 'pause');
      results.pausePreservesProgress = await evaluate(`document.getElementById('progress').value>0`);
      slow = false;
    }
    await evaluate(`document.getElementById('download').click()`);
    await until(`document.getElementById('status').textContent.includes('下载并校验完成') || document.getElementById('status').textContent.startsWith('未完成')`, 'complete download', 240000);
    assert.match(await evaluate(`document.getElementById('status').textContent`), /下载并校验完成/);
    results.completeDownload = true;
    results.inventory = (await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.stats({scan:true}))()`)).maps;
    assert.ok(results.inventory[0].count > 100);
    // Revalidate every saved byte with no resource network, including after a
    // different process restored the IDB directory handle.
    offline = true;
    const offlineStart = requests;
    if (!restore) {
      await win.reload();
      await until(`document.getElementById('directory')?.textContent.includes('资源目录：')`, 'reload directory');
      await evaluate(`document.getElementById('download').click()`);
      await until(`document.getElementById('status').textContent.includes('下载并校验完成') || document.getElementById('status').textContent.startsWith('未完成')`, 'offline validation');
      assert.match(await evaluate(`document.getElementById('status').textContent`), /下载并校验完成/);
    }
    const sentinel = await evaluate(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('resource-test');return (await (await root.getFileHandle('outside-managed.txt')).getFile()).text();})()`);
    assert.equal(sentinel, 'must remain untouched'); results.unrelatedFilePreserved = true;
    await win.loadURL('tarkov://app/factory.html');
    await until(`Boolean(window.factoryDebug?.state.groups.length) && document.getElementById('loading').style.display==='none' && document.getElementById('streamStatus').hidden`, 'complete offline map', 180000);
    assert.equal(await evaluate(`document.querySelector('.map-tools').getBoundingClientRect().bottom <= innerHeight + 1`), true);
    results.offlineMap = true;
    results.offlineResourceRequests = requests - offlineStart;
    if (offlineUrls.length) console.log(JSON.stringify({offlineUrls}));
    assert.equal(results.offlineResourceRequests, 0);
    if (restore) assert.equal(blocked, 0);

    Object.assign(results, await runScreenshotIntegration(win, {screenshots, restore}));
    console.log(JSON.stringify({desktopIntegration: 'passed', ...results}));
    return results;
  } finally { globalThis.fetch = originalFetch; await win.loadURL('tarkov://app/index.html'); }
}
