const test = require('node:test');
const assert = require('node:assert/strict');
const { pressureSample, strokeWidth, ensureStrokeWidths } = require('../annotate-model.js');

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

test('legacy strokes capture their current tool width exactly once', () => {
  const ink = {
    '0.0': [
      { t: 'pen', p: [[1, 2, 0.5]] },
      { t: 'highlighter', w: 64, p: [[3, 4, 0.5]] }
    ]
  };
  ensureStrokeWidths(ink, { pen: 12.4, highlighter: 86 });
  assert.equal(ink['0.0'][0].w, 12.4);
  assert.equal(ink['0.0'][1].w, 64);

  ensureStrokeWidths(ink, { pen: 20, highlighter: 100 });
  assert.equal(ink['0.0'][0].w, 12.4);
  assert.equal(strokeWidth(ink['0.0'][1], { highlighter: 100 }), 64);
});
