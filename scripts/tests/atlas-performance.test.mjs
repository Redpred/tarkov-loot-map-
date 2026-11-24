import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetSectors,limitMarkers,renderPixelRatio,performancePresets} from '../../site/atlas-performance.js';
import {validateViewSettings} from '../../site/atlas-view-settings.js';
import {HOME_VIEW_KEY,readHomeViewSettings,readMapViewSettings,saveHomeViewSettings} from '../../site/atlas-view-preferences.js';
const preferences=entries=>{const values=new Map(entries);return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('home settings reach new and previously visited maps while preserving independent controls',()=>{
  const stored=preferences([['factory-view-settings-v1',JSON.stringify({maxFps:120,pivot:'manual',manualPivot:[10,20,30],walkSpeed:7,rotationSpeed:.9})],['streets-view-settings-v1',JSON.stringify({maxFps:15,markerSize:32})]]);
  const home=readHomeViewSettings(stored);home.maxFps=30;
  assert.equal(saveHomeViewSettings(home,'maxFps',stored),true);
  for(const id of ['factory','streets','woods'])assert.equal(readMapViewSettings(id,stored).maxFps,30);
  const factory=readMapViewSettings('factory',stored);
  assert.equal(factory.pivot,'manual');assert.deepEqual(factory.manualPivot,[10,20,30]);assert.equal(factory.flySpeed,7);assert.equal(factory.rotationSpeed,.9);
  assert.equal(readMapViewSettings('streets',stored).markerSize,32);
  assert.equal(readHomeViewSettings(stored).maxFps,30);
  assert.equal(stored.getItem('woods-view-settings-v1'),null,'unvisited maps inherit without creating per-map entries');
  stored.setItem('factory-view-settings-v1',JSON.stringify({...factory,maxFps:45}));
  assert.equal(readMapViewSettings('factory',stored).maxFps,45,'a later map-specific change takes precedence');
  assert.equal(readMapViewSettings('woods',stored).maxFps,30);
});
test('home presets and reset preserve map pivots and reset only shared controls',()=>{
  const stored=preferences([['factory-view-settings-v1',JSON.stringify({pivot:'manual',manualPivot:[1,2,3],rotationSpeed:.8,flySpeed:8})]]);
  assert.equal(saveHomeViewSettings(performancePresets.light,'preset',stored),true);
  assert.equal(readMapViewSettings('factory',stored).renderScale,.65);assert.equal(readMapViewSettings('factory',stored).flySpeed,8);
  assert.equal(saveHomeViewSettings({},'reset',stored),true);
  const reset=readMapViewSettings('factory',stored);
  assert.equal(reset.maxFps,60);assert.equal(reset.flySpeed,3);assert.equal(reset.mode,'view');assert.equal(reset.pivot,'manual');assert.deepEqual(reset.manualPivot,[1,2,3]);assert.equal(reset.rotationSpeed,.8);
  assert.equal(saveHomeViewSettings({pivot:'map'},'pivot',stored),false);
});
test('home settings tolerate corrupt storage and report saving failures',()=>{
  const stored=preferences([[HOME_VIEW_KEY,'null'],['factory-view-settings-v1','broken']]);
  assert.equal(readMapViewSettings('factory',stored).maxFps,60);
  assert.equal(saveHomeViewSettings({maxFps:999},'maxFps',stored),true);assert.equal(readMapViewSettings('factory',stored).maxFps,120);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readHomeViewSettings(blocked).mode,'view');assert.equal(saveHomeViewSettings({},'reset',blocked),false);
});
test('performance controls preserve valid settings and reject unbounded or invalid values',()=>{
  const s=validateViewSettings({renderScale:10,maxFps:0,markerHz:NaN,maxMarkers:Infinity,anisotropy:99,showDecals:false,sectorBudget:-1});
  assert.equal(s.renderScale,1.25);assert.equal(s.maxFps,15);assert.equal(s.markerHz,20);assert.equal(s.maxMarkers,1500);assert.equal(s.anisotropy,8);assert.equal(s.showDecals,false);assert.equal(s.sectorBudget,0);
  assert.equal(renderPixelRatio(2,.5),1);assert.equal(renderPixelRatio(4,1),2);
  for(const preset of Object.values(performancePresets))for(const [key,value] of Object.entries(preset))assert.equal(validateViewSettings(preset)[key],value);
});
test('sector budget limits optional geometry but keeps ground coverage and permits unlimited mode',()=>{
  const sectors=[100,100,100,300].map((mib,i)=>({id:String(i),stats:{bytes:mib*2**20}}));
  assert.deepEqual(budgetSectors(sectors,220).map(s=>s.id),['0','1']);
  assert.deepEqual(budgetSectors(sectors,100,s=>['1','3'].includes(s.id)).map(s=>s.id),['1','3']);
  assert.equal(budgetSectors(sectors,0),sectors);
  assert.deepEqual(budgetSectors(sectors,10).map(s=>s.id),['0']);
});
test('marker budget keeps the selected point and nearest visible markers without deleting source results',()=>{
  const clusters=[{point:{id:'far'},x:0,y:0},{point:{id:'near'},x:49,y:50},{point:{id:'chosen'},x:100,y:100}];
  assert.deepEqual(limitMarkers(clusters,2,100,100,'chosen').map(c=>c.point.id),['chosen','near']);assert.equal(clusters.length,3);
});
