const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rulePositions, pointInPolygon, polygonContainsPoints,
  pointsBounds, insideBounds, translatePoints, scalePoints, resizeHandle, uniformScale
} = require('../annotate-geometry.js');

test('ruled lines are evenly spaced and stay inside the requested margins', () => {
  assert.deepEqual(rulePositions(700, 52, 64), [64, 116, 168, 220, 272, 324, 376, 428, 480, 532, 584, 636]);
  assert.ok(rulePositions(700, 44, 64).length > rulePositions(700, 60, 64).length);
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

test('selection resizing scales coordinates around a fixed corner and retains pressure', () => {
  assert.deepEqual(scalePoints([[10, 20, 0.4], [30, 40, 0.8]], [10, 20], 2), [
    [10, 20, 0.4], [50, 60, 0.8]
  ]);
  assert.equal(uniformScale([0, 0], [10, 10], [20, 20], 0.1), 2);
  assert.equal(uniformScale([0, 0], [10, 10], [-5, -5], 0.1), 0.1);
});

test('resize handles identify the nearest selection corner', () => {
  var box = [10, 20, 100, 80];
  assert.deepEqual(resizeHandle([13, 23], box, 8), { name: 'nw', point: [10, 20] });
  assert.deepEqual(resizeHandle([96, 77], box, 8), { name: 'se', point: [100, 80] });
  assert.equal(resizeHandle([55, 50], box, 8), null);
});
