const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pressureSample, isIPad, strokeWidth, cycleValue, ownsPointer, ensureStrokeWidths, cloneStrokes,
  slideKey, migrateInkKeys, reframeInk, repairOverscanCoordinates, nextItem
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

test('clipboard strokes are independent copies with an optional position offset', () => {
  const strokes = [{
    t: 'pen', c: '#252525', w: 12.4, s: false,
    p: [[10, 20, 0.4], [30, 40, 0.7]]
  }];
  const copies = cloneStrokes(strokes, 18, -5);

  assert.deepEqual(copies[0].p, [[28, 15, 0.4], [48, 35, 0.7]]);
  assert.notEqual(copies[0], strokes[0]);
  assert.notEqual(copies[0].p[0], strokes[0].p[0]);

  copies[0].p[0][0] = 999;
  assert.equal(strokes[0].p[0][0], 10);
});

test('stable slide keys distinguish authored, generated, uncounted, and fragment states', () => {
  const slide = (id, annotationId) => ({
    id,
    getAttribute: name => name === 'data-annotation-id' ? annotationId : null
  });
  assert.equal(slideKey(slide('generated-title', 'lecture-1-frame-004'), { h: 3, v: 0 }),
    'lecture-1-frame-004');
  assert.equal(slideKey(slide('solution-1'), { h: 4, v: 0 }), 'solution-1');
  assert.equal(slideKey(slide('uncounted-replacement'), { h: 5, v: 0 }),
    'uncounted-replacement');
  // Reveal fragments do not create sections or new indices, so their key is
  // deliberately the same section id before and after a fragment is shown.
  assert.equal(slideKey(slide('worked-example'), { h: 6, v: 0 }), 'worked-example');
  assert.equal(slideKey(slide('worked-example'), { h: 6, v: 0 }), 'worked-example');
  assert.equal(slideKey(null, { h: 7, v: 2 }), '7.2');
});

test('index-keyed legacy ink migrates without losing distinct stable ink', () => {
  const oldStroke = { t: 'pen', p: [[1, 2, 0.5]] };
  const keptStroke = { t: 'pen', p: [[3, 4, 0.5]] };
  const ink = {
    '0.0': [oldStroke, keptStroke],
    'scribble-slide-001': [keptStroke]
  };

  assert.equal(migrateInkKeys(ink, [
    { stable: 'scribble-slide-001', legacy: '0.0' },
    { stable: 'scribble-slide-002', legacy: '1.0' }
  ]), true);
  assert.equal(ink['0.0'], undefined);
  assert.deepEqual(ink['scribble-slide-001'], [keptStroke, oldStroke]);
});

test('legacy 16:10 ink is centred in the wider 16:9 canvas without distortion', () => {
  const ink = {
    'scribble-slide-001': [{
      t: 'pen', w: 12.4, p: [[-50, 100, 0.3], [1170, 650, 0.8]]
    }]
  };
  assert.equal(reframeInk(ink, { width: 1120, height: 700 }, { width: 1244, height: 700 }), true);
  assert.deepEqual(ink['scribble-slide-001'][0].p, [[12, 100, 0.3], [1232, 650, 0.8]]);
  assert.equal(ink['scribble-slide-001'][0].w, 12.4);
  assert.equal(reframeInk(ink, { width: 1244, height: 700 }, { width: 1244, height: 700 }), false);
});

test('Safari overscan coordinates are repaired independently on each axis', () => {
  const ink = {
    first: [{ t: 'pen', p: [[2488, 1400, 0.4], [6220, 3500, 0.8]] }],
    continued: [{ t: 'pen', p: [[3110, 64, 0.5], [4976, 700, 0.5]] }],
    ordinary: [{ t: 'pen', p: [[100, 200, 0.5], [1100, 600, 0.5]] }]
  };
  assert.equal(repairOverscanCoordinates(ink, { width: 1244, height: 700 }), true);
  assert.deepEqual(ink.first[0].p, [[0, 0, 0.4], [1244, 700, 0.8]]);
  assert.deepEqual(ink.continued[0].p, [[207.3, 64, 0.5], [829.3, 700, 0.5]]);
  assert.deepEqual(ink.ordinary[0].p, [[100, 200, 0.5], [1100, 600, 0.5]]);
  assert.equal(repairOverscanCoordinates(ink, { width: 1244, height: 700 }), false);
});

test('next-slide lookup follows reveal order and stops at the final slide', () => {
  var slides = [{ id: 'counted' }, { id: 'uncounted-replacement' }, { id: 'next-topic' }];
  assert.equal(nextItem(slides, slides[0]), slides[1]);
  assert.equal(nextItem(slides, slides[1]), slides[2]);
  assert.equal(nextItem(slides, slides[2]), null);
  assert.equal(nextItem(slides, { id: 'unknown' }), null);
});
