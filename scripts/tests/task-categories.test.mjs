import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesTaskCategory,SEASON_CATEGORY_ID} from '../../site/task-presentation.js';

test('season tasks have an exclusive overview category but keep their actual trader in my tasks',()=>{
  const season={id:'a',traderId:'prapor',seasonId:'season-1'},regular={id:'b',traderId:'prapor'},holiday={id:'c',traderId:'prapor',event:true};
  assert.equal(matchesTaskCategory(season,SEASON_CATEGORY_ID,{overview:true}),true);
  assert.equal(matchesTaskCategory(season,'prapor',{overview:true}),false);
  assert.equal(matchesTaskCategory(season,'prapor'),true);
  assert.equal(matchesTaskCategory(season,''),true);
  assert.equal(matchesTaskCategory(season,'therapist'),false);
  assert.equal(matchesTaskCategory(regular,'prapor',{overview:true}),true);
  assert.equal(matchesTaskCategory(holiday,SEASON_CATEGORY_ID),false);
  assert.equal(season.traderId,'prapor');
});
