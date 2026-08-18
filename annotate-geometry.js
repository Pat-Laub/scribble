// Pure geometry shared by the annotation UI and its tests. Keeping these
// operations free of DOM and reveal.js state also makes them portable to a
// presenter/viewer setup.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnnotationGeometry = api;
})(typeof window !== 'undefined' ? window : this, function () {
  function rulePositions(height, spacing, margin) {
    var out = [];
    for (var y = margin; y <= height - margin; y += spacing) out.push(y);
    return out;
  }

  return { rulePositions: rulePositions };
});
