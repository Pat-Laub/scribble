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
    nextItem: nextItem
  };
});
