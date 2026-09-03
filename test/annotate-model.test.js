const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pressureSample, isIPad, cycleValue, ownsPointer, cloneStrokes,
  slideKey, nextItem, flatEnough, appendSamples
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

test('next-slide lookup follows reveal order and stops at the final slide', () => {
  var slides = [{ id: 'counted' }, { id: 'uncounted-replacement' }, { id: 'next-topic' }];
  assert.equal(nextItem(slides, slides[0]), slides[1]);
  assert.equal(nextItem(slides, slides[1]), slides[2]);
  assert.equal(nextItem(slides, slides[2]), null);
  assert.equal(nextItem(slides, { id: 'unknown' }), null);
});

test('a coalesced batch that repeats the previous one adds nothing', () => {
  // Safari on iPadOS re-reports the whole of the batch before it.
  const p = [[0, 0, 0.5], [4, 0, 0.5], [8, 0, 0.5]];
  const again = appendSamples(p, [[0, 0, 0.5], [4, 0, 0.5], [8, 0, 0.5]]);
  assert.equal(again.added, 0);
  assert.deepEqual(p, [[0, 0, 0.5], [4, 0, 0.5], [8, 0, 0.5]]);
});

test('samples closer together than a step say nothing new', () => {
  const p = [[0, 0, 0.5]];
  assert.equal(appendSamples(p, [[0.1, 0.1, 0.5], [0.2, 0, 0.5]]).added, 0);
  assert.equal(appendSamples(p, [[1, 0, 0.5]]).added, 1);
});

test('a straight run is thinned to its ends while a curve keeps its points', () => {
  const straight = [[0, 0, 0.5]];
  for (let x = 1; x <= 10; x++) appendSamples(straight, [[x, 0, 0.5]]);
  // A flat run collapses to its start, one anchor and the tip: the point
  // behind the tip keeps being taken back as each new sample stands for it.
  assert.equal(straight.length, 3);
  assert.deepEqual(straight[straight.length - 1], [10, 0, 0.5]);

  const curved = [[0, 0, 0.5]];
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    appendSamples(curved, [[10 * Math.cos(a), 10 * Math.sin(a), 0.5]]);
  }
  assert.ok(curved.length > 8);
});

test('thinning never touches the newest sample, so the ink stays under the nib', () => {
  const p = [[0, 0, 0.5], [1, 0, 0.5], [2, 0, 0.5]];
  const tip = [3, 0, 0.5];
  appendSamples(p, [tip]);
  assert.deepEqual(p[p.length - 1], tip);
});

test('a change of pressure holds a point that is otherwise flat', () => {
  assert.equal(flatEnough([0, 0, 0.5], [1, 0, 0.5], [2, 0, 0.5]), true);
  assert.equal(flatEnough([0, 0, 0.3], [1, 0, 0.5], [2, 0, 0.5]), false);
  // A neighbour pair further apart than the span is not allowed to stand in.
  assert.equal(flatEnough([0, 0, 0.5], [10, 0, 0.5], [20, 0, 0.5]), false);
  // Nor is one the middle point sits visibly off.
  assert.equal(flatEnough([0, 0, 0.5], [1, 2, 0.5], [2, 0, 0.5]), false);
});

test('a dropped point is reported, so a live path knows to redraw', () => {
  const p = [[0, 0, 0.5], [1, 0, 0.5], [2, 0, 0.5]];
  const added = appendSamples(p, [[3, 0, 0.5]]);
  assert.equal(added.added, 1);
  assert.equal(added.dropped, 1);
});
