import {app,BrowserWindow,session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const target=path.resolve(option('--installed')||'');
const evidence=path.resolve(option('--evidence')||'');
assert(target.startsWith(path.join(root,'work')+path.sep));
assert(evidence.startsWith(path.join(root,'work')+path.sep));
await fs.mkdir(evidence,{recursive:true});
const archive=path.join(target,'resources/app.asar');
const softwareRendering=process.env.GITHUB_ACTIONS==='true';
if(softwareRendering)app.commandLine.appendSwitch('use-angle','swiftshader');
process.env.TARKOV_DESKTOP_TEST_PROFILE=target;
process.env.TARKOV_DESKTOP_TEST_WINDOW='hidden';
app.setPath('documents',path.join(evidence,'empty-documents'));
await fs.mkdir(path.join(evidence,'empty-documents'),{recursive:true});
const network=[],errors=[];let shown=0;
globalThis.fetch=async input=>{const url=String(input);network.push(url);throw Error('Offline bundle verification: network disabled');};
app.on('browser-window-created',(_event,win)=>{for(const event of ['show','focus'])win.on(event,()=>shown++);});
app.on('web-contents-created',(_event,contents)=>{contents.on('render-process-gone',(_event,details)=>errors.push(details.reason));});
await import(pathToFileURL(path.join(archive,'desktop/main.mjs')).href);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=setTimeout(()=>{console.error('Offline bundle smoke timed out');app.exit(1);},2300000);
async function run(){try{
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>{network.push(details.url);done({cancel:true});});
  let win;for(let n=0;n<100&&!win;n++){win=BrowserWindow.getAllWindows()[0];if(!win)await pause(100);}
  assert(win);
  // Hosted Windows has no physical GPU. Keep the real renderer and loading
  // checks, but bound the hidden viewport's software rasterization cost.
  if(softwareRendering)win.setContentSize(860,600);
  const evaluate=code=>win.webContents.executeJavaScript(code,true);
  async function until(code,label,limit=120000){const end=Date.now()+limit;let nextLog=Date.now()+15000;while(Date.now()<end){if(await evaluate(code))return;if(Date.now()>nextLog){console.log(JSON.stringify({waiting:label,status:await evaluate(`document.getElementById('streamStatus')?.textContent||document.getElementById('loadMessage')?.textContent`)}));nextLog=Date.now()+15000;}await pause(150);}throw Error(label+' timed out: '+JSON.stringify(await evaluate(`({message:document.getElementById('loadMessage')?.textContent,error:document.getElementById('retryMapLoading')?.parentElement.innerText,status:document.getElementById('streamStatus')?.textContent})`)));}
  await until(`document.querySelectorAll('.map-card').length===13`,'home');
  while(win.webContents.isLoading())await pause(100);
  await session.defaultSession.clearStorageData();await session.defaultSession.clearCache();
  // Streamed maps intentionally pause when document.hidden is true. Simulate
  // a visible document for this QA process while the native window stays hidden.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  if(softwareRendering)await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:0.5,mobile:false});
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(Document.prototype,'hidden',{configurable:true,get:()=>false});Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:()=> 'visible'});`});
  await win.loadURL('tarkov://app/index.html');
  await until(`document.querySelectorAll('.map-card').length===13`,'clean home');
  assert.equal(await evaluate(`(async()=>(await import('./atlas-managed-resources.js')).managedResources.mode())()`),'client');
  const info=await evaluate(`fetch('/api/client-resources').then(r=>r.json())`);assert.equal(info.available,true);assert.equal(path.resolve(info.path),path.join(target,'map-resources'));
  const {ATLAS_MAPS,atlasMapHref}=await import(pathToFileURL(path.join(archive,'site/atlas-maps.js')).href);
  const requestedMaps=option('--maps')?.split(',')||Object.keys(ATLAS_MAPS);
  assert(requestedMaps.length>0&&requestedMaps.every(id=>Object.hasOwn(ATLAS_MAPS,id))&&new Set(requestedMaps).size===requestedMaps.length,'Invalid smoke map selection');
  assert.deepEqual(await evaluate(`(async()=>({geometry:(await import('./atlas-geometry-quality.js')).readGeometryQuality(localStorage),texture:(await import('./atlas-texture-quality.js')).readTextureQuality(localStorage),scenery:(await import('./atlas-scenery-details.js')).readSceneryMode(localStorage)}))()`),{geometry:'low',texture:'medium',scenery:'full'});
  const sponsor=await evaluate(`(async()=>{document.getElementById('openSponsor').click();const d=document.getElementById('sponsorDialog');const sections=[...d.querySelectorAll('.sponsor-channel')];const images=[];for(const image of d.querySelectorAll('img')){await image.decode();images.push({src:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight});}return {open:d.open,channels:sections.map(e=>e.querySelector('h3').textContent),displayed:sections.every(e=>e.getClientRects().length>0),tabs:d.querySelectorAll('[role=tab]').length,images};})()`);
  assert.deepEqual(sponsor.channels,['微信','支付宝','爱发电']);assert(sponsor.open&&sponsor.displayed);assert.equal(sponsor.tabs,0);assert.equal(sponsor.images.length,3);
  for(const channel of ['wechat','alipay','afdian']){
    assert.equal(await evaluate(`(async()=>{document.querySelector('.sponsor-channel-${channel} [data-preview]').click();const d=document.getElementById('sponsorPreview');await d.querySelector('img').decode();const ok=d.open&&d.querySelector('img').naturalWidth>0;d.close();return ok;})()`),true);
  }
  await evaluate(`document.getElementById('sponsorDialog').close();document.getElementById('openProjectAbout').click()`);
  assert.equal(await evaluate(`document.getElementById('projectAboutDialog').open&&document.getElementById('projectAboutDialog').innerText.includes('Battlestate Games')`),true);
  await evaluate(`document.getElementById('projectAboutDialog').close()`);
  const rendered=[];
  for(const map of Object.values(ATLAS_MAPS).filter(map=>requestedMaps.includes(map.id)&&(!process.argv.includes('--visual')||map.id==='factory'))){
    await win.loadURL('tarkov://app/'+atlasMapHref(map.id));
    const loaded=map.streamed?`(()=>{const s=document.getElementById('streamStatus'),m=s?.textContent.match(new RegExp('场景 ([0-9]+) / ([0-9]+) 个分区'));return document.getElementById('loading')?.style.display==='none'&&!s?.classList.contains('error')&&m&&Number(m[1])>0&&m[1]===m[2];})()`:`Boolean(window.factoryDebug?.state.groups.length)&&document.getElementById('loading')?.style.display==='none'&&document.getElementById('streamStatus')?.hidden`;
    await until(loaded,map.id,softwareRendering?600000:180000);
    assert.equal(await evaluate(`document.querySelectorAll('.resource-location-dialog[open]').length`),0);
    rendered.push(map.id);console.log(JSON.stringify({rendered:map.id,count:rendered.length}));
    if(process.argv.includes('--visual')){
      const frame=await evaluate(`(()=>{const d=window.factoryDebug;d.renderer.render(d.scene,d.camera);return {png:d.renderer.domElement.toDataURL('image/png'),calls:d.renderer.info.render.calls,triangles:d.renderer.info.render.triangles};})()`);
      assert(frame.calls>0&&frame.triangles>0);
      await fs.writeFile(path.join(evidence,'installed-factory-canvas.png'),Buffer.from(frame.png.split(',')[1],'base64'));
      console.log(JSON.stringify({renderedFrame:map.id,calls:frame.calls,triangles:frame.triangles}));
    }
  }
  await win.loadURL('tarkov://app/tasks.html');await until(`document.querySelectorAll('.task-card').length>0&&document.querySelectorAll('#traderBar img').length>0`,'tasks');
  const taskImages=await evaluate(`(async()=>{const images=[...document.querySelectorAll('#traderBar img,.task-card-image')];for(const i of images){i.loading='eager';await i.decode();}return images.map(i=>({src:new URL(i.src).pathname,width:i.naturalWidth,height:i.naturalHeight}));})()`);assert(taskImages.length>0);assert(taskImages.every(i=>i.width>0&&i.height>0));
  await evaluate(`document.querySelector('.task-card-open').click()`);
  const detailImages=await evaluate(`(async()=>{const images=[...document.querySelectorAll('#detailContent img')];for(const i of images){i.loading='eager';await i.decode();}return images.map(i=>({src:new URL(i.src).pathname,width:i.naturalWidth,height:i.naturalHeight}));})()`);assert(detailImages.length>0);assert(detailImages.every(i=>i.width>0&&i.height>0));
  assert.equal(shown,0);assert.deepEqual(errors,[]);
  const resourceNetwork=network.filter(url=>!url.startsWith('https://json.tarkov.dev/'));
  assert.deepEqual(resourceNetwork,[]);
  assert.equal(win.isVisible(),false);
  if(!process.argv.includes('--visual'))assert.equal(rendered.length,requestedMaps.length);
  const result={packagedAsar:true,defaultClientDirectory:true,freshBrowserStorage:true,simulatedDocumentVisibility:true,softwareRendering,viewport:win.getContentSize(),deviceScaleFactor:softwareRendering?0.5:null,requestedMaps,sponsor,aboutNotice:true,taskImages:taskImages.length,detailImages:detailImages.length,renderedMaps:rendered,resourceNetworkRequests:resourceNetwork.length,blockedMarketRefreshes:network.length,windowsShown:shown,rendererCrashes:errors.length};
  await fs.writeFile(path.join(evidence,process.argv.includes('--visual')?'offline-visual.json':'offline-smoke.json'),JSON.stringify({...result,explicitCanvasRender:process.argv.includes('--visual')},null,2)+'\n');console.log(JSON.stringify(result));clearTimeout(timeout);app.exit(0);
}catch(error){console.error(error);await fs.writeFile(path.join(evidence,'offline-smoke-failure.json'),JSON.stringify({error:String(error.stack||error),softwareRendering,network,windowsShown:shown,rendererErrors:errors},null,2)+'\n').catch(()=>{});clearTimeout(timeout);app.exit(1);}}
void run();
