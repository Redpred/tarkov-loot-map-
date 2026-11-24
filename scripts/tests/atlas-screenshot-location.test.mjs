import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {parseScreenshotFilename,screenshotWithinBounds,screenshotEntries,latestScreenshot,createScreenshotWatcher,createScreenshotDirectoryStore} from '../../site/atlas-screenshot-location.js';
import {unityToView} from '../../site/factory-coordinates.js';

const filename=(xyz='12.50, -3.25, 17.80',time='12-30',duplicate=0)=>`2026-11-02[${time}]_${xyz}_0.00000, 0.00000, 0.00000, 1.00000_12.50 (${duplicate}).png`;
const entry=(name=filename(),lastModified=1)=>({kind:'file',name,async getFile(){return {lastModified,get arrayBuffer(){throw Error('must not read image bytes');},get text(){throw Error('must not read image bytes');}};}});
const directory=files=>({name:'Screenshots',files,permission:'granted',async queryPermission(options){assert.deepEqual(options,{mode:'read'});return this.permission;},async *values(){yield* this.files;}});
function setup(files=[]){
  const root=directory(files),located=[],errors=[],timers=new Map();let counter=0;
  const watcher=createScreenshotWatcher({onLocate:s=>located.push(s),onError:e=>errors.push(e),schedule:cb=>{timers.set(++counter,cb);return counter;},cancel:id=>timers.delete(id)});
  watcher.connect(root);watcher.setSuspended(false);
  return {root,located,errors,timers,watcher,async tick(){const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)await callback();}};
}
test('parses real coordinate format, retaining Unity XYZ and reflecting Z only at rendering',()=>{
  const shot=parseScreenshotFilename('2026-09-04[18-33]_7.86, 38.06, -27.57_-0.03307, -0.13322, 0.00384, -0.99053_21.87 (0).png');
  assert.deepEqual(shot.position,{x:7.86,y:38.06,z:-27.57});
  assert.deepEqual(unityToView(shot.position),{x:7.86,y:38.06,z:27.57});
  assert.equal(shot.capturedAt,Date.UTC(2026,8,4,18,33));
});
test('accepts paths, signed coordinates, seconds and legacy filenames without game time',()=>{
  assert.deepEqual(parseScreenshotFilename(`"C:\\Screenshots\\${filename('-1.2e2, +3, .5','12-30-45')}"`).position,{x:-120,y:3,z:.5});
  assert.ok(parseScreenshotFilename('2024-02-29[23-59]_1,2,3_0,0,0,1 (2).png'));
  assert.ok(parseScreenshotFilename('2024-02-29[23-59]_(1,2,3)_(0,0,0,1).png'));
  assert.ok(parseScreenshotFilename(filename().replace('.png','')));
});
test('rejects ordinary screenshots, invalid dates, non-finite and malformed coordinates',()=>{
  for(const value of [null,'Screenshot (1).png',filename().replace('11-02','02-30'),filename().replace('12-30','24-30'),filename('NaN,1,2'),filename('Infinity,1,2'),filename('1e999,1,2'),filename('1,2'),filename('1,2,3,4'),filename('(1,2,3'),filename().replace('.png','.exe')])assert.equal(parseScreenshotFilename(value),null,String(value));
});
test('bounds check rejects impossible/wrong-map positions without altering raw coordinates',()=>{
  const bounds={min:[-100,-10,-200],max:[100,30,200]},position={x:50,y:-3,z:150};
  assert.equal(screenshotWithinBounds(position,bounds),true);
  assert.equal(screenshotWithinBounds({...position,x:300},bounds),false);
  assert.equal(screenshotWithinBounds({...position,y:NaN},bounds),false);
  assert.equal(screenshotWithinBounds(position,null),false);
  assert.deepEqual(position,{x:50,y:-3,z:150});
});
test('enumerates only valid image filenames, ignores subdirectories and sorts same-minute captures by modification time',async()=>{
  const old=entry(filename('1,2,3','12-29'),9999),a=entry(filename('9,2,3'),10),b=entry(filename('-9,2,3'),20);
  const root=directory([old,a,b,{kind:'directory',name:filename()},entry('screen.png'),entry(filename().replace('.png','.tmp'))]);
  const entries=await screenshotEntries(root);assert.equal(entries.length,3);
  assert.equal((await latestScreenshot(entries)).name,b.name);
});
test('a deleted newest file falls back to the next available valid capture',async()=>{
  const old=entry(filename()),deleted=entry(filename('2,3,4','12-31'));
  deleted.getFile=async()=>{throw new DOMException('deleted','NotFoundError');};
  assert.equal((await latestScreenshot(await screenshotEntries(directory([deleted,old])))).name,old.name);
});
test('manual reading can locate the same newest screenshot repeatedly without automatic mode',async()=>{
  const s=setup([entry()]);await s.watcher.read();await s.watcher.read();
  assert.equal(s.located.length,2);assert.equal(s.timers.size,0);assert.equal(s.errors.length,0);
});
test('empty directory reports useful manual error',async()=>{
  const s=setup();await s.watcher.read();assert.match(s.errors[0].message,/没有可识别/);assert.equal(s.located.length,0);
});
test('automatic mode establishes a baseline, detects new screenshots once and coalesces bursts to newest',async()=>{
  const s=setup([entry()]);await s.watcher.setAutomatic(true);assert.equal(s.located.length,0);
  s.root.files.push(entry(filename('20,3,40'),5),entry(filename('30,4,50'),6));await s.tick();
  assert.equal(s.located.length,1);assert.equal(s.located[0].position.x,30);
  await s.tick();assert.equal(s.located.length,1);s.watcher.setAutomatic(false);assert.equal(s.timers.size,0);
});
test('suspend and resume catches screenshots taken while another project page was active',async()=>{
  const s=setup([entry()]);await s.watcher.setAutomatic(true);s.watcher.setSuspended(true);
  s.root.files.push(entry(filename('20,3,40','12-31'),5));await s.watcher.poll();assert.equal(s.located.length,0);
  await s.watcher.setSuspended(false);assert.equal(s.located.length,1);
});
test('turning automatic mode off invalidates a delayed in-flight result',async()=>{
  const s=setup([entry()]);await s.watcher.setAutomatic(true);
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  s.root.files.push(entry(filename('20,3,40','12-31'),5));
  s.root.values=async function*(){entered();await gate;yield* this.files;};
  const pending=s.watcher.poll();await started;s.watcher.setAutomatic(false);release();await pending;
  assert.equal(s.located.length,0);assert.equal(s.timers.size,0);
});
test('changing directories invalidates the old scan and does not locate historical images in the new directory',async()=>{
  const s=setup([entry()]);await s.watcher.setAutomatic(true);
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  s.root.values=async function*(){entered();await gate;yield entry(filename('20,3,40','12-31'));};
  const pending=s.watcher.poll();await started;
  const replacement=directory([entry(filename('200,3,40','12-32'))]);s.watcher.connect(replacement);release();await pending;await s.tick();
  assert.equal(s.located.length,0);await s.watcher.read();assert.equal(s.located[0].position.x,200);
});
test('revoked permission stops the timer without prompting and can recover with a manual read',async()=>{
  const s=setup([entry()]);await s.watcher.setAutomatic(true);s.root.permission='denied';await s.tick();
  assert.equal(s.watcher.automatic,false);assert.equal(s.timers.size,0);assert.equal(s.errors[0].name,'NotAllowedError');
  s.root.permission='granted';await s.watcher.read();assert.equal(s.located.length,1);
});
test('a rejected location is not retried every poll, and disposal leaves no timer',async()=>{
  const errors=[],root=directory([entry()]),timers=new Map();let count=0;
  const watcher=createScreenshotWatcher({onLocate(){count++;throw Error('wrong map');},onError:e=>errors.push(e),schedule:cb=>{timers.set(1,cb);return 1;},cancel:id=>timers.delete(id)});
  watcher.connect(root);watcher.setSuspended(false);await watcher.setAutomatic(true);
  root.files.push(entry(filename('900,0,0','12-31')));await watcher.poll();await watcher.poll();
  assert.equal(count,1);assert.equal(errors.length,1);watcher.dispose();assert.equal(timers.size,0);
});
test('directory settings persist separately and can be forgotten without touching any files',async()=>{
  const store=createScreenshotDirectoryStore(indexedDB);await store.write({kind:'directory',name:'Screenshots'});
  assert.deepEqual(await createScreenshotDirectoryStore(indexedDB).read(),{kind:'directory',name:'Screenshots'});
  await store.write(null);assert.equal(await store.read(),null);
});
