import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseScreenshotFilename} from '../site/atlas-screenshot-location.js';

// Called only by the isolated desktop smoke profile, with synthetic screenshots.
export async function runScreenshotIntegration(win, {screenshots, restore=false}) {
  assert.ok(screenshots && path.isAbsolute(screenshots));
  const evaluate=expression=>win.webContents.executeJavaScript(expression,true);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(expression) { for(let i=0;i<150;i++){if(await evaluate(expression))return;await sleep(100);}throw Error('Screenshot integration timed out: '+expression); }
  await until(`!document.getElementById('locateScreenshot').disabled`);
  await until(`document.querySelector('#screenshotDialog [data-directory]').textContent===${JSON.stringify(screenshots)}`);
  const info=await evaluate(`tarkovDesktop.screenshots('info')`);assert.equal(info.ok,true);assert.equal(info.value.path,screenshots);
  const denied=await evaluate(`tarkovDesktop.screenshots('list','C:/')`);assert.equal(denied.ok,false);
  const position=await evaluate(`(()=>{const b=factoryDebug.manifest.bounds;return b.min.map((v,i)=>(v+b.max[i])/2);})()`);
  const newest=Math.max(0,...(await fs.readdir(screenshots)).map(name=>parseScreenshotFilename(name)?.capturedAt||0));
  const base=Math.max(Date.now(),newest+60000);
  const filename=(minute,x)=>{const date=new Date(base+minute*60000).toISOString();return `${date.slice(0,10)}[${date.slice(11,19).replaceAll(':','-')}]_(${x},${position[1]},${position[2]})_(0,0,0,1).png`;};
  const name=filename(0,position[0]);await fs.writeFile(path.join(screenshots,name),'synthetic; image contents are irrelevant');
  await evaluate(`document.getElementById('screenshotSettings').click();document.querySelector('#screenshotDialog [data-read]').click()`);
  await until(`document.querySelector('#screenshotDialog [data-last]').textContent.includes(${JSON.stringify(name)})`);
  const located=await evaluate(`({target:factoryDebug.controls.target.toArray(),status:document.querySelector('#screenshotDialog [data-status]').textContent})`);
  assert.match(located.status,/已定位/);assert.ok(Math.abs(located.target[0]-position[0])<.001);assert.ok(Math.abs(located.target[2]+position[2])<.001);
  await evaluate(`const auto=document.querySelector('#screenshotDialog [data-auto]');if(!auto.checked)auto.click();document.querySelector('#screenshotDialog [data-close]').click()`);
  await sleep(1800);
  const next=filename(1,position[0]+1);await fs.writeFile(path.join(screenshots,next),'synthetic new screenshot');
  await until(`document.querySelector('#screenshotDialog [data-last]').textContent.includes(${JSON.stringify(next)})`);
  await evaluate(`window.atlasLiveMapSession.navigate('tarkov://app/tasks.html')`);
  const resumed=filename(2,position[0]+2);await fs.writeFile(path.join(screenshots,resumed),'synthetic during retained navigation');
  await sleep(1800);assert.equal(await evaluate(`document.querySelector('#screenshotDialog [data-last]').textContent.includes(${JSON.stringify(resumed)})`),false);
  await evaluate(`window.atlasLiveMapSession.navigate('tarkov://app/factory.html')`);
  await until(`document.querySelector('#screenshotDialog [data-last]').textContent.includes(${JSON.stringify(resumed)})`);
  assert.equal(await fs.readFile(path.join(screenshots,name),'utf8'),'synthetic; image contents are irrelevant');
  const entries=await evaluate(`tarkovDesktop.screenshots('list',${JSON.stringify(info.value.id)})`);
  assert.equal(entries.ok,true);assert.ok(entries.value.every(row=>Object.keys(row).sort().join(',')==='lastModified,name'));
  await evaluate(`document.getElementById('screenshotSettings').click()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(screenshots,'screenshot-location-proof.png'),(await win.webContents.capturePage()).toPNG());
  return {autoDetectedDirectory:!restore,screenshotDirectoryRestored:restore,manualScreenshot:true,automaticScreenshot:true,retainedNavigationResumesWatcher:true,metadataOnly:true,screenshotUnchanged:true};
}
