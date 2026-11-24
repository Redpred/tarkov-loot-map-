import test from 'node:test';
import assert from 'node:assert/strict';
import {createItemIndex} from '../../site/atlas-item-index.js';

const position = {x: 1, y: 2, z: 3};
const loose = (id, candidates, extra = {}) => ({id, kind: 'loose', position, candidates, ...extra});
const container = (id, extra = {}) => ({id, kind: 'container', position, pool: 'pool', containerTpl: 'box', ...extra});

test('targets match exact templates with OR semantics and count each point once', () => {
  const points = [
    loose('both', [{tpl: 'a', weight: 2}, {tpl: 'a', weight: 3}, {tpl: 'b', weight: null}]),
    loose('a', [{tpl: 'a', weight: 1}]),
    loose('b', [{tpl: 'b'}]),
  ];
  const index = createItemIndex({points, items: {a: {zh: '同名物品'}, b: {zh: '同名物品'}}});
  assert.equal(index.items.length, 2);
  assert.equal(index.byId.get('a').count, 2);
  assert.equal(index.byId.get('b').count, 2);
  assert.deepEqual(points.filter(p => index.matches(p, new Set(['a']))).map(p => p.id), ['both', 'a']);
  assert.deepEqual(points.filter(p => index.matches(p, ['a', 'b'])).map(p => p.id), ['both', 'a', 'b']);
  assert.equal(index.matches(points[0], ['同名物品']), false);
  assert.equal(index.matches(points[0], []), false);
  assert.equal(index.matches(points[0], ['not-on-this-map']), false);
});

test('container pools, forced items and attached contents are obtainable; container bodies are not', () => {
  const points = [container('ordinary'), container('forced', {
    forcedItems: [{tpl: 'forced', included: [{tpl: 'forced-child', count: 30}]}],
  })];
  const index = createItemIndex({points, pools: {pool: {items: [
    {tpl: 'ammo-box', weight: 5, included: [{tpl: 'ammo', count: 20}, {tpl: 'ammo', count: 10}]},
  ]}}, items: {box: {zh: '容器本体'}, absent: {zh: '只在其他地图'}}});
  assert.equal(index.byId.get('ammo').count, 2);
  assert.equal(index.byId.get('forced').count, 1);
  assert.equal(index.byId.get('forced-child').count, 1);
  assert.equal(index.matches(points[0], ['ammo']), true);
  assert.equal(index.matches(points[0], ['forced']), false);
  assert.equal(index.matches(points[1], ['forced-child']), true);
  assert.equal(index.byId.has('box'), false);
  assert.equal(index.byId.has('absent'), false);
});

test('zero and negative weight candidates do not add either parent or attached items', () => {
  const disabled = [
    {tpl: 'disabled', weight: 0, included: [{tpl: 'disabled-child'}]},
    {tpl: 'negative', weight: -1},
  ];
  const points = [loose('loose', disabled), container('container', {forcedItems: disabled})];
  const index = createItemIndex({points, pools: {pool: {items: disabled}}});
  assert.deepEqual(index.items, []);
  for (const point of points) assert.equal(index.matches(point, ['disabled', 'disabled-child', 'negative']), false);
});

test('quest item pickup is indexed but door keys, fixed weapons and quest delivery requirements are not', () => {
  const points = [
    {id: 'pickup', kind: 'poi', position, quest: true, poiTypes: ['quest_item'], itemId: 'quest-item', questObjectives: [{items: ['unrelated']}]},
    {id: 'door', kind: 'poi', position, poiTypes: ['locked_door'], keyId: 'key'},
    {id: 'weapon', kind: 'poi', position, poiTypes: ['stationary_weapon'], weaponId: 'gun'},
    {id: 'place', kind: 'poi', position, quest: true, poiTypes: ['quest_place'], questObjectives: [{items: ['quest-item', 'required']}]},
  ];
  const index = createItemIndex({points});
  assert.deepEqual(index.items.map(item => item.tpl), ['quest-item']);
  assert.equal(index.matches(points[0], ['quest-item']), true);
  assert.equal(index.matches(points[3], ['quest-item']), false);
  assert.equal(index.matches(points[1], ['key']), false);
});

