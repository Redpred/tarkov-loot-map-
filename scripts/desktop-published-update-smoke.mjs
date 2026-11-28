import {app, session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createDesktopUpdates} from '../desktop/updates.mjs';
import {findDesktopRelease} from '../desktop/update-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),evidence=path.join(root,'work/release-acceptance');
const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const installed=path.resolve(option('--installed')||'');assert(installed.startsWith(path.join(root,'work')+path.sep));
const expectedSha256=option('--expected-sha256');assert(/^[a-f0-9]{64}$/.test(expectedSha256||''));
const version=JSON.parse(await fs.readFile(path.join(installed,'resources/app.asar/package.json'))).version;
const currentVersion='0.0.0-alpha.0';
await fs.mkdir(evidence,{recursive:true});
const profile=await fs.mkdtemp(path.join(evidence,'remote-updater-'));
app.setPath('userData',profile);app.getVersion=()=> currentVersion;
// Electron emits ready after its ESM entry finishes evaluating. Waiting at
// top level would prevent that event; keep profile setup above, then yield.
async function run(){
let service;
const deadline=setTimeout(()=>{console.error('Remote updater timeout');app.exit(1);},1800000);
try {
await app.whenReady();
await session.fromPartition('electron-updater').setProxy({mode:'direct'});
const {NsisUpdater}=createRequire(path.join(root,'desktop/package.json'))('electron-updater');
const updater=new NsisUpdater();updater.logger=null;updater.forceDevUpdateConfig=true;
Object.defineProperty(updater.app,'baseCachePath',{value:path.join(profile,'cache')});
const config=path.join(profile,'app-update.yml');
await fs.writeFile(config,'provider: generic\nurl: https://github.com/Redpred/tarkov-loot-map/releases/\nupdaterCacheDirName: verified-update\n');
updater.updateConfigPath=config;
const events=[];let lastProgress=0;
service=createDesktopUpdates({updater,currentVersion:currentVersion,settingsFile:path.join(profile,'updates.json'),canInstall:true,findRelease:findDesktopRelease,
  notify:state=>{if(events.at(-1)!==state.phase){events.push(state.phase);console.log(state.phase);}if(state.phase==='downloading'&&Date.now()-lastProgress>30000){console.log(JSON.stringify({bytes:state.transferred,total:state.total}));lastProgress=Date.now();}}});
// Exercise the production selection, metadata, downloader and pre-install hash.
// A synthetic older version exercises update selection without creating a fake Release.
// The same installer is actually installed and uninstalled by verify-published-desktop.ps1.
let handoff=0;updater.quitAndInstall=(silent,restart)=>{assert.equal(silent,true);assert.equal(restart,true);handoff++;};
  await service.preference(false);
  const offered=await service.check();assert.equal(offered.phase,'available');assert.equal(offered.version,version);
  const downloaded=await service.download();assert.equal(downloaded.phase,'downloaded');
  const installer=updater.downloadedUpdateHelper.file;
  assert(installer.startsWith(profile+path.sep));
  const hash=createHash('sha256');for await(const chunk of createReadStream(installer))hash.update(chunk);
  const sha256=hash.digest('hex');assert.equal(sha256,expectedSha256);
  await service.install();assert.equal(handoff,1);
  const sameVersion=await findDesktopRelease(version);assert.equal(sameVersion.version,version);
  const result={at:new Date().toISOString(),anonymousRealGitHub:true,from:currentVersion,to:version,
    selectedCorrectApplicationAmongResourceReleases:true,downloadedInstallerSha256:sha256,sha512VerifiedByUpdater:true,
    preInstallHashVerified:true,explicitInstallHandoff:handoff,syntheticOldVersion:true,installerExecutedByThisTest:false,hiddenNoWindows:true,events,profile,installer};
  await fs.writeFile(path.join(evidence,'remote-updater.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  service.dispose();clearTimeout(deadline);app.exit(0);
}catch(error){console.error(error);service?.dispose();clearTimeout(deadline);app.exit(1);}
}
void run();
