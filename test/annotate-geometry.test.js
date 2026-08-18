const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rulePositions, pointInPolygon, polygonContainsPoints,
  pointsBounds, insideBounds, translatePoints
} = require('../annotate-geometry.js');

test('ruled lines are evenly spaced and stay inside the requested margins', () => {
  assert.deepEqual(rulePositions(700, 52, 64), [64, 116, 168, 220, 272, 324, 376, 428, 480, 532, 584, 636]);
});

const loop = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('lasso containment requires every point of a stroke to be enclosed', () => {
  assert.equal(pointInPolygon([5, 5], loop), true);
  assert.equal(pointInPolygon([15, 5], loop), false);
  assert.equal(polygonContainsPoints(loop, [[2, 2], [8, 8]]), true);
  assert.equal(polygonContainsPoints(loop, [[2, 2], [12, 8]]), false);
});

test('selection bounds support padded hit testing', () => {
  const box = pointsBounds([[2, 8], [7, 3], [4, 12]]);
  assert.deepEqual(box, [2, 3, 7, 12]);
  assert.equal(insideBounds([8, 4], box, 1), true);
  assert.equal(insideBounds([9, 4], box, 1), false);
});

test('translating points retains their pressure samples', () => {
  assert.deepEqual(translatePoints([[1, 2, 0.4], [3, 5, 0.8]], 10, -2), [
    [11, 0, 0.4], [13, 3, 0.8]
  ]);
});
