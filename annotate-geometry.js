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

  function pointInPolygon(point, polygon) {
    var inside = false, x = point[0], y = point[1];
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var a = polygon[i], b = polygon[j];
      var crosses = (a[1] > y) !== (b[1] > y) &&
        x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0];
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function polygonContainsPoints(polygon, points) {
    return polygon.length >= 3 && points.length > 0 && points.every(function (p) {
      return pointInPolygon(p, polygon);
    });
  }

  function pointsBounds(points) {
    if (!points.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    points.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    return [x0, y0, x1, y1];
  }

  function insideBounds(point, box, padding) {
    padding = padding || 0;
    return !!box && point[0] >= box[0] - padding && point[0] <= box[2] + padding &&
      point[1] >= box[1] - padding && point[1] <= box[3] + padding;
  }

  function translatePoints(points, dx, dy) {
    return points.map(function (p) { return [p[0] + dx, p[1] + dy, p[2]]; });
  }

  return {
    rulePositions: rulePositions,
    pointInPolygon: pointInPolygon,
    polygonContainsPoints: polygonContainsPoints,
    pointsBounds: pointsBounds,
    insideBounds: insideBounds,
    translatePoints: translatePoints
  };
});
