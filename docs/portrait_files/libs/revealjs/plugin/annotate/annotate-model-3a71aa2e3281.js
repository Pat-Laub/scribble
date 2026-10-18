// Small, DOM-free annotation input/model helpers. The browser UI consumes this
// file, while tests and a future multiplex transport can use the same rules
// without depending on reveal.js.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnnotationModel = api;
})(typeof window !== 'undefined' ? window : this, function () {
  function pressureSample(stylus, pressureEnabled, rawPressure, baseline, scale) {
    if (!stylus || !pressureEnabled) return 0.5;
    return Math.min(1, Math.max(0, baseline + rawPressure * scale));
  }

  // Since iPadOS 13, Safari can identify an iPad as a desktop-class Mac. A real
  // Mac currently has no touch points, so the second half distinguishes them.
  function isIPad(device) {
    if (!device) return false;
    return /iPad/i.test(device.userAgent || '') ||
      (device.platform === 'MacIntel' && device.maxTouchPoints > 1);
  }

  // Move through a finite palette without putting input-device behaviour in
  // the annotation model. The browser UI uses this for a mouse wheel.
  function cycleValue(values, current, direction) {
    if (!values.length || !direction) return current;
    var at = values.indexOf(current);
    if (at < 0) at = 0;
    return values[(at + (direction > 0 ? 1 : -1) + values.length) % values.length];
  }

  // A gesture belongs only to the contact that began it. In particular, a
  // palm lifting while an Apple Pencil is still down must not finish the
  // Pencil stroke.
  function ownsPointer(activePointerId, eventPointerId) {
    return activePointerId !== null && activePointerId !== undefined &&
      activePointerId === eventPointerId;
  }

  // Clipboard ink must share no objects with its source: moving a pasted copy
  // must never tug the original along with it. Optional offsets are useful for
  // making an in-place duplicate visible before it is dragged elsewhere.
  function cloneStrokes(strokes, dx, dy) {
    var copies = JSON.parse(JSON.stringify(strokes || []));
    dx = dx || 0;
    dy = dy || 0;
    copies.forEach(function (stroke) {
      stroke.p = (stroke.p || []).map(function (point) {
        var moved = point.slice();
        moved[0] += dx;
        moved[1] += dy;
        return moved;
      });
    });
    return copies;
  }

  // A stylus samples on a clock, not on the shape of the writing, so a run
  // going straight collects as many samples as the tightest loop of an 'e'.
  // Filters run on the way in, so the points that are drawn are exactly the
  // points that are kept, saved and exported.
  //
  //   * `repeat` — how far back to look for a point the stroke already holds.
  //     Safari on iPadOS opens each coalesced batch with the whole of the batch
  //     before it; appending those walks the stroke back over itself, and
  //     perfect-freehand reads every fold as a change of direction and caps it,
  //     which is why an Apple Pencil drew a chain of segments where a mouse
  //     drew one line. This one is correctness, not economy, and stays on.
  //   * `step` — a sample closer than this to the last one, at much the same
  //     pressure, says nothing the last one did not.
  //   * `flat` / `span` — once a third sample lands, the one behind it is asked
  //     whether its two neighbours already stand for it: within `flat` of the
  //     line between them, over no more than `span`, and carrying no change of
  //     pressure. If they do it goes.
  //
  // `step` and `flat` are both off: every sample the pen gives is kept.
  //
  // `flat` is off because it was broken, not merely expensive. It takes back a
  // point the stroke already holds, and it can do that on sample after sample,
  // so through the gentle curves that most of handwriting is made of the kept
  // points stop following the pen and the stroke crosses the curve in straight
  // chords of up to `span` -- about 13 screen pixels on an iPad, a ruled line
  // through the middle of a letter, at the widths mathematics is written at.
  // Lowering `flat` changes how often that happens, never how long the chords
  // are, since `span` alone bounds those. `pressure` hid it for years: each
  // rule declines to drop a point whose pressure is doing something, so with
  // stylus pressure ON the runs were constantly interrupted and the damage was
  // mild. With pressure off every point carries a flat 0.5, the guard can never
  // fire, and the rule ran unopposed -- it discarded 47% of a real page of
  // handwriting on its own. `test/annotate-model.test.js` keeps a todo test
  // that still describes it.
  //
  // `step` is off because what it bought is no longer needed. It is not
  // destructive the way `flat` is -- it only skips an incoming sample, never
  // takes back a kept one -- but it is an economy, and the economy has been
  // paid for twice over: the packed v7 encoding (annotate-codec.js) spends
  // about 8 bytes on a point where the old JSON spent 20, and saved ink only
  // has to outlive one lecture. A deck is written on, exported, and done with;
  // localStorage is the buffer between those two moments, not an archive. A
  // heavily annotated lecture is about 1.8 MB packed with nothing dropped,
  // which sits inside the few megabytes an origin gets with room to spare, and
  // keeping every sample is worth more than the headroom for a second lecture
  // that is never wanted at the same time.
  //
  // Neither rule was ever needed for drawing: Trail in annotate.js rebuilds
  // only the tail, capped at CHUNK + OVERLAP points, so the cost of a frame
  // does not grow with the stroke.
  //
  // The mechanism is kept, and `appendSamples` still honours whatever
  // thresholds it is handed: the unit tests drive them directly, and a caller
  // storing ink somewhere tighter may want them. `step`, `flat` and `span` are
  // distances in the page's own units, so were they turned back on they would
  // have to track the authored page -- the values below are for the 3744-unit
  // page the stage draws, three times the 1248-unit page they were first tuned
  // against. `pressure` is a pressure difference and `repeat` a count, so
  // neither scales.
  var SAMPLING = { repeat: 32, step: 0, flat: 0, span: 36, pressure: 0.03 };

  function seenRecently(points, q, repeat) {
    for (var i = Math.max(0, points.length - repeat); i < points.length; i++) {
      if (points[i][0] === q[0] && points[i][1] === q[1]) return true;
    }
    return false;
  }

  // Whether b sits close enough to the line a–c to be dropped.
  function flatEnough(a, b, c, options) {
    var o = options || SAMPLING;
    if (Math.abs(b[2] - a[2]) > o.pressure || Math.abs(c[2] - b[2]) > o.pressure) return false;
    var dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
    if (!len || len > o.span) return false;
    return Math.abs(dy * (b[0] - a[0]) - dx * (b[1] - a[1])) / len < o.flat;
  }

  // Appends a batch of fresh samples to `points` in place, since a stroke is
  // added to on every frame of it and copying the whole array to do that is the
  // growing cost the thinning above is meant to avoid. Reports the samples it
  // kept, how many they are, and how many already-held points the thinning took
  // back -- a window watching this stroke over a wire needs all three: drop
  // `dropped` from its end, then append `kept`.
  function appendSamples(points, batch, options) {
    var o = options || SAMPLING;
    var kept = [], dropped = 0;
    for (var i = 0; i < batch.length; i++) {
      var q = batch[i], prev = points[points.length - 1];
      if (seenRecently(points, q, o.repeat)) continue;
      if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < o.step &&
          Math.abs(q[2] - prev[2]) < o.pressure + 0.02) continue;
      if (points.length > 2 &&
          flatEnough(points[points.length - 2], prev, q, o)) {
        // Taking back a point this same batch had just added: the far end
        // never saw it, so it is one fewer thing to send rather than one more
        // to un-send.
        if (kept.length && kept[kept.length - 1] === points[points.length - 1]) kept.pop();
        else dropped++;
        points.pop();
      }
      points.push(q);
      kept.push(q);
    }
    return { kept: kept, added: kept.length, dropped: dropped };
  }

  // A deliberately authored annotation id is strongest. A normal section id
  // is next (Quarto gives every titled slide one), and reveal's h/v indices
  // remain only as a fallback for headingless decks.
  // Uncounted slides are still distinct sections; fragment animations remain
  // on one section and therefore correctly share one key.
  function slideKey(slide, indices) {
    if (slide) {
      var explicit = slide.getAttribute && slide.getAttribute('data-annotation-id');
      if (explicit) return explicit;
      if (slide.id) return slide.id;
    }
    indices = indices || {};
    return (isFinite(indices.h) ? indices.h : 0) + '.' +
      (isFinite(indices.v) ? indices.v : 0);
  }

  function nextItem(items, current) {
    var at = (items || []).indexOf(current);
    return at >= 0 && at + 1 < items.length ? items[at + 1] : null;
  }

  return {
    pressureSample: pressureSample,
    isIPad: isIPad,
    cycleValue: cycleValue,
    ownsPointer: ownsPointer,
    cloneStrokes: cloneStrokes,
    slideKey: slideKey,
    nextItem: nextItem,
    SAMPLING: SAMPLING,
    flatEnough: flatEnough,
    appendSamples: appendSamples
  };
});
