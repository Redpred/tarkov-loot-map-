import test from 'node:test';
import assert from 'node:assert/strict';

test('one shared mode persists across pages and reacts to other tabs without accepting invalid modes',async()=>{
  const savedStorage=globalThis.localStorage,savedWindow=globalThis.window;
  const values=new Map([['atlas-map-price-mode-v1',JSON.stringify('pve')]]);
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  globalThis.window=new EventTarget();
  try{
    const {getGameMode,setGameMode,subscribeGameMode,GAME_MODE_KEY}=await import('../../site/game-mode.js?mode-test');
    assert.equal(getGameMode(),'pve');const seen=[];const unsubscribe=subscribeGameMode(mode=>seen.push(mode));
    setGameMode('pvp-season');assert.equal(JSON.parse(values.get(GAME_MODE_KEY)),'pvp-season');
    setGameMode('wrong');assert.equal(getGameMode(),'pvp-season');assert.deepEqual(seen,['pvp-season']);
    values.set(GAME_MODE_KEY,JSON.stringify('regular'));const event=new Event('storage');event.key=GAME_MODE_KEY;globalThis.window.dispatchEvent(event);
    assert.equal(getGameMode(),'regular');assert.deepEqual(seen,['pvp-season','regular']);
    unsubscribe();setGameMode('pve');assert.equal(seen.length,2);
  }finally{
    if(savedStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=savedStorage;
    if(savedWindow===undefined)delete globalThis.window;else globalThis.window=savedWindow;
  }
});
