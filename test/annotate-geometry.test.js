const test = require('node:test');
const assert = require('node:assert/strict');
const { rulePositions } = require('../annotate-geometry.js');

test('ruled lines are evenly spaced and stay inside the requested margins', () => {
  assert.deepEqual(rulePositions(700, 52, 64), [64, 116, 168, 220, 272, 324, 376, 428, 480, 532, 584, 636]);
});
