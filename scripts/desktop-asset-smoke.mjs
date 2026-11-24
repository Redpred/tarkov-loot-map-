// Hidden, isolated image decoding check against the real packaged application.
import {app,BrowserWindow,session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const output=option('--package-output'),evidence=path.resolve(root,option('--evidence')||'work/desktop-asset-smoke');
assert(output&&evidence.startsWith(path.join(root,'work')+path.sep));await fs.mkdir(evidence,{recursive:true});
process.env.TARKOV_DESKTOP_TEST_PROFILE=path.join(evidence,'profile');process.env.TARKOV_DESKTOP_TEST_WINDOW='hidden';
const archive=path.resolve(root,output,'win-unpacked/resources/app.asar');
const inventory=JSON.parse(await fs.readFile(path.join(archive,'build-inventory.json'),'utf8'));
const files=inventory.files.map(e=>e.path).filter(p=>p.startsWith('site/')&&/\.(?:png|webp|jpe?g|svg)$/i.test(p));
const requests=[],crashes=[];let shown=0;
globalThis.fetch=async url=>{requests.push(String(url));throw Error('Offline image check');};
app.on('browser-window-created',(_,win)=>{for(const event of ['show','focus'])win.on(event,()=>shown++);});
app.on('web-contents-created',(_,contents)=>contents.on('render-process-gone',(_,detail)=>crashes.push(detail.reason)));
await import(pathToFileURL(path.join(archive,'desktop/main.mjs')).href);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=setTimeout(()=>{console.error('Image smoke timed out');app.exit(1);},300000);
async function run(){try{
  await app.whenReady();session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>{requests.push(details.url);done({cancel:true});});
  let win;for(let n=0;n<100&&!win;n++){win=BrowserWindow.getAllWindows()[0];if(!win)await sleep(100);}assert(win);
  await win.loadURL('tarkov://app/tasks.html');
  const evaluate=code=>win.webContents.executeJavaScript(code,true);
  for(let n=0;n<200;n++){if(await evaluate(`document.querySelectorAll('.task-card').length>0`))break;await sleep(100);}
  const taskImages=await evaluate(`(async()=>{const portraits=[...document.querySelectorAll('.trader-portrait img')],cards=[...document.querySelectorAll('img.task-card-image')];for(const image of [...portraits,...cards]){image.loading='eager';await image.decode();}return {portraits:portraits.length,cards:cards.length,decoded:[...portraits,...cards].every(image=>image.naturalWidth>0&&!image.hidden)};})()`);
  if(process.argv.includes('--expect-old-bug')){assert.equal(taskImages.portraits,0);assert.equal(taskImages.cards,0);await fs.writeFile(path.join(evidence,'old-bug.json'),JSON.stringify({version:inventory.version,taskImages,confirmed:true},null,2)+'\n');clearTimeout(timeout);app.exit(0);return;}
  assert(taskImages.portraits>0&&taskImages.cards>0&&taskImages.decoded,'Tasks must create and decode actual image elements');
  const detailImages=await evaluate(`(async()=>{let result;for(const button of [...document.querySelectorAll('.task-card-open')].slice(0,20)){button.click();const host=document.getElementById('detailContent'),images=[...host.querySelectorAll('img')];for(const image of images){image.loading='eager';await image.decode();}result={hero:host.querySelectorAll('img.detail-hero').length,trader:host.querySelectorAll('.detail-trader img').length,items:host.querySelectorAll('.objective-item img').length,decoded:images.every(image=>image.naturalWidth>0&&!image.hidden)};if(result.items)break;}document.getElementById('closeDetail').click();return result;})()`);
  assert(detailImages.hero>0&&detailImages.trader>0&&detailImages.items>0&&detailImages.decoded,'Task details must display their hero, trader and item images');
  const decoded=await evaluate(`(async()=>{const files=${JSON.stringify(files.map(p=>p.slice(5)))},failed=[];let next=0,loaded=0;await Promise.all(Array.from({length:8},async()=>{while(next<files.length){const file=files[next++],image=new Image();image.src=file;try{await image.decode();if(!image.naturalWidth)throw Error('empty');loaded++;}catch{failed.push(file);}finally{image.src='';}}}));return {loaded,failed};})()`);
  assert.deepEqual(decoded.failed,[],'Every packaged UI image must decode');assert.equal(decoded.loaded,files.length);
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await sleep(500);
  const screenshot=await win.webContents.capturePage(undefined,{stayHidden:true});await fs.writeFile(path.join(evidence,'tasks.png'),screenshot.toPNG());
  assert.equal(shown,0);assert.deepEqual(crashes,[]);assert.deepEqual(requests,[]);assert.equal(win.isVisible(),false);
  const result={version:inventory.version,taskImages,detailImages,decodedImages:decoded.loaded,imageFailures:decoded.failed,networkRequests:requests.length,windowsShown:shown,rendererCrashes:crashes.length};
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));clearTimeout(timeout);app.exit(0);
}catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}}
void run();