test('unpositioned, invalid and outside-envelope records cannot create suggestions or targets', () => {
  const points = [
    loose('valid', [{tpl: 'valid', weight: 1}]),
    loose('outside', [{tpl: 'outside', weight: 1}], {outsideClientEnvelope: true}),
    loose('unpositioned', [{tpl: 'unpositioned', weight: 1}], {position: null}),
    loose('invalid', [{tpl: 'invalid', weight: 1}], {position: {x: 1, y: NaN, z: 3}}),
  ];
  const index = createItemIndex({points});
  assert.deepEqual(index.items.map(item => item.tpl), ['valid']);
  assert.equal(index.matches(points[1], ['outside']), false);
  assert.deepEqual(createItemIndex().items, []);
  assert.deepEqual(createItemIndex(null).items, []);
  assert.equal(index.matches(null, null), false);
  assert.deepEqual(createItemIndex({points: [null, {}, loose('empty', null), container('unknown', {pool: 'unknown'})]}).items, []);
});

test('Chinese, English and template searches support all tokens, trim and exact/prefix priority', () => {
  const items = {
    'id-gpu': {zh: '显卡', en: 'Graphics card'},
    'id-gpu-box': {zh: '显卡包装盒', en: 'Graphics card packaging'},
    'id-broken': {zh: '损坏的显卡', en: 'Broken graphics card'},
    'id-gpu-twin': {zh: '显卡', en: 'Another card'},
    'id-gas': {en: 'Gas analyzer'},
  };
  const points = Object.keys(items).map(tpl => loose(tpl, [{tpl, weight: 1}]));
  const index = createItemIndex({points, items});
  assert.deepEqual(index.search('  显卡 ').items.map(item => item.tpl), ['id-gpu', 'id-gpu-twin', 'id-gpu-box', 'id-broken']);
  assert.equal(index.search('  GRAPHICS card ').items[0].tpl, 'id-gpu');
  assert.equal(index.search('card   broken').items[0].tpl, 'id-broken');
  assert.equal(index.search('ID-GAS').items[0].tpl, 'id-gas');
  assert.equal(index.search('ID-GAS').items[0].name, 'Gas analyzer');
  assert.equal(index.search('显卡', {limit: 2}).items.length, 2);
  assert.equal(index.search('显卡', {limit: 2}).total, 4);
  assert.deepEqual(index.search('显卡', {limit: 0}), {items: [], total: 4});
  assert.deepEqual(index.search('不存在'), {items: [], total: 0});
  assert.deepEqual(index.search('  '), {items: [], total: 0});
  assert.deepEqual(index.search(null), {items: [], total: 0});
});

test('shared container pool is read once, counts distinct points and is not rescanned while filtering', () => {
  let reads = 0;
  const pool = {get items() { reads++; return [{tpl: 'pooled', weight: 1}]; }};
  const points = Array.from({length: 1500}, (_, i) => container(`c${i}`));
  const index = createItemIndex({points, pools: {pool}});
  assert.equal(reads, 1);
  assert.equal(index.byId.get('pooled').count, 1500);
  for (const point of points) assert.equal(index.matches(point, ['pooled']), true);
  assert.equal(reads, 1);
});

test('target OR filter composes with category, text and height through external AND constraints', () => {
  const points = [
    loose('match-a', [{tpl: 'a', weight: 1}], {category: 'medical'}),
    loose('match-b', [{tpl: 'b', weight: 1}], {category: 'medical'}),
    loose('wrong-category', [{tpl: 'a', weight: 1}], {category: 'food'}),
    loose('wrong-height', [{tpl: 'a', weight: 1}], {category: 'medical', position: {x: 1, y: 10, z: 3}}),
    loose('wrong-target', [{tpl: 'c', weight: 1}], {category: 'medical'}),
  ];
  const index = createItemIndex({points});
  const selectedCategories = new Set(['medical']);
  const result = points.filter(point => index.matches(point, ['a', 'b'])
    && selectedCategories.has(point.category) && point.position.y < 5 && point.id.startsWith('match'));
  assert.deepEqual(result.map(point => point.id), ['match-a', 'match-b']);
});
