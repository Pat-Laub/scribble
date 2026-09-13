// How saved ink is written down. Storage only: the multiplex wire and the
// in-memory strokes are untouched, so a viewer is never handed numbers the
// presenter's pen did not produce.
//
// A stroke used to be stored as JSON -- `[1392.4,276,0.41]`, about 19.5 bytes a
// point measured over a real page of handwriting -- and two sampling rules
// existed to throw points away so that there were fewer of them. One of those
// rules chorded straight lines across gentle curves (see SAMPLING in
// annotate-model.js), and the other bought nine percent. Both are off, because
// the cheaper thing to change was the writing-down, not the ink.
//
// The capture path already settles precision: pointFromRect rounds x and y to
// one decimal, pressureSample rounds pressure to two. So the whole of a point
// fits five bytes with nothing lost --
//
//     int16  x - previous x, in tenths
//     int16  y - previous y, in tenths
//     uint8  pressure, in hundredths
//
// -- plus an int32 pair at the head of each stroke for where it starts, since
// an absolute coordinate on a 3744-unit page does not fit an int16 of tenths.
// Base64 over that is about 7 bytes a point: a third of what the JSON cost, so
// every sample can now be kept for less than the thinned ones used to cost.
//
// Round-tripping is exact, and `test/annotate-codec.test.js` is where that is
// held. Nothing here is allowed to become lossy: the wire carries unpacked
// points, so any rounding introduced on this side would put a viewer's copy of
// a stroke somewhere other than the presenter's.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnnotationCodec = api;
})(typeof window !== 'undefined' ? window : this, function () {
  var VERSION = 7;
  var HEAD = 8;               // two int32: the stroke's first point, in tenths
  var STRIDE = 5;             // int16 dx, int16 dy, uint8 pressure
  var LIMIT = 32767;          // what a delta of tenths has to fit in
  var NEUTRAL = 0.5;          // pressure for a point that carries none

  // A stroke whose points are further apart than a delta can express. A pen on
  // the authored page cannot do it; a caller that manages it gets its stroke
  // stored as plain JSON instead of an exception.
  function Unencodable(message) { this.message = message; }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // Node has Buffer and browsers have btoa, but neither is present in both, and
  // btoa on a long stroke wants a string built a chunk at a time. Doing it here
  // keeps the module free of either.
  function toBase64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var left = bytes.length - i;
    if (left === 1) {
      out += B64[bytes[i] >> 2] + B64[(bytes[i] << 4) & 63] + '==';
    } else if (left === 2) {
      out += B64[bytes[i] >> 2] +
        B64[((bytes[i] << 4) | (bytes[i + 1] >> 4)) & 63] +
        B64[(bytes[i + 1] << 2) & 63] + '=';
    }
    return out;
  }

  function fromBase64(text) {
    var clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
    var bytes = new Uint8Array(Math.floor(clean.length * 3 / 4));
    var at = 0, buffer = 0, bits = 0;
    for (var i = 0; i < clean.length; i++) {
      buffer = (buffer << 6) | B64.indexOf(clean[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes[at++] = (buffer >> bits) & 255; }
    }
    return bytes.subarray(0, at);
  }

  function tenths(v) { return Math.round(v * 10); }

  // The points of one stroke as a base64 string. Throws Unencodable if a step
  // is too wide for an int16 of tenths; packInk() is what decides what to do
  // about that.
  function packPoints(points) {
    points = points || [];
    if (!points.length) return '';
    var bytes = new Uint8Array(HEAD + points.length * STRIDE);
    var view = new DataView(bytes.buffer);
    var x = tenths(points[0][0]), y = tenths(points[0][1]);
    view.setInt32(0, x, true);
    view.setInt32(4, y, true);
    var at = HEAD, px = x, py = y;
    for (var i = 0; i < points.length; i++) {
      var q = points[i];
      var qx = tenths(q[0]), qy = tenths(q[1]);
      var dx = qx - px, dy = qy - py;
      if (dx > LIMIT || dx < -LIMIT - 1 || dy > LIMIT || dy < -LIMIT - 1) {
        throw new Unencodable('a step of ' + dx + ',' + dy + ' tenths is wider than the packed form allows');
      }
      view.setInt16(at, dx, true);
      view.setInt16(at + 2, dy, true);
      // A point with no pressure of its own -- a text box's corner, or anything
      // built rather than drawn -- reads back at the neutral width.
      var pressure = q.length > 2 && isFinite(q[2]) ? q[2] : NEUTRAL;
      view.setUint8(at + 4, Math.round(pressure * 100));
      px = qx; py = qy; at += STRIDE;
    }
    return toBase64(bytes);
  }

  function unpackPoints(text) {
    if (!text) return [];
    var bytes = fromBase64(text);
    if (bytes.length < HEAD) return [];
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var px = view.getInt32(0, true), py = view.getInt32(4, true);
    var out = [];
    for (var at = HEAD; at + STRIDE <= bytes.length; at += STRIDE) {
      px += view.getInt16(at, true);
      py += view.getInt16(at + 2, true);
      out.push([px / 10, py / 10, view.getUint8(at + 4) / 100]);
    }
    return out;
  }

  function isText(annotation) { return annotation && annotation.t === 'text'; }

  // A whole slide-keyed ink object, ready to be stringified. Strokes carry
  // their points packed, under `b`; text boxes are four corners and a string,
  // where packing saves nothing, so they travel as they are. The argument is
  // not touched -- it is the live ink the deck is still drawing on.
  function packInk(ink) {
    var out = {};
    Object.keys(ink || {}).forEach(function (key) {
      out[key] = (ink[key] || []).map(function (annotation) {
        if (isText(annotation)) return annotation;
        var packed = {}, name;
        for (name in annotation) if (name !== 'p') packed[name] = annotation[name];
        try {
          packed.b = packPoints(annotation.p);
        } catch (e) {
          if (!(e instanceof Unencodable)) throw e;
          return annotation;   // stored plain; unpackInk reads it back as it is
        }
        return packed;
      });
    });
    return out;
  }

  function unpackInk(packed) {
    var out = {};
    Object.keys(packed || {}).forEach(function (key) {
      out[key] = (packed[key] || []).map(function (annotation) {
        if (!annotation || typeof annotation.b !== 'string') return annotation;
        var stroke = {}, name;
        for (name in annotation) if (name !== 'b') stroke[name] = annotation[name];
        stroke.p = unpackPoints(annotation.b);
        return stroke;
      });
    });
    return out;
  }

  return {
    VERSION: VERSION,
    Unencodable: Unencodable,
    packPoints: packPoints,
    unpackPoints: unpackPoints,
    packInk: packInk,
    unpackInk: unpackInk
  };
});
