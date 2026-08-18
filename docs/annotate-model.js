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

  return {
    pressureSample: pressureSample,
    isIPad: isIPad,
    strokeWidth: strokeWidth,
    cycleValue: cycleValue,
    ensureStrokeWidths: ensureStrokeWidths
  };
});
