import test from 'node:test';
import assert from 'node:assert/strict';
import {taskAssetUrl} from '../../site/task-asset-url.js';

test('task images resolve on the desktop custom scheme and both website schemes', () => {
  for (const origin of ['tarkov://app', 'https://example.test', 'http://localhost:4175']) {
    assert.equal(taskAssetUrl('data/tasks/assets/traders/portrait.webp', origin + '/tasks.html'), origin + '/data/tasks/assets/traders/portrait.webp');
    assert.equal(taskAssetUrl('/data/icons/items/item.webp', origin + '/tasks.html'), origin + '/data/icons/items/item.webp');
  }
});

test('task images cannot cross hosts, schemes, ports or include credentials', () => {
  for (const base of ['tarkov://app/tasks.html', 'https://example.test/tasks.html']) {
    for (const value of ['//other.test/icon.png', 'tarkov://other/icon.png', 'tarkov://app:80/icon.png', 'https://other.test/icon.png', 'file:///icon.png', 'data:image/png;base64,AA', 'javascript:alert(1)']) assert.equal(taskAssetUrl(value, base), null, value);
    assert.equal(taskAssetUrl(base.replace('://', '://user:secret@'), base), null);
  }
  assert.equal(taskAssetUrl('icon.png', 'tarkov://other/tasks.html'), null);
  assert.equal(taskAssetUrl('icon.png', 'file:///tasks.html'), null);
  assert.equal(taskAssetUrl('', 'tarkov://app/tasks.html'), null);
  assert.equal(taskAssetUrl(null, 'tarkov://app/tasks.html'), null);
});
