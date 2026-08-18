const test = require('node:test');
const assert = require('node:assert/strict');
const { pressureSample } = require('../annotate-model.js');

test('enabled stylus pressure is retained with the configured boost', () => {
  assert.equal(pressureSample(true, true, 0.4, 1.25), 0.5);
  assert.equal(pressureSample(true, true, 0.8, 1.25), 1);
});

test('disabled stylus pressure produces a constant-width sample', () => {
  assert.equal(pressureSample(true, false, 0.1, 1.25), 0.5);
  assert.equal(pressureSample(true, false, 0.9, 1.25), 0.5);
});

test('non-stylus input stays neutral for simulated pressure', () => {
  assert.equal(pressureSample(false, true, 0, 1.25), 0.5);
});
