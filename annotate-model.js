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

  function strokeWidth(stroke, toolWidths) {
    return stroke.w > 0 ? stroke.w : toolWidths[stroke.t];
  }

  // Move through a finite palette without putting input-device behaviour in
  // the annotation model. The browser UI uses this for a mouse wheel; a future
  // presenter view can bind the same rule to whatever controls it exposes.
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

  // Older exports predate per-stroke widths. Capture the receiving device's
  // current rendering width once so the legacy ink keeps its appearance and
  // becomes deterministic from then on.
  function ensureStrokeWidths(ink, toolWidths) {
    Object.keys(ink).forEach(function (key) {
      if (!Array.isArray(ink[key])) return;
      ink[key].forEach(function (stroke) {
        if (!(stroke.w > 0)) stroke.w = toolWidths[stroke.t];
      });
    });
    return ink;
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

  // A deliberately authored annotation id is strongest. A normal section id
  // is next (Quarto gives every titled slide one), and reveal's h/v indices
  // remain only as a compatibility fallback for old or headingless decks.
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

  // Move index-keyed ink written by older versions onto stable slide ids.
  // If both keys contain ink, retain every distinct stroke rather than making
  // migration choose which set deserves to survive.
  function migrateInkKeys(ink, mappings) {
    var changed = false;
    (mappings || []).forEach(function (mapping) {
      var stable = mapping && mapping.stable;
      var legacy = mapping && mapping.legacy;
      if (!stable || !legacy || stable === legacy || !Array.isArray(ink[legacy])) return;
      var target = Array.isArray(ink[stable]) ? ink[stable] : [];
      var seen = Object.create(null);
      target.forEach(function (stroke) { seen[JSON.stringify(stroke)] = true; });
      ink[legacy].forEach(function (stroke) {
        var signature = JSON.stringify(stroke);
        if (!seen[signature]) { target.push(stroke); seen[signature] = true; }
      });
      ink[stable] = target;
      delete ink[legacy];
      changed = true;
    });
    return changed;
  }

  return {
    pressureSample: pressureSample,
    isIPad: isIPad,
    strokeWidth: strokeWidth,
    cycleValue: cycleValue,
    ownsPointer: ownsPointer,
    ensureStrokeWidths: ensureStrokeWidths,
    cloneStrokes: cloneStrokes,
    slideKey: slideKey,
    migrateInkKeys: migrateInkKeys
  };
});
