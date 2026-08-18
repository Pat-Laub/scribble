// Small, DOM-free annotation model helpers. The browser UI consumes this file,
// while tests and a future multiplex transport can use the same rules without
// depending on reveal.js.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnnotationModel = api;
})(typeof window !== 'undefined' ? window : this, function () {
  function pressureSample(stylus, pressureEnabled, rawPressure, boost) {
    return stylus && pressureEnabled ? rawPressure * boost : 0.5;
  }

  function strokeWidth(stroke, toolWidths) {
    return stroke.w > 0 ? stroke.w : toolWidths[stroke.t];
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
    strokeWidth: strokeWidth,
    ensureStrokeWidths: ensureStrokeWidths
  };
});
