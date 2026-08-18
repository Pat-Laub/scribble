const test = require('node:test');
const assert = require('node:assert/strict');
const { pageId, pageNumber, requiredPageCount } = require('../scribble-pages.js');

test('dynamic pages retain stable, explicitly numbered slide IDs', () => {
  assert.equal(pageId(1), 'scribble-slide-001');
  assert.equal(pageId(61), 'scribble-slide-061');
  assert.equal(pageId(1234), 'scribble-slide-1234');
  assert.equal(pageNumber('scribble-slide-009'), 9);
  assert.equal(pageNumber('unrelated-slide'), 0);
});

test('annotation keys restore enough dynamic pages for their highest slide', () => {
  assert.equal(requiredPageCount([]), 1);
  assert.equal(requiredPageCount([
    'scribble-slide-002',
    'scribble-slide-017',
    'generated:4'
  ]), 17);
});
