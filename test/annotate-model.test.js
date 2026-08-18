const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pressureSample, isIPad, strokeWidth, cycleValue, ownsPointer, ensureStrokeWidths
} = require('../annotate-model.js');

test('recognises classic and desktop-mode iPads without classifying Macs', () => {
  assert.equal(isIPad({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_5)', platform: 'iPad', maxTouchPoints: 5 }), true);
  assert.equal(isIPad({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIPad({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isIPad({ userAgent: 'Mozilla/5.0 (Windows)', platform: 'Win32', maxTouchPoints: 10 }), false);
});

test('enabled stylus pressure is centred around the fixed-width baseline', () => {
  assert.equal(pressureSample(true, true, 0.1, 0.35, 0.75), 0.425);
  assert.equal(pressureSample(true, true, 0.2, 0.35, 0.75), 0.5);
  assert.equal(pressureSample(true, true, 0.8, 0.35, 0.75), 0.9500000000000001);
  assert.equal(pressureSample(true, true, 1, 0.35, 0.75), 1);
});

test('disabled stylus pressure produces a constant-width sample', () => {
  assert.equal(pressureSample(true, false, 0.1, 0.35, 0.75), 0.5);
  assert.equal(pressureSample(true, false, 0.9, 0.35, 0.75), 0.5);
});

test('non-stylus input stays neutral for simulated pressure', () => {
  assert.equal(pressureSample(false, true, 0, 0.35, 0.75), 0.5);
});

test('palette cycling follows direction and wraps at both ends', () => {
  const colours = ['black', 'red', 'blue'];
  assert.equal(cycleValue(colours, 'black', 1), 'red');
  assert.equal(cycleValue(colours, 'blue', 1), 'black');
  assert.equal(cycleValue(colours, 'black', -1), 'blue');
  assert.equal(cycleValue(colours, 'red', 0), 'red');
});

test('only the contact that began a gesture can move or finish it', () => {
  assert.equal(ownsPointer(7, 7), true);
  assert.equal(ownsPointer(7, 8), false);
  assert.equal(ownsPointer(7, undefined), false);
  assert.equal(ownsPointer(null, 7), false);
  assert.equal(ownsPointer('touch:4', 'touch:4'), true);
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
