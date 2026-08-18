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

  return { pressureSample: pressureSample };
});
