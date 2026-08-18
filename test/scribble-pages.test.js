const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pageId, pageNumber, normalisePageIds, requiredPageCount
} = require('../scribble-pages.js');

test('dynamic pages retain stable, explicitly numbered slide IDs', () => {
  assert.equal(pageId(1), 'scribble-slide-001');
  assert.equal(pageId(61), 'scribble-slide-061');
  assert.equal(pageId(1234), 'scribble-slide-1234');
  assert.equal(pageNumber('scribble-slide-009'), 9);
  assert.equal(pageNumber('unrelated-slide'), 0);
});

test('persisted page IDs retain order and gaps after a deletion', () => {
  assert.deepEqual(
    normalisePageIds(['scribble-slide-001', 'scribble-slide-003', 'scribble-slide-008']),
    ['scribble-slide-001', 'scribble-slide-003', 'scribble-slide-008']
  );
  assert.deepEqual(
    normalisePageIds(['scribble-slide-003', 'scribble-slide-003', 'invalid']),
    ['scribble-slide-003']
  );
});

test('annotation keys restore enough dynamic pages for their highest slide', () => {
  assert.equal(requiredPageCount([]), 1);
  assert.equal(requiredPageCount([
    'scribble-slide-002',
    'scribble-slide-017',
    'generated:4'
  ]), 17);
});
