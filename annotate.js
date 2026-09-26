// Freehand annotation for reveal.js — pen, highlighter and eraser.
//
// This replaces the reveal.js chalkboard plugin, whose ink is painted straight
// onto a <canvas>. Here a stroke is instead kept as what it really is: a list of
// points. perfect-freehand (MIT, vendored alongside this file) turns each list
// into the outline of a pressure-styled stroke, which we render as one SVG
// <path>. Keeping strokes as objects rather than pixels is what makes the rest
// fall out cheaply:
//
//   * erasing removes a whole stroke — hit-test the pointer against its points
//     and drop it, rather than scrubbing pixels, and a stroke that is a
//     scribble over other strokes can rub them out without reaching for a tool;
//   * undo/redo is a snapshot of the (small) per-slide stroke list;
//   * persistence is JSON.stringify into localStorage, keyed by deck and slide;
//   * the ink is resolution-independent, so it stays sharp on HiDPI screens and
//     when the window is resized — both of which needed workarounds under the
//     canvas-based plugin.
//
// The ink is drawn on SVG layers inside `.reveal .slides`, so they inherit
// reveal's slide transform: we can work in slide coordinates (the deck's
// configured width × height) and let the browser scale the result. That also
// makes stored strokes independent of the window size they were drawn at.
// Styling — and why there is a layer per tool — is in annotate.scss.
(function () {
  if (!window.perfectFreehand) return;
  var getStroke = perfectFreehand.getStroke;

  /* ---------------------------- configuration ---------------------------- */

  var COLOURS = [
    ['Black', '#252525'], ['Blue', '#2668c7'], ['Green', '#0f9d58'],
    ['Orange', '#e8710a'], ['Red', '#d94827']
  ];

  // How wide each tool draws, in slide coordinates. These defaults are tuned
  // for handwriting at the deck's corrected, browser-independent scale.
  var WIDTHS = { pen: 12.3, highlighter: 86 };

  // The rest of what perfect-freehand needs, which is what gives a stroke its
  // shape rather than its weight: how far pressure narrows it, how much the
  // input is smoothed and how far it lags the tip. Taken from the ../scribble
  // deck, and unlike the widths they came over as they stood.
  //
  // The pen carries a second set for a device with no pressure of its own,
  // where perfect-freehand guesses it from how fast the stroke is drawn; that
  // guess suits a narrower nib, so `share` takes it to 0.62 of the width above.
  var TOOLS = {
    pen: {
      thinning: 0.85, smoothing: 0.62, streamline: 0.62,
      easing: function (t) { return t * 0.65 + Math.sin(t * Math.PI / 2) * 0.35; },
      simulated: {
        share: 0.62, thinning: 0.5, smoothing: 0.62, streamline: 0.64,
        easing: function (t) { return Math.sin(t * Math.PI / 2); }
      }
    },
    highlighter: { thinning: 0, smoothing: 0.5, streamline: 0.5 }
  };

  // The widths above are a starting point, not the last word: how thick a line
  // has to be depends on the room and the projector, and neither is known here.
  // The panel's − and + take the tool in hand between these multiples of its
  // width, and what they settle on is kept in localStorage — as a width rather
  // than as a multiple, so that changing the defaults above never compounds
  // with a choice already made — for every deck on the device.
  var NIB = { min: 0.25, max: 3, step: 1.25 };
  var WIDTH_STORE = 'reveal-ink-width-v2';

  // Black ink is black, but a black *highlighter* is a grey smear over the
  // words it is meant to pick out. The first swatch draws — and shows itself
  // as — the colour a highlighter actually is while that tool is in hand.
  var HIGHLIGHT = '#facc15';
  // The two tools whose icon carries a colour of its own. The pen has none --
  // it draws in whichever swatch is picked, so colouring it would be a claim
  // the tool does not make.
  var RUBBER = '#f9a8d4';

  var ERASER = 10;      // eraser hit radius, in slide coordinates
  var RESIZE_HANDLE = 12; // selection-corner display and touch hit radius
  var UNDO_DEPTH = 40;  // snapshots kept per slide

  // How far each layer reaches beyond the slide, as a multiple of the deck's
  // The layers fill the fixed stage, which is the whole authored page. Nothing
  // is letterboxed inside it, so a pointer that goes down anywhere on screen is
  // already over the layer and no overscan is needed; before the stage existed
  // this was 1, covering a deck's width and height either side of the slide.
  var OVERSCAN = 0;

  // Ink is drawn and stored in the coordinates of the authored page. The stage
  // publishes that page's size on itself, which is the same value its own fit
  // transform uses, so there is one source of truth and nothing to keep in
  // step by hand. Without a stage, the reveal frame is the page.
  function pageSize() {
    var stage = document.querySelector('[data-deck-stage]');
    if (stage) {
      var css = getComputedStyle(stage);
      return [
        parseFloat(css.getPropertyValue('--deck-width')) || stage.offsetWidth,
        parseFloat(css.getPropertyValue('--deck-height')) || stage.offsetHeight
      ];
    }
    var cfg = Reveal.getConfig();
    return [parseFloat(cfg.width) || 960, parseFloat(cfg.height) || 700];
  }

  // Scribbling over a mistake is the gesture everyone already makes on paper,
  // and it saves reaching for the eraser and back mid-sentence. The thresholds
  // below keep it a narrow gesture: a stroke that sweeps back along its own
  // long axis several times, gets nowhere doing it, *and* crosses one stroke's
  // ink repeatedly. An advancing zigzag or a sine wave progresses steadily
  // along its long axis and so is not a scribble, which is how a sketched
  // waveform stays a sketch; and because the crossings are counted per stroke,
  // a slash through an equation or an arrow across a derivation never adds up
  // to a trigger.
  //
  // `reversals` was 2 -- a Z -- and `progress` did not exist. Handwriting
  // reverses far more than that suggests: over a lecture's 2208 strokes, 491
  // of them cleared a threshold of 2, and the only thing standing between them
  // and an erase was the crossing count, which one stroke came within one of
  // reaching. A capital B written spine-first cleared all three: its bowls
  // meet the spine at the top, the waist and the foot, and the climb back to
  // the top to start them reads as the doubling back. `progress` is what tells
  // the two apart -- a scribble sweeps without travelling, and the same
  // lecture's near miss scored 0.006 against a B's 0.145 at worst.
  var SCRIBBLE = {
    reversals: 4,   // direction reversals along the long axis
    travel: 10,     // how far a reversal must go to be one, not end-of-stroke wobble
    progress: 0.09, // net displacement over path length: a scribble goes nowhere
    overlap: 0.5,   // bounding-box overlap needed before counting crossings
    crossings: 3,   // crossings with a *single* stroke before it is erased
    size: 90,       // smallest scribble that erases; below it, a point is being filled in
    elongated: 5,   // a stroke this many times longer than wide is a line...
    aligned: 20,    // ...and a scribble within this many degrees of it is going over it
    slack: 4,       // padding on every box, so a straight stroke has an area
    tolerance: 2    // simplification tolerance; ink is sampled far finer than needed
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // The format version is in the key, so ink written by an older build is not
  // read rather than mis-read. v6 stored the points as plain JSON; v7 packs
  // them (annotate-codec.js) and keeps every sample instead of thinning.
  var STORE = 'reveal-ink-v7:' + location.pathname;
  // What the ink store deliberately forgets. An export used to be the state the
  // slides ended in; a stroke that was rubbed out left no trace, so the one
  // thing a misfiring gesture produces -- the stroke it took, and the scribble
  // that took it -- was exactly what could not be looked at afterwards. This
  // keeps them, packed the same way and beside the rest, so a lecture exports
  // as what happened rather than as what survived.
  var ERASED_STORE = 'reveal-ink-erased-v7:' + location.pathname;

  // Which end of a multiplexed deck this is. The role is stored per device by a sign-in
  // page and read from the same localStorage keys the
  // multiplex plugin uses, so no ids travel in URLs. 'audience' is this file's
  // 'viewer'. See the multiplexing section below.
  //
  // Every window takes what the multiplex plugin hands it, whatever this says.
  // What this decides is what a window puts back: a viewer is a screen being
  // watched -- the projector, or a second window of this browser shown on one --
  // and it draws nothing, keeps nothing and sends nothing of its own.
  var MUX = (function () {
    // `?project` says so per window rather than per device, which the stored
    // role below cannot: both windows of one browser share that localStorage.
    if (new URLSearchParams(location.search).has('project')) return 'viewer';
    // Credentials handed to the page win over the stored pair, exactly as they
    // do in multiplex.js: the two must agree, or a window follows the relay as
    // an audience while still keeping and broadcasting ink of its own.
    var role, handed = window.__multiplex || {};
    if (handed.role && handed.token) role = handed.role;
    else try {
      if (!localStorage.getItem('multiplex-token')) return null;
      role = localStorage.getItem('multiplex-role');
    } catch (e) {
      return null;  // storage blocked: an ordinary deck
    }
    return role === 'presenter' ? 'presenter' : role === 'audience' ? 'viewer' : null;
  })();
  var PRINT = /(?:^|[?&])print-pdf(?:[=&]|$)/i.test(location.search);
  var PRINT_INK = PRINT && /(?:^|[?&])ink(?:[=&]|$)/i.test(location.search);
  var RULE_STORE = 'reveal-ink-rules';
  var RULE_SPACING_STORE = 'reveal-ink-rule-spacing';
  var PRESSURE_STORE = 'reveal-ink-pressure';
  var DELAY_STORE = 'reveal-ink-multiplex-delay';
  // Where the tool rail was last left, per deck: the deck's `dock` option only
  // says where it starts.
  var DOCK_STORE = 'reveal-ink-dock:' + location.pathname;

  // How long a viewer holds each packet of a stroke before drawing it, in
  // milliseconds, and the settings the more menu offers. See the multiplexing
  // section for what the wait buys.
  var DELAY = 20;
  var DELAYS = [ 0, 10, 20, 40, 80 ];
  var DIAGNOSTIC_LIMIT = 12000;
  // Centre ordinary light Pencil writing near perfect-freehand's neutral 0.5
  // width, while retaining useful room on either side for pressure variation.
  var PRESSURE = { enabledByDefault: true, baseline: 0.35, scale: 0.75 };
  var RULES = { spacing: 92, min: 60, max: 124, step: 8, margin: 64 };
  var TEXT = { size: 34, width: 360, lineHeight: 1.25, padding: 0.16, dragThreshold: 6 };

  /* -------------------------------- state -------------------------------- */

  // Ink is either a pressure-shaped stroke, or a text box with { t: 'text',
  // c: colour, f: font size, v: value, p: four box corners }. Everything that
  // affects rendering travels with the annotation.
  var widths = readWidths(); // active presets for the next stroke of each tool
  var ink = MUX === 'viewer' ? {} : read();
  var undos = {}, redos = {};// { slideKey: [JSON snapshot, ...] }
  // Whether the tools are in hand from the start; set in init() from the deck's
  // own config, since the option only exists once Reveal is configured. A blank
  // writing pad is opened to write on, so they are; a lecture deck is opened to
  // present, so they are not, and it gets a corner button to reach for them.
  var toolsOpen = false;
  var tool = null;
  var lastTool = 'pen';      // restored after temporarily hiding the tools
  var chrome = MUX !== 'viewer';  // the bottom-left corner buttons are on show
  var ruled = readRules();    // local view preference; never part of shared ink
  var ruleSpacing = readRuleSpacing(); // browser-local guide density
  var pressureEnabled = readPressure(); // captured into each new stroke's points
  var playDelay = readDelay();  // presenter's choice; viewers are told it
  var colour = COLOURS[0][1];
  var moreOpen = false;       // session controls expand beside the writing rail
  var lastWheel = 0;          // one colour step per physical wheel gesture
  var live = null;           // { stroke, trail } while a stroke is being drawn
  var erasing = false;       // an eraser drag is in progress
  var held = null;           // the tool the right button borrowed the eraser from
  var armed = false;         // the live stroke has been recognised as a scribble
  var marked = [];           // strokes the eraser or scribble takes when let go
  // Ink a scribble on *another* window has marked. Held against the strokes
  // rather than their paths, which a slide change or a redraw replaces.
  var fading = new WeakSet();
  var selected = [];         // strokes enclosed by the current lasso
  var lasso = null;          // { p, el } while a selection loop is being drawn
  var moving = null;         // original points while selected strokes are dragged
  var resizing = null;       // fixed corner and originals while selection scales
  var textMoving = null;     // pending tap, or direct drag, on committed text
  var editing = null;        // in-place textarea and its uncommitted text-box draft
  var clipboard = null;      // copied strokes survive slide changes for this session
  var nodes = new WeakMap(); // annotation -> its SVG element
  var thinned = new WeakMap();         // stroke -> its simplified points
  var overviewPoints = new WeakMap();  // the same, thinned for a preview cell
  var layers = {};           // one SVG per rendered annotation type; see build()
  var view;                  // every layer's viewBox, in slide coordinates
  // On an iPad this deck assumes an Apple Pencil is available, so fingers are
  // navigation/palm input from the first touch. Elsewhere, touch and mouse can
  // doodle until an actual pen is observed.
  var pen = AnnotationModel.isIPad(navigator);
  var stylus = false;        // the stroke in hand has a pressure of its own
  var pointers = false;      // pointer events arrive here, so touches are ignored
  var pointerId = null;      // the contact the last pointerdown was for
  var touching = null;       // identifier of the touch a stroke is being drawn with
  var activePointer = null;  // only this contact may move or finish the live gesture
  var hovers = 0;            // consecutive hovering mouse moves; see hover()
  var sessionStarted = Date.now();
  var erased = MUX === 'viewer' ? {} : readErased();   // slide key -> strokes rubbed out, in the order they went
  var lastRub = null;     // the erase an undo would reverse, so a misfire can be marked as one
  var diagnostics = [];      // bounded, session-only input trace; exported with ink
  var W, H, slides, surface, panel, picker, toggle, guide, rulesPath, selectionLayer, selectionBox, saveTimer;
  var storageFull = false;   // the last save hit the origin's quota

  /* ------------------------------ stroke maths --------------------------- */

  // perfect-freehand returns the stroke's outline as a polygon; draw it as a
  // path of quadratic curves through the midpoints, which rounds the corners.
  // A coordinate is written to the nearest tenth of a page unit, which on the
  // stage's 3744-unit page is a fraction of a device pixel. Left alone these
  // come out of perfect-freehand as full doubles, and a page of handwriting is
  // then a megabyte of digits nobody can see -- which the overview, holding a
  // copy of every page at once, pays for all at once.
  function round(n) { return Math.round(n * 10) / 10; }

  function pathData(stroke, unfinished) {
    var o = TOOLS[stroke.t];
    if (stroke.s && o.simulated) o = o.simulated;
    var pts = getStroke(stroke.p, {
      size: stroke.w * (o.share || 1),
      thinning: o.thinning, smoothing: o.smoothing,
      streamline: o.streamline, easing: o.easing,
      simulatePressure: stroke.s, last: !unfinished
    });
    if (!pts.length) return '';
    var d = ['M', round(pts[0][0]), round(pts[0][1]), 'Q'];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      d.push(round(a[0]), round(a[1]), round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2));
    }
    return d.join(' ') + ' Z';
  }

  function pathFor(stroke, unfinished) {
    var el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('fill', stroke.c);
    el.setAttribute('d', pathData(stroke, unfinished));
    return el;
  }

  // A stroke in progress is redrawn every frame, and pathData() builds its
  // outline from all of its points: the longer the line, the more it costs to
  // add anything to it, and by the time one crosses the page the frame is spent
  // rebuilding what has not changed. The garbage that leaves behind — an
  // outline and a path string of tens of kilobytes, sixty times a second — is
  // what makes a long line arrive in pulses: smooth for a second or two, a
  // pause while the collector runs, and again.
  //
  // So the settled part of a stroke is frozen into a path of its own and left
  // alone, and only the tail is rebuilt. Each frozen piece runs OVERLAP points
  // past where the tail picks up, hiding both the blunt end perfect-freehand
  // leaves on an unfinished stroke and the thin start it gives the next one;
  // same colour, same layer, and a layer carries its opacity as a whole, so
  // overlapping pieces do not compound and nothing shows where they meet. When
  // the stroke ends the pieces go and it is drawn once, whole: everything
  // downstream — erasing, undo, saving, the PDF — still sees one stroke.
  var CHUNK = 128;   // points the tail grows to before it is frozen
  var OVERLAP = 16;  // points a frozen piece and the tail have in common

  function part(stroke, from, to) {
    return { t: stroke.t, c: stroke.c, w: stroke.w, s: stroke.s, p: stroke.p.slice(from, to) };
  }

  // `adopt` is the path render() has already put down for this stroke: a
  // render mid-stroke replaces the layer's children, so drawing into a fresh
  // element of our own would leave that one standing beside it.
  function Trail(stroke, layer, adopt) {
    this.stroke = stroke;
    this.layer = layer;
    this.base = 0;        // where the tail starts, in the stroke's points
    this.pieces = [];
    this.faded = false;   // an armed scribble; the pieces still to come fade too
    this.el = adopt || pathFor(stroke, true);
    if (!adopt) layer.appendChild(this.el);
  }

  Trail.prototype.draw = function () {
    if (this.stroke.p.length - this.base > CHUNK + OVERLAP) {
      var cut = this.base + CHUNK;
      var piece = pathFor(part(this.stroke, this.base, cut + OVERLAP), true);
      if (this.faded) piece.classList.add('ink-fading');
      this.layer.insertBefore(piece, this.el);
      this.pieces.push(piece);
      this.base = cut;
    }
    this.el.setAttribute('d', pathData(part(this.stroke, this.base), true));
  };

  // The stroke is finished: one path for the whole of it, tapered end and all,
  // and the pieces that carried it while it was being drawn are taken away.
  Trail.prototype.close = function () {
    this.pieces.forEach(function (el) { el.remove(); });
    this.pieces = [];
    this.el.setAttribute('d', pathData(this.stroke));
  };

  Trail.prototype.fade = function () {
    this.faded = true;
    this.el.classList.add('ink-fading');
    this.pieces.forEach(function (el) { el.classList.add('ink-fading'); });
  };

  function isText(annotation) { return annotation && annotation.t === 'text'; }

  function boxPoints(x, y, width, height) {
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  }

  function itemBox(annotation) {
    return AnnotationGeometry.pointsBounds(annotation && annotation.p || []);
  }

  var measureCanvas, measureContext;
  function measureText(value, size) {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
      measureContext = measureCanvas.getContext('2d');
    }
    measureContext.font = size + 'px system-ui, sans-serif';
    return measureContext.measureText(value).width;
  }

  function textLines(annotation) {
    var box = itemBox(annotation);
    var padding = annotation.f * TEXT.padding;
    var available = Math.max(annotation.f, (box ? box[2] - box[0] : TEXT.width) - 2 * padding);
    var lines = [];
    String(annotation.v || '').split('\n').forEach(function (paragraph) {
      if (!paragraph) { lines.push(''); return; }
      var line = '';
      paragraph.split(/\s+/).forEach(function (word) {
        var candidate = line ? line + ' ' + word : word;
        if (line && measureText(candidate, annotation.f) > available) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      lines.push(line);
    });
    return lines.length ? lines : [''];
  }

  function fitTextBox(annotation) {
    var box = itemBox(annotation);
    var x = box ? box[0] : 0, y = box ? box[1] : 0;
    var width = box ? box[2] - box[0] : TEXT.width;
    var padding = annotation.f * TEXT.padding;
    var height = textLines(annotation).length * annotation.f * TEXT.lineHeight + 2 * padding;
    annotation.p = boxPoints(x, y, width, height);
  }

  function textFor(annotation) {
    var box = itemBox(annotation), padding = annotation.f * TEXT.padding;
    var group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'ink-text-item');
    group.setAttribute('aria-label', annotation.v || 'Text box');
    var text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', box[0] + padding);
    text.setAttribute('y', box[1] + padding + annotation.f);
    text.setAttribute('fill', annotation.c);
    text.setAttribute('font-size', annotation.f);
    text.setAttribute('font-family', 'system-ui, sans-serif');
    textLines(annotation).forEach(function (line, index) {
      var span = document.createElementNS(SVG_NS, 'tspan');
      span.setAttribute('x', box[0] + padding);
      if (index) span.setAttribute('dy', annotation.f * TEXT.lineHeight);
      span.textContent = line || '\u00a0';
      text.appendChild(span);
    });
    group.appendChild(text);
    return group;
  }

  function elementFor(annotation, unfinished) {
    var el = isText(annotation) ? textFor(annotation) : pathFor(annotation, unfinished);
    if (fading.has(annotation)) el.classList.add('ink-fading');
    return el;
  }

  function updateElement(annotation) {
    var old = nodes.get(annotation);
    if (!old) return;
    if (isText(annotation)) {
      var replacement = textFor(annotation);
      old.replaceWith(replacement);
      nodes.set(annotation, replacement);
    } else {
      old.setAttribute('d', pathData(annotation));
    }
  }

  // Distance from (x, y) to the segment a–b: erasing tests segments, not just
  // points, so a fast (and therefore sparsely sampled) stroke is still hit.
  function segDist(x, y, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  }

  function touches(stroke, x, y) {
    if (isText(stroke)) return AnnotationGeometry.insideBounds([x, y], itemBox(stroke), ERASER);
    var r = ERASER + stroke.w / 2, p = stroke.p;
    for (var i = 0; i < p.length; i++) {
      if (segDist(x, y, p[i], p[i + 1] || p[i]) <= r) return true;
    }
    return false;
  }

  function selectedBounds() {
    return AnnotationGeometry.pointsBounds(selected.reduce(function (all, s) {
      return all.concat(s.p);
    }, []));
  }

  // Ramer-Douglas-Peucker: drop the points that are not doing anything, so the
  // scribble tests below compare tens of segments rather than hundreds.
  function simplify(p, tol) {
    if (p.length < 3) return p;
    var a = p[0], b = p[p.length - 1], far = 0, max = -1;
    for (var i = 1; i < p.length - 1; i++) {
      var d = segDist(p[i][0], p[i][1], a, b);
      if (d > max) { max = d; far = i; }
    }
    if (max <= tol) return [a, b];
    return simplify(p.slice(0, far + 1), tol).slice(0, -1).concat(simplify(p.slice(far), tol));
  }

  // Finished strokes never change, so simplify each of them once.
  function thin(stroke) {
    var p = thinned.get(stroke);
    if (!p) thinned.set(stroke, p = simplify(stroke.p, SCRIBBLE.tolerance));
    return p;
  }

  // Padded, so that a perfectly straight stroke — a fraction bar, an axis — has
  // an area to overlap with and can still be scribbled out.
  function bounds(p) {
    var s = SCRIBBLE.slack;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < p.length; i++) {
      x0 = Math.min(x0, p[i][0]); x1 = Math.max(x1, p[i][0]);
      y0 = Math.min(y0, p[i][1]); y1 = Math.max(y1, p[i][1]);
    }
    return [x0 - s, y0 - s, x1 + s, y1 + s];
  }

  // Intersection area as a fraction of the smaller box: a cheap filter that
  // costs nothing, ahead of the crossing count that actually decides.
  function overlap(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    var h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return 0;
    return w * h / Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  }

  // The direction of greatest variance: the first principal component, which
  // for a 2x2 covariance matrix is one line of algebra rather than anything
  // iterative. Third is the spread along it against the spread across it.
  function axis(p) {
    var mx = 0, my = 0, xx = 0, xy = 0, yy = 0, i;
    for (i = 0; i < p.length; i++) { mx += p[i][0]; my += p[i][1]; }
    mx /= p.length; my /= p.length;
    for (i = 0; i < p.length; i++) {
      var dx = p[i][0] - mx, dy = p[i][1] - my;
      xx += dx * dx; xy += dx * dy; yy += dy * dy;
    }
    var a = 0.5 * Math.atan2(2 * xy, xx - yy);
    var mid = (xx + yy) / 2, off = Math.hypot((xx - yy) / 2, xy);
    return [Math.cos(a), Math.sin(a), Math.sqrt((mid + off) / Math.max(mid - off, 1e-9))];
  }

  // How many times a stroke doubles back along its own long axis. Measuring
  // along that axis is what separates a scribble, which sweeps back over
  // itself, from a wave, which keeps going however much it wiggles across it.
  // `travel` is hysteresis: the stroke has to come back a real distance rather
  // than jitter over a turning point.
  function reversals(p) {
    var u = axis(p), n = 0, dir = 0, turn = null;
    for (var i = 0; i < p.length; i++) {
      var at = p[i][0] * u[0] + p[i][1] * u[1];
      if (turn === null) { turn = at; continue; }
      var d = at - turn;
      if (!dir) {
        if (Math.abs(d) >= SCRIBBLE.travel) { dir = d > 0 ? 1 : -1; turn = at; }
      } else if (d * dir > 0) {
        turn = at;  // still going the same way; carry the turning point along
      } else if (Math.abs(d) >= SCRIBBLE.travel) {
        n++; dir = -dir; turn = at;
      }
    }
    return n;
  }

  // How far a stroke got, against how far it went to get there. A scribble
  // sweeps back and forth over one spot and so scores near zero; a letter,
  // however much it doubles back on its way, still ends up somewhere.
  function progress(p) {
    var path = 0;
    for (var i = 1; i < p.length; i++) {
      path += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    }
    if (!path) return 1;
    return Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) / path;
  }

  // Segment-segment crossings between two polylines, up to `limit` — the caller
  // only asks whether there are at least that many, so stop counting there.
  function crossings(a, b, limit) {
    var n = 0;
    for (var i = 1; i < a.length; i++) {
      for (var j = 1; j < b.length; j++) {
        if (crosses(a[i - 1], a[i], b[j - 1], b[j]) && ++n >= limit) return n;
      }
    }
    return n;
  }

  function crosses(a, b, c, d) {
    function side(p, q, r) {
      return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    }
    // Each segment must have the other's endpoints on opposite sides of it.
    return (side(c, d, a) > 0) !== (side(c, d, b) > 0) &&
      (side(a, b, c) > 0) !== (side(a, b, d) > 0);
  }

  /* ------------------------------- the model ----------------------------- */

  function slideKeyFor(slide) {
    return AnnotationModel.slideKey(slide, slide && Reveal.getIndices(slide));
  }

  function slideKey() {
    return slideKeyFor(Reveal.getCurrentSlide());
  }

  function strokes() { return ink[slideKey()] || []; }

  // Call before every change: records the state to come back to, and drops the
  // redo branch we are about to diverge from. Every slide has its own stacks,
  // so a change to another slide's ink says which.
  function snapshot(key) {
    lastRub = null;   // whatever is happening now, it is not undoing that erase
    key = key || slideKey();
    var stack = undos[key] = undos[key] || [];
    stack.push(JSON.stringify(ink[key] || []));
    if (stack.length > UNDO_DEPTH) stack.shift();
    redos[key] = [];
  }

  // Undo and redo are the same move in opposite directions.
  function step(from, to) {
    var key = slideKey();
    if (!from[key] || !from[key].length) return;
    if (from === undos && lastRub && lastRub.key === key) {
      lastRub.records.forEach(function (rec) { rec.x.u = 1; });
      lastRub = null;
    }
    (to[key] = to[key] || []).push(JSON.stringify(ink[key] || []));
    ink[key] = JSON.parse(from[key].pop());
    render();
    save();
    sendAll();
  }

  // This slide, or with Shift the whole deck. A deck-wide clear asks first: it
  // is undoable, but only a slide at a time, so putting it all back is a walk
  // through the deck rather than one ⌘Z.
  function clear(all) {
    var keys = Object.keys(ink).filter(function (k) { return ink[k].length; });
    if (!all) keys = keys.filter(function (k) { return k === slideKey(); });
    if (!keys.length) return;
    if (all && !confirm('Clear the annotations on all ' + keys.length + ' annotated slides?')) return;
    keys.forEach(function (k) { snapshot(k); ink[k] = []; });
    render();
    save();
    sendAll();
  }

  function deletePage() {
    if (!window.AnnotatePages || !AnnotatePages.canRemove()) return;
    if (!confirm('Delete this page and all of its annotations? This cannot be undone.')) return;
    if (activePointer !== null) finishGesture();
    if (editing) finishText(true);
    var key = slideKey();
    delete ink[key];
    delete undos[key];
    delete redos[key];
    save();
    AnnotatePages.removeCurrent();
    sync();
  }

  // Marks rather than deletes: what the eraser has passed over fades, and only
  // goes when the eraser is lifted — the same two steps as the scribble
  // gesture, so a slip can be seen and undone before it costs anything.
  function erase(x, y) {
    strokes().forEach(function (s) {
      if (marked.indexOf(s) !== -1 || !touches(s, x, y)) return;
      if (!marked.length) snapshot();  // one undo entry per drag, not per stroke
      marked.push(s);
      var el = nodes.get(s);
      if (el) el.classList.add('ink-fading');
    });
  }

  function read() {
    try {
      return AnnotationCodec.unpackInk(JSON.parse(localStorage.getItem(STORE)) || {});
    } catch (e) {
      return {};
    }
  }

  // A lecture is not one page load: the deck gets reloaded mid-lecture, and a
  // log that started again each time would miss exactly the misfires worth
  // having. Nothing reads this back into `ink` -- it is only ever exported.
  function readErased() {
    try {
      return AnnotationCodec.unpackInk(JSON.parse(localStorage.getItem(ERASED_STORE)) || {});
    } catch (e) {
      return {};
    }
  }

  function readWidths() {
    var out = {}, saved;
    try { saved = JSON.parse(localStorage.getItem(WIDTH_STORE)); } catch (e) { /* unreadable */ }
    Object.keys(WIDTHS).forEach(function (t) {
      out[t] = saved && saved[t] > 0 ? clampWidth(t, saved[t]) : WIDTHS[t];
    });
    return out;
  }

  // The guides are for the person writing. An audience window is watching, so
  // it starts clean and keeps nothing: the store is shared with the presenting
  // window on the same device, and the projector is not to inherit its choice.
  // R still works there, for that window alone.
  function readRules() {
    var saved;
    if (MUX === 'viewer') return false;
    try { saved = localStorage.getItem(RULE_STORE); } catch (e) { return true; }
    return saved === null ? true : saved === 'true';
  }

  function readRuleSpacing() {
    var saved;
    try { saved = parseFloat(localStorage.getItem(RULE_SPACING_STORE)); } catch (e) { /* blocked */ }
    return isFinite(saved) ? Math.min(RULES.max, Math.max(RULES.min, saved)) : RULES.spacing;
  }

  function readPressure() {
    var saved;
    try { saved = localStorage.getItem(PRESSURE_STORE); } catch (e) { /* blocked */ }
    return saved === null || saved === undefined ? PRESSURE.enabledByDefault : saved === 'true';
  }

  function readDelay() {
    var saved;
    try { saved = parseFloat(localStorage.getItem(DELAY_STORE)); } catch (e) { /* blocked */ }
    return DELAYS.indexOf(saved) >= 0 ? saved : DELAY;
  }

  // The presenter's own windows keep the choice; a viewer is told it and does
  // not write it down, so it goes back to following whoever presents next.
  function stepDelay(longer) {
    var at = DELAYS.indexOf(playDelay);
    playDelay = DELAYS[Math.min(DELAYS.length - 1, Math.max(0, at + (longer ? 1 : -1)))];
    try { localStorage.setItem(DELAY_STORE, playDelay); } catch (e) { /* full or blocked */ }
    send({ a: 'delay', d: playDelay });
    sync();
  }

  function togglePressure() {
    pressureEnabled = !pressureEnabled;
    try { localStorage.setItem(PRESSURE_STORE, pressureEnabled); } catch (e) { /* full or blocked */ }
    sync();
  }

  function toggleRules() {
    ruled = !ruled;
    if (MUX !== 'viewer') {
      try { localStorage.setItem(RULE_STORE, ruled); } catch (e) { /* full or blocked */ }
    }
    renderOverview();
    sync();
  }

  function rulePathData() {
    return AnnotationGeometry.rulePositions(H, ruleSpacing, RULES.margin)
      .map(function (y) { return 'M' + RULES.margin + ' ' + y + 'H' + (W - RULES.margin); })
      .join(' ');
  }

  function drawRules() {
    rulesPath.setAttribute('d', rulePathData());
  }

  function resizeRules(farther) {
    ruleSpacing = Math.min(RULES.max, Math.max(RULES.min,
      ruleSpacing + (farther ? RULES.step : -RULES.step)));
    try { localStorage.setItem(RULE_SPACING_STORE, ruleSpacing); } catch (e) { /* full or blocked */ }
    drawRules();
    renderOverview();
    sync();
  }

  function clampWidth(t, w) {
    return Math.min(WIDTHS[t] * NIB.max, Math.max(WIDTHS[t] * NIB.min, w));
  }

  // One press of − or + changes the preset for the next stroke only. Finished
  // strokes carry their own width, just as they carry colour and pressure.
  function resize(up) {
    var w = widths[tool] * (up ? NIB.step : 1 / NIB.step);
    widths[tool] = clampWidth(tool, Math.round(w * 10) / 10);
    try { localStorage.setItem(WIDTH_STORE, JSON.stringify(widths)); } catch (e) { /* full or blocked */ }
    sync();
  }

  // A full store and a blocked one throw the same way and mean different
  // things: the first stops keeping ink that is still on screen, so it has to
  // be said out loud; the second was never going to keep it, and saying so on
  // every save is noise.
  function isFull(e) {
    return !!e && (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
  }

  function save() {
    if (MUX === 'viewer') return;  // the presenter's ink is not this browser's to keep
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var full = false;
      try {
        localStorage.setItem(STORE, JSON.stringify(AnnotationCodec.packInk(kept())));
        localStorage.setItem(ERASED_STORE, JSON.stringify(AnnotationCodec.packInk(erased)));
      } catch (e) {
        full = isFull(e);
      }
      if (full === storageFull) return;
      storageFull = full;
      sync();
    }, 400);
  }

  function kept() {
    var out = {};
    Object.keys(ink).forEach(function (k) { if (ink[k].length) out[k] = ink[k]; });
    return out;
  }

  function gestureState() {
    return {
      tool: tool, slide: slideKey(), activePointer: activePointer,
      live: !!live, erasing: erasing, lasso: !!lasso, moving: !!moving,
      resizing: !!resizing,
      touching: touching, held: held, penSeen: pen, pointersSeen: pointers
    };
  }

  function trace(type, e, handled, note) {
    var touch = e && e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null;
    var p = touch || e || {};
    var target = e && e.target;
    diagnostics.push({
      ms: Date.now() - sessionStarted,
      type: type,
      handled: !!handled,
      note: note || undefined,
      pointerId: p.pointerId !== undefined ? p.pointerId :
        (p.identifier !== undefined ? 'touch:' + p.identifier : undefined),
      pointerType: p.pointerType || p.touchType || undefined,
      button: p.button,
      buttons: p.buttons,
      pressure: p.pressure !== undefined ? p.pressure : p.force,
      x: isFinite(p.clientX) ? Math.round(p.clientX) : undefined,
      y: isFinite(p.clientY) ? Math.round(p.clientY) : undefined,
      changedTouches: e && e.changedTouches ? e.changedTouches.length : undefined,
      touches: e && e.touches ? e.touches.length : undefined,
      cancelable: e ? !!e.cancelable : undefined,
      target: target ? (target.id || target.className || target.tagName || '').toString().slice(0, 100) : undefined,
      state: gestureState()
    });
    if (diagnostics.length > DIAGNOSTIC_LIMIT) diagnostics.splice(0, diagnostics.length - DIAGNOSTIC_LIMIT);
  }

  window.AnnotateDiagnostics = diagnosticReport;

  function diagnosticReport() {
    return {
      sessionStartedAt: new Date(sessionStarted).toISOString(),
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio },
      state: gestureState(),
      events: diagnostics
    };
  }

  function saveBlob(blob, filename) {
    var href = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    panel.appendChild(a);  // not every browser follows a link that isn't in the page
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
  }

  // localStorage is this browser on this machine: the ink does not follow the
  // deck to another device, and clearing site data takes it. These two put a
  // whole deck's ink in a file and read one back. The ink remains keyed by
  // slide so it lands back where it was drawn. The session input trace stays
  // out of the file: read it from the console as AnnotateDiagnostics().
  function download() {
    var name = (location.pathname.split('/').pop() || 'slides').replace(/\.html?$/, '');
    var payload = {
      format: 'scribble-ink',
      version: AnnotationCodec.VERSION,
      canvas: { width: W, height: H },
      scribble: SCRIBBLE,   // the thresholds these strokes were judged against
      erased: AnnotationCodec.packInk(erased),
      pages: window.AnnotatePages ? AnnotatePages.count() : Reveal.getTotalSlides(),
      pageIds: window.AnnotatePages ? AnnotatePages.ids() : undefined,
      ink: AnnotationCodec.packInk(kept())
    };
    saveBlob(
      new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      name + '-ink.json'
    );
  }

  function upload(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { return; }
      if (!data || data.format !== 'scribble-ink' || data.version !== AnnotationCodec.VERSION ||
          !data.ink || typeof data.ink !== 'object') {
        alert('This annotation file uses an unsupported format.');
        return;
      }
      ink = AnnotationCodec.unpackInk(data.ink);
      if (window.AnnotatePages) {
        if (Array.isArray(data.pageIds)) AnnotatePages.ensureIds(data.pageIds);
        AnnotatePages.ensureForKeys(Object.keys(ink));
        AnnotatePages.ensure(Number(data.pages) || 1);
      }
      undos = {};  // the ink these described is not the ink that is here now
      redos = {};
      clipboard = null;
      render();
      save();
    };
    reader.readAsText(file);
    sendAll();
  }

  /* ---------------------------- ink in the PDF --------------------------- */

  // Include every printable leaf section, including slides reveal deliberately
  // leaves out of its counted-slide list. Fragment animation states remain one
  // page because they live inside the same section.
  function printableSlides() {
    var root = Reveal.getSlidesElement ? Reveal.getSlidesElement() : document.querySelector('.reveal .slides');
    var result = [];
    if (!root) return result;
    Array.prototype.forEach.call(root.children, function (horizontal) {
      if (horizontal.tagName !== 'SECTION' || horizontal.dataset.visibility === 'hidden') return;
      var verticals = Array.prototype.filter.call(horizontal.children, function (child) {
        return child.tagName === 'SECTION' && child.dataset.visibility !== 'hidden';
      });
      if (verticals.length) result = result.concat(verticals);
      else result.push(horizontal);
    });
    return result;
  }

  // Scribble's pages have no authored slide content, so they can be emitted
  // directly as compact vector PDF pages. This bypasses the operating system's
  // print-paper choices entirely — notably iPad Safari's forced A4 page — while
  // retaining the exact deck aspect ratio, ruled guides and pressure-shaped ink.
  // Which PDF strategy this deck wants, and where a published one lives.
  // `generate` draws the pages here from nothing; `overlay` reads a PDF
  // published beside the deck and writes the ink into it, which keeps the
  // deck's own typography rather than redrawing it. `{deck}` is this deck's
  // path with its extension dropped -- the same file the deck's own
  // "Slides (pdf)" link points at -- and any other URL works just as well.
  function pdfOptions() {
    var cfg = window.Reveal && Reveal.getConfig ? Reveal.getConfig() : null;
    var o = (cfg && cfg.annotate) || {};
    return {
      mode: o.pdf === 'overlay' ? 'overlay' : 'generate',
      source: o.pdfSource || '{deck}.pdf'
    };
  }

  function publishedPdfUrl(pattern) {
    // `.slides.html` as one extension, not two: stripping only the last would
    // ask for `<deck>.slides.pdf`, which is not what anything publishes.
    var deck = location.pathname.replace(/\.slides\.html?$|\.html?$/, '');
    return pattern.replace('{deck}', deck);
  }

  // The overlay writes ink onto pages that already exist, so it wants the
  // strokes grouped by the layer they belong on rather than the shape create()
  // draws from. Text boxes are not carried: they are drawn by create(), and the
  // published PDF already has the deck's own typography.
  function overlayPages() {
    return printableSlides().map(function (slide) {
      var list = ink[slideKeyFor(slide)] || [];
      function shaped(t) {
        return list.filter(function (a) { return a.t === t && !isText(a); })
          .map(function (stroke) { return { colour: stroke.c, path: pathData(stroke) }; });
      }
      return { pen: shaped('pen'), highlighter: shaped('highlighter') };
    });
  }

  // Fetch the PDF published beside this deck and append the ink to it. If there
  // is none -- it has not been published yet, or this deck never publishes one
  // -- fall back to drawing the pages here rather than failing outright.
  function overlayPublishedPdf(pages, wanted) {
    var url = publishedPdfUrl(wanted.source);
    var name = deckFileName();
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('No published PDF at ' + url + ' (' + response.status + ').');
      return response.arrayBuffer();
    }).then(function (buffer) {
      var out = AnnotationPdf.overlay(new Uint8Array(buffer), pages, { width: W, height: H });
      saveBlob(new Blob([out], { type: 'application/pdf' }), name + '-annotated.pdf');
    }).catch(function (error) {
      console.warn('Overlaying the published PDF failed; drawing one instead.', error);
      var data = AnnotationPdf.create({
        width: W, height: H, pages: pages,
        rules: ruled ? AnnotationGeometry.rulePositions(H, ruleSpacing, RULES.margin) : [],
        ruleMargin: RULES.margin
      });
      saveBlob(new Blob([data], { type: 'application/pdf' }), name + '.pdf');
    });
  }

  // The deck's own file name, not its title: a title is prose and makes an
  // unwieldy download, and the published PDF beside it is named this way too.
  function deckFileName() {
    var name = (location.pathname.split('/').pop() || 'slides')
      .replace(/\.slides\.html?$|\.html?$/, '');
    return decodeURIComponent(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || 'slides';
  }

  function downloadPdf() {
    if (!window.AnnotationPdf) return printPdf();
    try {
      var pages = printableSlides().map(function (slide) {
        var list = ink[AnnotationModel.slideKey(slide)] || [];
        return {
          strokes: list.filter(function (annotation) { return !isText(annotation); }).map(function (stroke) {
            return { tool: stroke.t, colour: stroke.c, path: pathData(stroke) };
          }),
          text: list.filter(isText).map(function (annotation) {
            var box = itemBox(annotation);
            return {
              x: box[0], y: box[1], fontSize: annotation.f,
              lineHeight: annotation.f * TEXT.lineHeight,
              padding: annotation.f * TEXT.padding,
              colour: annotation.c, lines: textLines(annotation)
            };
          })
        };
      });
      var wanted = pdfOptions();
      if (wanted.mode === 'overlay') return overlayPublishedPdf(overlayPages(), wanted);
      var data = AnnotationPdf.create({
        width: W,
        height: H,
        pages: pages,
        rules: ruled ? AnnotationGeometry.rulePositions(H, ruleSpacing, RULES.margin) : [],
        ruleMargin: RULES.margin
      });
      var name = (document.title || 'Scribble').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || 'Scribble';
      saveBlob(new Blob([data], { type: 'application/pdf' }), name + '.pdf');
    } catch (error) {
      console.error('Direct PDF download failed; opening the print view instead.', error);
      printPdf();
    }
  }

  // Open Reveal's own one-slide-per-page print view. Both windows share the
  // same localStorage origin, so the print window can lay the current ink and
  // ruled-guide preference over the pages without uploading either anywhere.
  function printPdf() {
    var url = new URL(location.href);
    url.hash = '';
    url.search = '?print-pdf&pdfMaxPagesPerSlide=1&ink=1';
    window.open(url.href, '_blank');
  }

  // The print view is built asynchronously after Reveal becomes ready. Wait
  // for its page wrappers whether `pdf-ready` fires before or after this file
  // starts, then add inert SVG layers and open the browser print dialog.
  function printInk() {
    var size = pageSize();
    W = size[0];
    H = size[1];
    view = [-OVERSCAN * W, -OVERSCAN * H, (1 + 2 * OVERSCAN) * W, (1 + 2 * OVERSCAN) * H];
    var finished = false;
    function layOut() {
      if (finished) return true;
      var pages = document.querySelectorAll('.pdf-page');
      if (!pages.length) return false;
      finished = true;
      var annotated = 0;
      pages.forEach(function (page) { if (layPrintPage(page)) annotated += 1; });
      settled().then(function () {
        printBar(annotated, pages.length);
        window.print();
      });
      return true;
    }
    if (!layOut()) {
      Reveal.on('pdf-ready', layOut);
      var checks = setInterval(function () { if (layOut()) clearInterval(checks); }, 50);
      setTimeout(function () { clearInterval(checks); }, 10000);
    }
  }

  // Place rules against the exact slide-sized rectangle, then overscanned ink
  // above them. Explicit section IDs survive Reveal's print DOM reshuffle, so
  // authored, uncounted and replacement slides all retrieve their own ink;
  // fragment animation states intentionally retain their containing slide ID.
  function layPrintPage(page) {
    var slide = page.querySelector('section');
    if (!slide) return false;
    var list = ink[AnnotationModel.slideKey(slide)] || [];
    var pr = page.getBoundingClientRect();
    var sr = slide.getBoundingClientRect();
    var scale = (sr.width / W) || 1;
    var left = (pr.width - W * scale) / 2;
    var top = (pr.height - H * scale) / 2;
    page.style.position = 'relative';

    if (ruled) {
      var rules = document.createElementNS(SVG_NS, 'svg');
      rules.setAttribute('class', 'ink-print ink-print-rules');
      rules.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      rules.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px' +
        ';width:' + (W * scale) + 'px;height:' + (H * scale) + 'px';
      var rulePath = document.createElementNS(SVG_NS, 'path');
      rulePath.setAttribute('d', rulePathData());
      rules.appendChild(rulePath);
      page.appendChild(rules);
    }

    ['highlighter', 'pen'].forEach(function (t) {
      var drawn = list.filter(function (stroke) { return stroke.t === t; });
      if (!drawn.length) return;
      var layer = document.createElementNS(SVG_NS, 'svg');
      layer.setAttribute('class', 'ink-print ink-' + t);
      layer.setAttribute('viewBox', view.join(' '));
      layer.style.cssText = 'position:absolute' +
        ';left:' + (left - OVERSCAN * W * scale) + 'px' +
        ';top:' + (top - OVERSCAN * H * scale) + 'px' +
        ';width:' + (view[2] * scale) + 'px;height:' + (view[3] * scale) + 'px';
      drawn.forEach(function (stroke) { layer.appendChild(pathFor(stroke)); });
      page.appendChild(layer);
    });
    var text = list.filter(isText);
    if (text.length) {
      var textLayer = document.createElementNS(SVG_NS, 'svg');
      textLayer.setAttribute('class', 'ink-print ink-text');
      textLayer.setAttribute('viewBox', view.join(' '));
      textLayer.style.cssText = 'position:absolute' +
        ';left:' + (left - OVERSCAN * W * scale) + 'px' +
        ';top:' + (top - OVERSCAN * H * scale) + 'px' +
        ';width:' + (view[2] * scale) + 'px;height:' + (view[3] * scale) + 'px';
      text.forEach(function (annotation) { textLayer.appendChild(textFor(annotation)); });
      page.appendChild(textLayer);
    }
    return list.length > 0;
  }

  function settled() {
    var fonts = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    var images = Array.prototype.map.call(document.images, function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    });
    return Promise.race([
      Promise.all([fonts].concat(images)),
      new Promise(function (resolve) { setTimeout(resolve, 5000); })
    ]);
  }

  // Keep a small retry strip in the print window in case the dialog is closed
  // or sent to a printer accidentally. CSS excludes the strip from the PDF.
  function printBar(annotated, pages) {
    var el = document.createElement('div');
    el.className = 'ink-print-bar';
    el.innerHTML = '<span></span><button type="button">Print / Save PDF</button>' +
      '<button type="button">Close</button>';
    var message = annotated
      ? annotated + (annotated === 1 ? ' annotated slide' : ' annotated slides')
      : 'No annotations saved for this deck';
    if (ruled) message += ' · ruled guides on ' + pages + (pages === 1 ? ' page' : ' pages');
    el.firstChild.textContent = message + ' — turn on Background graphics';
    var buttons = el.querySelectorAll('button');
    buttons[0].addEventListener('click', function () { window.print(); });
    buttons[1].addEventListener('click', function () { window.close(); });
    document.body.appendChild(el);
  }

  /* ----------------------------- text boxes ----------------------------- */

  function textAt(point) {
    for (var i = strokes().length - 1; i >= 0; i--) {
      var annotation = strokes()[i];
      if (isText(annotation) && AnnotationGeometry.insideBounds(point, itemBox(annotation), 0)) {
        return annotation;
      }
    }
    return null;
  }

  function layoutTextEditor() {
    if (!editing) return;
    var slideRect = slides.getBoundingClientRect();
    var box = itemBox(editing.draft);
    var sx = slideRect.width / W, sy = slideRect.height / H;
    var padding = editing.draft.f * TEXT.padding;
    editing.el.style.left = (slideRect.left + box[0] * sx) + 'px';
    editing.el.style.top = (slideRect.top + box[1] * sy) + 'px';
    editing.el.style.width = Math.max(80, (box[2] - box[0]) * sx) + 'px';
    editing.el.style.height = Math.max(38, (box[3] - box[1]) * sy) + 'px';
    editing.el.style.padding = (padding * sy) + 'px ' + (padding * sx) + 'px';
    editing.el.style.fontSize = (editing.draft.f * sy) + 'px';
    editing.el.style.lineHeight = String(TEXT.lineHeight);
    editing.el.style.color = editing.draft.c;
  }

  function finishText(commit) {
    if (!editing) return;
    var session = editing;
    editing = null;
    window.removeEventListener('resize', layoutTextEditor);
    session.el.remove();
    if (!commit) { sync(); return; }

    var value = session.draft.v;
    var changed = session.target
      ? JSON.stringify(session.target) !== JSON.stringify(session.draft)
      : !!value.trim();
    if (!changed) { sync(); return; }

    snapshot(session.key);
    if (!value.trim()) {
      ink[session.key] = (ink[session.key] || []).filter(function (item) {
        return item !== session.target;
      });
    } else if (session.target) {
      session.target.c = session.draft.c;
      session.target.f = session.draft.f;
      session.target.v = session.draft.v;
      session.target.p = session.draft.p;
    } else {
      (ink[session.key] = ink[session.key] || []).push(session.draft);
    }
    render();
    save();
    sendAll();
  }

  function editText(point) {
    finishText(true);
    var target = textAt(point);
    var draft = target ? JSON.parse(JSON.stringify(target)) : {
      t: 'text', c: colour, f: TEXT.size, v: '',
      p: boxPoints(Math.min(point[0], W - TEXT.width), point[1], TEXT.width, TEXT.size * 1.6)
    };
    fitTextBox(draft);
    var textarea = document.createElement('textarea');
    textarea.className = 'ink-text-editor';
    textarea.value = draft.v;
    textarea.placeholder = 'Type text';
    textarea.setAttribute('aria-label', target ? 'Edit text box' : 'New text box');
    textarea.spellcheck = true;
    document.body.appendChild(textarea);
    editing = { key: slideKey(), target: target, draft: draft, el: textarea };
    layoutTextEditor();
    window.addEventListener('resize', layoutTextEditor);
    textarea.addEventListener('input', function () {
      if (!editing || editing.el !== textarea) return;
      editing.draft.v = textarea.value;
      fitTextBox(editing.draft);
      layoutTextEditor();
    });
    textarea.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finishText(false);
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        finishText(true);
      }
    });
    textarea.addEventListener('blur', function () { finishText(true); });
    try { textarea.focus({ preventScroll: true }); } catch (error) { textarea.focus(); }
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  /* ----------------------------- multiplexing ---------------------------- */

  // A presenter and its viewers are the same page, told apart by the query
  // string (see MUX above) and joined by the multiplex plugin: slide position is
  // the plugin's own business, and it carries our ink alongside it, out as a
  // `send` event on the document and in as a `received` one.
  //
  // A stroke is already a list of points in slide coordinates, so nothing needs
  // translating for a viewer of another size: the model itself travels, and a
  // viewer is this file with its input coming down a wire.

  var strokeId = 0;    // presenter side: names the stroke being drawn
  // More than one short stroke can still be inside the playback delay at once.
  // Keep their clocks and queues separate: a single `incoming` slot made a new
  // start replace the preceding stroke before its queued end reached a frame,
  // leaving that mark absent until a later full-state sync or reload.
  var incoming = {}; // viewer side: stroke id -> { key, stroke, waiting, ... }

  // How long a viewer sits on each packet before drawing it. The wire is quick
  // on average and uneven packet to packet — Wi-Fi hands over bunches rather
  // than a steady stream — so points that left the pen evenly spaced arrive in
  // clumps, and a viewer drawing each one the moment it lands advances the
  // stroke twice in one frame and not at all in the next. Every point is on
  // time and the finished stroke is exact; it is only the going that stutters.
  //
  // Holding them back turns arrival time into something a viewer no longer has
  // to care about: each packet carries how far into the stroke it was drawn,
  // and is drawn again at that offset from a zero fixed once, when the stroke
  // began — at the speed of the pen, pausing where the pen paused.
  //
  // Only the clumps shorter than this are smoothed out; a packet that arrives
  // already past its offset is drawn at once, having missed its turn. So this
  // is the trade in full: a viewer is this far behind the pen on top of the
  // wire, and buys back the unevenness of everything that arrives within it.
  // Twenty milliseconds is barely over one frame — near enough to live, and it
  // leaves anything but the smallest jitter to come through as jitter. How much
  // of the trade is worth making depends on the wire, so the more menu offers a
  // few settings either side of it, zero included: the delay is the viewer's
  // behaviour but the presenter's choice, and travels to viewers like the ink.
  //
  // None of which applies to a window on the same device: nothing is on the
  // wire, so there is no unevenness to smooth out and no reason to be late.
  // Those strokes are drawn as they land, a frame at a time.
  // The settings are DELAYS, up with the other constants.

  // Monotonic where it exists: a stroke's offsets are differences taken on one
  // device, and a clock the OS may step is a poor thing to take them from.
  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  // Whole milliseconds since the stroke in hand began, which is all a viewer
  // needs and all that need go on the wire.
  function since(stroke) { return Math.round(now() - stroke.t0); }

  // Sent by every end but a viewer, signed in or not: the multiplex plugin puts
  // it on the relay only when this device is the presenter, and on a channel the
  // other tabs of this browser can hear always.
  function send(msg) {
    if (MUX === 'viewer') return;
    var e = new CustomEvent('send');
    e.content = msg;
    document.dispatchEvent(e);
  }

  // Everything that is not a stroke in progress — an erase, an undo, a clear,
  // a load from file — is rare enough to state outright rather than describe.
  // It doubles as the answer a viewer gets when it joins, which is a whole
  // lecture's ink: packed, the same way it is written to localStorage, since a
  // point costs about 7 bytes that way against 19.5 as JSON. Round-tripping is
  // exact for anything a pen drew; a stroke that has been moved or resized can
  // land a twentieth of a page unit away, which is the precision localStorage
  // has always given the presenter's own reload.
  function sendAll() {
    send({ a: 'all', ink: AnnotationCodec.packInk(kept()), d: playDelay });
  }

  // Whether this window applies what arrives is the transport's business, not
  // this file's: it is handed the messages meant for it and no others.
  function receive(msg, local) {
    if (!msg) return;
    if (msg.a === 'all') {
      ink = AnnotationCodec.unpackInk(msg.ink || {});
      if (!local && DELAYS.indexOf(msg.d) >= 0) playDelay = msg.d;
      undos = {}; redos = {};  // these describe ink that is no longer here
      incoming = {};           // and neither are the strokes these would extend
      render();
    } else if (msg.a === 'delay') {
      if (!local && DELAYS.indexOf(msg.d) >= 0) { playDelay = msg.d; sync(); }
    } else if (msg.a === 'start') {
      var arrival = incoming[msg.i] = {
        id: msg.i, key: msg.k, stroke: msg.s, tracing: 0,
        waiting: [], origin: now() + playDelay, immediate: !!local
      };
      // The first point waits its turn with the rest, so the stroke starts when
      // it was started rather than when word of it arrived.
      arrival.waiting = [ { p: msg.s.p, d: 0 } ];
      msg.s.p = [];
      (ink[msg.k] = ink[msg.k] || []).push(msg.s);
      play(arrival);
    } else if (msg.a === 'rub') {
      var list = ink[msg.k] || [];
      var doomed = (msg.m || []).map(function (i) { return list[i]; });
      var rubbing = incoming[msg.i];
      if (rubbing) { doomed.push(rubbing.stroke); delete incoming[msg.i]; }
      ink[msg.k] = list.filter(function (s) { return doomed.indexOf(s) === -1; });
      // A stroke can still have points queued against the playback delay. Left
      // alone, the frame that drains them paints it back after this render has
      // taken it away, and it sits there as a ghost until the next full state.
      Object.keys(incoming).forEach(function (id) {
        if (doomed.indexOf(incoming[id].stroke) >= 0) delete incoming[id];
      });
      render();
    } else if (msg.a === 'mark') {
      var here = ink[msg.k] || [];
      msg.m.forEach(function (i) {
        if (!here[i]) return;
        fading.add(here[i]);
        var el = nodes.get(here[i]);
        if (el) el.classList.add('ink-fading');
      });
      var scribbling = incoming[msg.i];
      if (scribbling) {
        fading.add(scribbling.stroke);
        if (scribbling.trail) scribbling.trail.fade();
      }
    } else if (incoming[msg.i]) {
      incoming[msg.i].waiting.push({ p: msg.p, x: msg.x || 0, d: msg.d || 0, last: msg.a === 'end' });
      play(incoming[msg.i]);
    }
  }

  // Draw whatever the delay has now let through — all of it at once, since a
  // packet another has overtaken need never be drawn on its own — and come back
  // next frame for as long as anything is still waiting. A packet already past
  // its offset when it arrives goes straight up: the delay was too short for
  // that one, and there is nothing to gain by making it later still.
  function play(arrival) {
    if (arrival.tracing) return;
    arrival.tracing = requestAnimationFrame(function () {
      arrival.tracing = 0;
      // A full-state sync may have superseded this scheduled frame.
      if (incoming[arrival.id] !== arrival) return;
      var due = arrival.immediate ? Infinity : now() - arrival.origin;
      var drawn = false, last = false;
      while (arrival.waiting.length && arrival.waiting[0].d <= due) {
        var packet = arrival.waiting.shift();
        if (packet.x) arrival.stroke.p.length -= packet.x;
        if (packet.p && packet.p.length) {
          for (var n = 0; n < packet.p.length; n++) arrival.stroke.p.push(packet.p[n]);
        }
        last = last || !!packet.last;
        drawn = true;
      }
      if (drawn) paint(arrival, !last);
      if (last) { delete incoming[arrival.id]; return; }
      if (arrival.waiting.length) play(arrival);
    });
  }

  // Once a frame, and not once a packet: the outline is built from the whole
  // stroke every time, so each packet of a long stroke costs more to draw than
  // the one before it, and they keep coming at the rate the pen is moving
  // whether or not the last one has been drawn. A viewer that drew them all
  // would fall further behind for as long as the pen was down.
  //
  // The path is looked up rather than held onto, because a slide change mid
  // stroke re-renders the layer and makes a different element. Off that slide
  // there is nothing to show yet; the points keep, and render() puts them up.
  function paint(arrival, unfinished) {
    if (arrival.key !== slideKey()) return;
    // Rebuilt rather than kept when the element under it is not the one it
    // made: a slide change mid stroke re-renders the layer, and render() has
    // left a path of its own standing for this stroke.
    var el = nodes.get(arrival.stroke);
    if (!arrival.trail || (el && el !== arrival.trail.el)) {
      arrival.trail = new Trail(arrival.stroke, layers[arrival.stroke.t], el);
      nodes.set(arrival.stroke, arrival.trail.el);
    }
    if (fading.has(arrival.stroke)) arrival.trail.fade();
    if (unfinished) arrival.trail.draw();
    else arrival.trail.close();
  }

  /* ------------------------------- drawing ------------------------------- */

  // Map a pointer event through Reveal's rendered slide rectangle. This stays
  // correct under slide scaling and zoom, while a point in the surrounding
  // letterbox naturally maps outside [0, W] x [0, H]. Do not measure the
  // overscanned SVG: WebKit historically reported its negative offset but not
  // its expanded dimensions, producing coordinates three times too large.
  function at(e) {
    var point = AnnotationGeometry.pointFromRect(
      [e.clientX, e.clientY], slides.getBoundingClientRect(), W, H
    );
    point.push(Math.round(force(e) * 100) / 100);
    return point;
  }

  // Apple Pencil's light-writing range sits well below the middle of its raw
  // scale. Lift it towards perfect-freehand's neutral 0.5 so enabling pressure
  // changes variation rather than making the whole stroke abruptly narrower.
  // With sensitivity off, a stylus stays at 0.5; non-stylus strokes also store
  // 0.5 but ask perfect-freehand to simulate pressure from their speed.
  function force(e) {
    return AnnotationModel.pressureSample(
      stylus, pressureEnabled, e.pressure, PRESSURE.baseline, PRESSURE.scale
    );
  }

  // The test for a device with pressure to give: it says it is a pen, or the
  // pressure it reports is not one of the three fixed numbers a mouse or a
  // finger gives (0, 0.5 while down, or 1). The second half catches an Apple
  // Pencil driving a Mac over Sidecar, which arrives as a mouse.
  function isStylus(e) {
    return e.pointerType === 'pen' ||
      (e.pressure > 0 && e.pressure < 0.5) || (e.pressure > 0.5 && e.pressure < 1);
  }

  // Pointer events are delivered at most once per frame, but the browser keeps
  // the finer samples it coalesced into each one; using them smooths fast strokes.
  function points(e) {
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    return (evs && evs.length ? evs : [e]).map(at);
  }

  function lassoData(p) {
    if (!p.length) return '';
    return 'M' + p.map(function (q) { return q[0] + ' ' + q[1]; }).join('L') + 'Z';
  }

  function showSelection() {
    selectionLayer.replaceChildren();
    selectionBox = null;
    strokes().forEach(function (s) {
      var el = nodes.get(s);
      if (el) el.classList.toggle('ink-selected', selected.indexOf(s) !== -1);
    });
    var box = selectedBounds();
    if (!box) return;
    selectionBox = document.createElementNS(SVG_NS, 'rect');
    selectionBox.setAttribute('x', box[0]);
    selectionBox.setAttribute('y', box[1]);
    selectionBox.setAttribute('width', Math.max(1, box[2] - box[0]));
    selectionBox.setAttribute('height', Math.max(1, box[3] - box[1]));
    selectionBox.setAttribute('class', 'ink-selection-box');
    selectionLayer.appendChild(selectionBox);
    [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
      .forEach(function (corner) {
        var handle = document.createElementNS(SVG_NS, 'circle');
        handle.setAttribute('cx', corner[0]);
        handle.setAttribute('cy', corner[1]);
        handle.setAttribute('r', RESIZE_HANDLE);
        handle.setAttribute('class', 'ink-resize-handle');
        selectionLayer.appendChild(handle);
      });
  }

  function clearSelection() {
    selected = [];
    lasso = null;
    moving = null;
    resizing = null;
    if (selectionLayer) showSelection();
  }

  function copySelection() {
    if (!selected.length) return;
    clipboard = {
      source: slideKey(),
      strokes: AnnotationModel.cloneStrokes(selected),
      pastes: Object.create(null)
    };
    sync();
  }

  function pasteSelection(options) {
    if (!clipboard || !clipboard.strokes.length) return;
    if (activePointer !== null) finishGesture();
    var key = slideKey();
    var previous = clipboard.pastes[key] || 0;
    // On the source slide, offset the first duplicate so it is visibly a copy.
    // On another slide, preserve its exact position; repeated pastes there fan
    // out slightly instead of landing invisibly on top of one another.
    var offset = (previous + (key === clipboard.source ? 1 : 0)) * 18;
    var dx = offset, dy = offset;
    if (options && isFinite(options.top)) {
      var box = AnnotationGeometry.pointsBounds(clipboard.strokes.reduce(function (all, stroke) {
        return all.concat(stroke.p);
      }, []));
      dx = 0;
      dy = box ? options.top - box[1] : 0;
    }
    var copies = AnnotationModel.cloneStrokes(clipboard.strokes, dx, dy);
    clipboard.pastes[key] = previous + 1;
    snapshot(key);
    ink[key] = (ink[key] || []).concat(copies);
    tool = 'select';
    moreOpen = false;
    render();
    selected = copies;
    showSelection();
    sync();
    save();
    sendAll();
  }

  function nextSlide(create) {
    var target = AnnotationModel.nextItem(Reveal.getSlides(), Reveal.getCurrentSlide());
    if (!target && create && window.AnnotatePages) target = AnnotatePages.append();
    return target;
  }

  // The common lecture move as one action: retain a clipboard copy, advance to
  // the next actual reveal section (including an uncounted replacement slide),
  // and place the copied working at the writing margin ready to drag or resize.
  function continueSelection() {
    var target = selected.length && nextSlide(true);
    if (!target) return;
    copySelection();
    var indices = Reveal.getIndices(target);
    var landed = false;
    function land(e) {
      if (landed || (e && e.currentSlide && e.currentSlide !== target)) return;
      if (Reveal.getCurrentSlide() !== target) return;
      landed = true;
      if (Reveal.off) Reveal.off('slidechanged', land);
      requestAnimationFrame(function () { pasteSelection({ top: RULES.margin }); });
    }
    Reveal.on('slidechanged', land);
    Reveal.slide(indices.h, indices.v);
    land();
  }

  function deleteSelection() {
    if (!selected.length) return;
    if (activePointer !== null) finishGesture();
    var gone = selected.slice();
    snapshot();
    ink[slideKey()] = strokes().filter(function (stroke) {
      return gone.indexOf(stroke) === -1;
    });
    render();
    save();
    sendAll();
  }

  // The modifier reveal's zoom plugin magnifies on (ctrl on Linux, otherwise
  // alt), honouring an explicit `zoomKey`; the same one the arrow-key panning
  // in reveal-fixes.html looks for.
  function zoomModifier() {
    var cfg = Reveal.getConfig();
    return ((cfg && cfg.zoomKey) || (/Linux/.test(navigator.platform) ? 'ctrl' : 'alt')) + 'Key';
  }

  // The controls a tap has to be able to reach with a tool in hand: ours, the
  // ones reveal and its plugins put around the slide, and the slide's own.
  //
  // Said by where a thing sits rather than by name. Chrome is whatever lies
  // over the deck without being part of a slide, so a panel another extension
  // appends is reached without annotate having been told it exists. The list of
  // class names this replaced could only name what was there when it was
  // written: slide-stage's slide overview came later, was not on it, and a tap
  // on a preview was taken as ink -- which on an iPad, with no Esc to fall back
  // on, left the grid up with no way out of it at all.
  //
  // `.slides` is the boundary. Everything under it is a slide and is drawn on,
  // a link in the middle of a paragraph included; everything over the deck and
  // outside it is a control. The deck's own frame is neither, and ends the
  // search: reaching one of these means there was nothing over the slide.
  var STRUCTURE = '.reveal, .reveal .backgrounds, .reveal .backgrounds *, ' +
    '[data-deck-stage], .deck-viewport-shell, body, html';
  var SLIDES = '.reveal .slides';

  // The exception inside a slide: its live controls -- the range a sweep is
  // watched on, the button that redraws a sample. These are worked rather than
  // drawn on, and the surface cuts a hole over each of them (see `clipSurface`)
  // so that the contact reaches the control itself. A hole rather than a
  // forwarded event because a native control moves for a trusted event and for
  // nothing else: a synthesised pointer stream leaves a range where it was.
  // The hole is a hole both ways -- what can be dragged cannot be drawn on.
  var PASSTHROUGH = 'input, select, textarea, button, ' +
    '[contenteditable=""], [contenteditable="true"]';

  function inSlide(el) { return !!(el.closest && el.closest(SLIDES)); }

  // Something to be worked rather than drawn on.
  function reachable(el) {
    if (!el || el === surface || !el.closest || !el.matches) return false;
    if (inSlide(el)) return !!el.closest(PASSTHROUGH);
    return !el.matches(STRUCTURE);
  }

  // The topmost such thing under a point, or null. Chrome that stacks *below*
  // the surface -- reveal's arrows above all -- never becomes the target of
  // anything, so the tip has to be looked under rather than the target asked.
  // `elementsFromPoint` skips `pointer-events: none`, so the full-stage
  // `.controls` box is not returned and only its buttons can match.
  function chromeUnder(e) {
    if (!document.elementsFromPoint || e.clientX === undefined) return null;
    var stack = document.elementsFromPoint(e.clientX, e.clientY);
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el === surface || !el.closest || !el.matches) continue;
      if (reachable(el)) return el;
      // The first thing under the tip that is not reachable is the slide, or
      // the frame around it: either way nothing was lying over it.
      if (inSlide(el) || el.matches(STRUCTURE)) return null;
    }
    return null;
  }

  function ours(e) {
    if (!tool) return false;
    // Mid-stroke everything is ours, wherever the tip has wandered to.
    if (live || erasing || lasso || moving || resizing || textMoving || touching !== null) return true;
    var t = e.target;
    if (!t) return false;
    // Chrome that stacks above the surface, and any control the surface has cut
    // a hole over, reach us as themselves.
    if (t !== surface && reachable(t)) return false;
    // Chrome we cover reaches us with the surface as the target, so the check
    // above cannot see it; look under the tip before taking the event.
    if (t === surface && chromeUnder(e)) return false;
    return true;
  }

  function down(e) {
    if (!tool) return;
    if (e.pointerType === 'pen') pen = true;
    // An Alt/Option-click belongs to the zoom plugin. It magnifies off
    // `mousedown` — a separate event we never touch — so standing aside here is
    // all it takes to stop every magnification leaving a dot behind.
    if (e[zoomModifier()]) return;
    // Once a pen has been used, a finger is a palm resting on the slide or a
    // swipe to the next one — never ink. The event is left alone rather than
    // taken, so reveal still gets to read it as a swipe.
    if (pen && e.pointerType === 'touch') return;
    // A Bluetooth mouse's wheel button alternates the two drawing tools. It is
    // deliberately kept out of the pointer stream, so it cannot leave a dot or
    // start the browser's autoscroll behaviour.
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
      tool = tool === 'pen' ? 'highlighter' : 'pen';
      lastTool = tool;
      moreOpen = false;
      sync();
      return;
    }
    // Hold the right button — or the barrel button a stylus reports as one, or
    // the inverted end of a pen, which is button 5 — and it erases for as long
    // as it is held: scribble over what is to go, let go, and the tool that was
    // in hand comes back. Erasing is already two steps (what the drag passes
    // over fades, and goes when the drag ends), so a slip costs nothing.
    var borrowed = e.button === 2 || e.button === 5;
    if (e.button && !borrowed) return;      // middle click, and anything else
    if (borrowed && (live || erasing)) return;  // a stroke is already in progress
    // Ignore secondary touch contacts while a gesture is live. A new pen or
    // mouse down means an earlier stream was interrupted (pointer ids may be
    // reused), so finish the abandoned gesture before beginning this one.
    if (activePointer !== null) {
      if (e.pointerType === 'touch') return;
      finishGesture();
    }
    activePointer = e.pointerId;
    e.preventDefault();
    e.stopPropagation();            // keep reveal from reading the drag as a swipe
    moreOpen = false;
    unhover();                      // nothing to point with while the tip is down
    // A stroke survives the pointer leaving the surface; nothing else in the
    // deck wants the events, so carrying on without capture is no worse.
    try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    if (borrowed) { held = tool; tool = 'eraser'; }
    // Decided once, from the contact that starts the stroke, and held for the
    // rest of it: every point is then read the same way.
    stylus = isStylus(e);
    var p = at(e);
    if (tool === 'text') {
      if (editing) finishText(true);
      var textTarget = textAt(p);
      if (textTarget) {
        textMoving = {
          key: slideKey(), target: textTarget, start: p,
          original: textTarget.p.map(function (q) { return q.slice(); }), moved: false
        };
      } else {
        activePointer = null;
        editText(p);
      }
      sync();
      return;
    }
    if (tool === 'select') {
      var box = selectedBounds();
      var handle = selected.length && AnnotationGeometry.resizeHandle(p, box, RESIZE_HANDLE);
      if (handle) {
        snapshot();
        resizing = {
          anchor: [
            handle.point[0] === box[0] ? box[2] : box[0],
            handle.point[1] === box[1] ? box[3] : box[1]
          ],
          corner: handle.point,
          originals: selected.map(function (s) {
            return s.p.map(function (q) { return q.slice(); });
          }),
          widths: selected.map(function (s) { return s.w; }),
          fonts: selected.map(function (s) { return s.f; })
        };
      } else if (selected.length && AnnotationGeometry.insideBounds(p, box, ERASER)) {
        snapshot();
        moving = {
          start: p,
          originals: selected.map(function (s) { return s.p.map(function (q) { return q.slice(); }); })
        };
      } else {
        clearSelection();
        var el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('class', 'ink-lasso');
        selectionLayer.appendChild(el);
        lasso = { p: [p], el: el };
      }
      sync();
      return;
    }
    if (tool === 'eraser') { erasing = true; marked = []; erase(p[0], p[1]); sync(); return; }
    snapshot();
    var stroke = { t: tool, c: inkColour(), w: widths[tool], s: !stylus, p: [p] };
    (ink[slideKey()] = ink[slideKey()] || []).push(stroke);
    var trail = new Trail(stroke, layers[tool]);
    live = { stroke: stroke, trail: trail, id: ++strokeId, t0: now() };
    nodes.set(stroke, trail.el);
    armed = false;
    marked = [];
    sync();
    // A copy: the points are appended to in place as the stroke is drawn.
    send({ a: 'start', i: live.id, k: slideKey(),
           s: { t: stroke.t, c: stroke.c, w: stroke.w, s: stroke.s, p: [p] } });
  }

  // The crosshair is a mouse's, and it only appears once a mouse has really
  // moved. An Apple Pencil driving a Mac over Sidecar arrives as a mouse that
  // is nowhere at all until the tip touches the glass, and macOS shows the
  // cursor for each of those contacts: a crosshair blinking on and off at the
  // start and end of every stroke. A mouse hovers — a stream of moves with no
  // button held — where a pen contact produces at most a stray one, so two in a
  // row is the difference between them. Pens and fingers never bring it back.
  function hover(e) {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    if (tool === 'text') surface.classList.toggle('ink-text-target', !!textAt(at(e)));
    if (hovers >= 2) return;
    if (++hovers === 2) surface.classList.add('ink-hover');
  }

  function unhover() {
    hovers = 0;
    surface.classList.remove('ink-hover');
    surface.classList.remove('ink-text-target');
  }

  function move(e) {
    if ((live || erasing || lasso || moving || resizing || textMoving) &&
        !AnnotationModel.ownsPointer(activePointer, e.pointerId)) return;
    hover(e);
    if (!live && !erasing && !lasso && !moving && !resizing && !textMoving) return;
    // Reveal navigates on a pointer drag as well as on a touch swipe, and it
    // reads every move, not just the ones that follow a pointerdown it saw. A
    // stroke is not a swipe, so the moves that make it up stop here.
    e.stopPropagation();
    if (erasing) { points(e).forEach(function (p) { erase(p[0], p[1]); }); return; }
    if (lasso) {
      if (!AnnotationModel.appendSamples(lasso.p, points(e)).added) return;
      lasso.el.setAttribute('d', lassoData(lasso.p));
      return;
    }
    if (textMoving) {
      var textHere = at(e);
      var textDx = textHere[0] - textMoving.start[0];
      var textDy = textHere[1] - textMoving.start[1];
      if (!textMoving.moved && Math.hypot(textDx, textDy) < TEXT.dragThreshold) return;
      if (!textMoving.moved) {
        snapshot(textMoving.key);
        textMoving.moved = true;
        sync();
      }
      textMoving.target.p = AnnotationGeometry.translatePoints(
        textMoving.original, textDx, textDy
      );
      updateElement(textMoving.target);
      return;
    }
    if (moving) {
      var here = at(e), dx = here[0] - moving.start[0], dy = here[1] - moving.start[1];
      selected.forEach(function (s, i) {
        s.p = AnnotationGeometry.translatePoints(moving.originals[i], dx, dy);
        if (!isText(s)) thinned.delete(s);
        updateElement(s);
      });
      showSelection();
      return;
    }
    if (resizing) {
      var dragged = at(e);
      var scale = AnnotationGeometry.uniformScale(
        resizing.anchor, resizing.corner, dragged, 0.1);
      selected.forEach(function (s, i) {
        s.p = AnnotationGeometry.scalePoints(resizing.originals[i], resizing.anchor, scale);
        if (isText(s)) s.f = resizing.fonts[i] * scale;
        else s.w = resizing.widths[i] * scale;
        if (!isText(s)) thinned.delete(s);
        updateElement(s);
      });
      showSelection();
      return;
    }
    var added = AnnotationModel.appendSamples(live.stroke.p, points(e));
    if (!added.added && !added.dropped) return;
    live.trail.draw();
    scribble();
    send({ a: 'draw', i: live.id, p: added.kept, x: added.dropped, d: since(live) });
  }

  /* --------------------------- drawing from touch ------------------------ */

  // A second way in, for a browser that hands the surface touch events without
  // ever sending it a pointer event. iPadOS does exactly that — which is why
  // the chalkboard plugin this replaced drew from touches — and an Apple
  // Pencil on an iPad is what this whole tool is for.
  //
  // Only ever one of the two paths runs for a contact. Pointer events for a
  // gesture are dispatched before its touch events, under the touch's own
  // identifier, so a touch whose pointerdown has just been through down() --
  // by id, or because the gesture it began is still in hand -- is left alone.
  // The first pointerdown of the session switches fingers off for good; a
  // stylus stays on, because iPadOS does not always send a pencil's pointer
  // events -- while it is cancelling a palm beside it, for one -- and its
  // touch events are then the only record of the stroke.
  function touchDown(e) {
    if (touching !== null || activePointer !== null) return;
    var t = e.changedTouches[0];
    var stylus = t.touchType === 'stylus';
    if (pointers && (!stylus || t.identifier === pointerId)) return;
    if (stylus) pen = true;
    if (pen && !stylus) return;  // a palm, or a swipe
    touching = t.identifier;
    down(asPointer(e, t));
  }

  function touchMove(e) {
    var t = sameTouch(e);
    if (t) move(asPointer(e, t));
  }

  function touchUp(e) {
    var t = sameTouch(e);
    if (!t) return;
    touching = null;
    up(asPointer(e, t));
  }

  function sameTouch(e) {
    if (touching === null) return null;
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touching) return e.changedTouches[i];
    }
    return null;
  }

  // A Touch dressed as the pointer event the drawing code above expects. The
  // touch event it came from has already been prevented and stopped, so the
  // two methods have nothing left to do; `pointerId` is missing, which is what
  // makes the pointer capture in down() fail harmlessly.
  function asPointer(e, t) {
    return {
      clientX: t.clientX,
      clientY: t.clientY,
      // Apple Pencil reports its pressure as force. A stylus is a pen whether
      // or not a force came with it; where none did, half — what a mouse reads
      // while it is down — gives the stroke an even, middling width rather
      // than the taper a zero would.
      pressure: t.force > 0 ? t.force : 0.5,
      pointerType: t.touchType === 'stylus' ? 'pen' : 'touch',
      pointerId: 'touch:' + t.identifier,
      button: 0,
      buttons: 1,
      altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      preventDefault: function () {},
      stopPropagation: function () {}
    };
  }

  /* ----------------------- swipes reveal never sees ---------------------- */

  // The surface hangs off the stage, and the stage is reveal's parent, so a
  // gesture that lands on the surface never reaches the swipe listeners reveal
  // puts on `.reveal`. A finger the pen has told us not to ink is a page turn:
  // hand reveal its own copy of the contact so touch navigation keeps working
  // with a tool in hand.
  function forwardSwipe(e) {
    // The copy is dispatched on a descendant of the window these handlers
    // capture on, so it comes straight back here. Untagged, each forward
    // forwards itself again until the browser's dispatch depth runs out.
    if (e.inkForwarded || !tool || e.pointerType !== 'touch' || !pen) return;
    if (live || erasing || lasso || moving || resizing || textMoving) return;
    var target = Reveal.getRevealElement();
    if (!target || target.contains(surface)) return;
    var copy = new PointerEvent(e.type, {
      bubbles: true, pointerId: e.pointerId, pointerType: 'touch',
      isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY
    });
    copy.inkForwarded = true;
    target.dispatchEvent(copy);
  }

  // Standing aside is not enough on its own: the surface still has the contact,
  // so the chrome under it never sees a click of its own. Reveal binds its
  // arrows on ['touchstart', 'click'], so give the element the click it would
  // have had -- on release, and only if the tip stayed put, so that a stroke
  // begun over the corner is never mistaken for a tap.
  var chromeTap = null;
  var CHROME_TAP_SLOP = 12;

  function forwardChromeTap(type, e) {
    if (type === 'pointerdown') {
      var el = e.target === surface ? chromeUnder(e) : null;
      chromeTap = el ? { el: el, x: e.clientX, y: e.clientY } : null;
      return;
    }
    if (type !== 'pointerup') return;
    var tap = chromeTap;
    chromeTap = null;
    if (!tap || !tap.el.isConnected) return;
    if (Math.abs(e.clientX - tap.x) > CHROME_TAP_SLOP ||
        Math.abs(e.clientY - tap.y) > CHROME_TAP_SLOP) return;
    if (chromeUnder(e) !== tap.el) return;
    tap.el.click();
  }

  function finishGesture() {
    activePointer = null;
    var drawn = live || erasing || lasso || moving || resizing || textMoving;
    unhover();  // a lifted pen leaves no cursor behind; a mouse moves on
    if (lasso) {
      selected = strokes().filter(function (s) {
        return AnnotationGeometry.polygonContainsPoints(lasso.p, s.p);
      });
      lasso = null;
      showSelection();
      sync();
    } else if (moving) {
      moving = null;
      showSelection();
      save();
      sendAll();
    } else if (resizing) {
      resizing = null;
      showSelection();
      save();
      sendAll();
    } else if (textMoving) {
      var textSession = textMoving;
      textMoving = null;
      if (textSession.moved) { save(); sendAll(); }
      else editText(textSession.start);
      sync();
    } else if (erasing) {
      erasing = false;
      if (marked.length) rub();
    } else if (live) {
      if (marked.length) {
        rub();
      } else {
        live.trail.close();  // one path for the whole stroke, tapered end and all
        send({ a: 'end', i: live.id, d: since(live) });
        live = null;
        save();
      }
    }
    // Whatever the eraser was borrowed from is picked back up on release.
    if (held) { tool = held; held = null; sync(); }
  }

  function up(e) {
    if (!AnnotationModel.ownsPointer(activePointer, e.pointerId)) return;
    var drawn = live || erasing || lasso || moving || resizing || textMoving;
    if (drawn) e.stopPropagation();
    finishGesture();
  }

  /* ---------------------------- scribble to erase ------------------------- */

  // Run on every frame of a stroke rather than only at the end, so the moment
  // it starts to qualify you can see it: the ink it would take fades the way
  // the eraser fades what it is about to rub out, the scribble fades with it
  // (it is about to go too), and the eraser lights up on the panel.
  //
  // The state latches. Once the gesture has been recognised the pen does not
  // become a pen again halfway through, and strokes already marked are not
  // given back — scribble on across more ink and it joins them. What faded is
  // what goes.
  function scribble() {
    var fresh = [];
    scribbleTargets(live.stroke).forEach(function (s) {
      if (marked.indexOf(s) !== -1) return;
      marked.push(s);
      fresh.push(strokes().indexOf(s));
      var el = nodes.get(s);
      if (el) el.classList.add('ink-fading');
    });
    if (!marked.length) return;
    // A viewer is drawing the same stroke from the same points, in the same
    // order, so the ink it is about to lose can be named by position. Without
    // this the ink simply vanishes there while the presenter has watched it
    // fade for a second first.
    if (fresh.length) send({ a: 'mark', i: live.id, k: slideKey(), m: fresh });
    if (armed) return;
    armed = true;
    live.trail.fade();
    sync();
  }

  // Cheapest test first, and it is the one that rejects nearly everything: the
  // reversal count looks only at the stroke being drawn, so ordinary
  // handwriting — every letter, every symbol — stops there.
  function scribbleTargets(stroke) {
    var p = simplify(stroke.p, SCRIBBLE.tolerance);
    if (p.length < 3 || reversals(p) < SCRIBBLE.reversals) return [];
    if (progress(p) > SCRIBBLE.progress) return [];
    var box = bounds(p), u = axis(p);
    // Filling in an arrowhead or a point on a plot is a small scribble.
    var d = SCRIBBLE.slack * 2;
    if (Math.hypot(box[2] - box[0] - d, box[3] - box[1] - d) < SCRIBBLE.size) return [];
    return strokes().filter(function (s) {
      // Only ink of the same colour drawn with the same tool: highlighting over
      // pen ink, or annotating a diagram in a second colour, is not erasing it.
      if (s === stroke || s.t !== stroke.t || s.c !== stroke.c) return false;
      if (overlap(box, bounds(s.p)) < SCRIBBLE.overlap) return false;
      // Going back and forth along a line thickens it: an underline gone over
      // again. Erasing one scribbles across it.
      var v = axis(thin(s));
      if (v[2] >= SCRIBBLE.elongated &&
          Math.abs(u[0] * v[0] + u[1] * v[1]) > Math.cos(SCRIBBLE.aligned * Math.PI / 180)) return false;
      // Counted against this stroke alone. A stroke that crosses ten strokes
      // once each has scribbled over none of them.
      return crossings(p, thin(s), SCRIBBLE.crossings) >= SCRIBBLE.crossings;
    });
  }

  // Takes away everything currently marked — by a scribble, or by an eraser
  // drag. The snapshot taken when the gesture began is already the state to
  // come back to, so an eraser drag deletes without taking another: one undo
  // puts everything back at once.
  //
  // A scribble takes a second one first, of the slide as it stands now: the
  // gesture stroke present as ordinary ink and nothing erased yet. That state
  // is never drawn, but it is the one a misfire wants — the letter whose last
  // stroke was read as a scribble comes back whole, and a second undo then
  // reaches the pre-gesture state an eraser drag reaches in one.
  function rub() {
    var key = slideKey(), here = strokes();
    var gone = live ? marked.concat([live.stroke]) : marked;
    if (live) {
      var stack = undos[key] = undos[key] || [];
      stack.push(JSON.stringify(here));
      if (stack.length > UNDO_DEPTH) stack.shift();
    }
    // A viewer holds the same strokes in the same order, so what goes can be
    // named by position rather than by restating the deck -- the same way the
    // scribble's `mark` names what it is about to take. The scribble stroke
    // itself is still on its way there, so it goes by the id it arrived under.
    var m = marked.map(function (s) { return here.indexOf(s); })
      .filter(function (i) { return i >= 0; });
    var scribbled = live ? live.id : null;
    // `u` is filled in by the undo below. A scribble that is undone straight
    // away is a false positive, stated as one by the person who saw it happen.
    var log = erased[key] = erased[key] || [];
    lastRub = { key: key, records: gone.map(function (s) {
      var rec = {}, name;
      for (name in s) rec[name] = s[name];
      rec.x = {
        g: live ? 'scribble' : 'eraser',
        r: live && s === live.stroke ? 'gesture' : 'target',
        t: Date.now() - sessionStarted,
        u: 0
      };
      log.push(rec);
      return rec;
    }) };
    ink[key] = here.filter(function (s) { return gone.indexOf(s) === -1; });
    armed = false;
    marked = [];
    render();  // takes the faded paths away along with the strokes they showed
    save();
    send({ a: 'rub', k: key, m: m, i: scribbled });
  }

  /* ---------------------------------- UI --------------------------------- */

  var ICONS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    pen: '<path d="M4 20l3.6-1L19.3 7.3a1.8 1.8 0 0 0 0-2.5l-1.1-1.1a1.8 1.8 0 0 0-2.5 0L4 15.4z"/><path d="M14.9 5.6l2.6 2.6"/>',
    text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
    highlighter: '<path d="M7.7 3.2h8.6v7.4H7.7z"/>' +
      '<path d="M7.7 10.6h8.6l-2.3 4.9h-4z" fill="' + HIGHLIGHT + '"/>' +
      '<path d="M3.4 19.9h17.2" stroke="' + HIGHLIGHT + '" stroke-width="3.6"/>',
    eraser: '<path d="M9.2 18.8l-4-4a1.6 1.6 0 0 1 0-2.3l3.8-3.8 6.3 6.3-3.8 3.8z" fill="' + RUBBER + '"/>' +
      '<path d="M9.2 18.8l-4-4a1.6 1.6 0 0 1 0-2.3l7.6-7.6a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3l-7.6 7.6z"/>' +
      '<path d="M9.6 9.6l6.2 6.2"/><path d="M12.4 18.8h7.6"/>',
    select: '<path d="M5.2 6.4c2.5-3 9.8-3 12.8.2 3.5 3.7.8 9.9-4.7 11.7-5.6 1.8-10.4-1.3-9.1-5.8.8-2.7 4.4-4.2 8.1-3.4" stroke-dasharray="2.5 2.5"/><path d="M16.5 16.5l3.5 3.5"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M16 8V5H5v11h3"/>',
    paste: '<path d="M9 6h6v3H9z"/><path d="M8 7H6v13h12V7h-2"/><path d="M9 13h6M9 17h5"/>',
    continue: '<rect x="3.5" y="5" width="8" height="12" rx="1"/><rect x="13" y="7" width="7.5" height="12" rx="1"/><path d="M8 12h8M13 9l3 3-3 3"/>',
    pressure: '<path d="M4 16c2.2-5.3 4.7-8 7.5-8 3.2 0 5.8 3.3 8.5 10"/><circle cx="11.5" cy="8" r="2.2"/><path d="M4 20h16"/>',
    thinner: '<path d="M5 12h14"/>',
    thicker: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    undo: '<path d="M4.5 9.5h10a4.5 4.5 0 0 1 0 9H9"/><path d="M8 5.5l-4 4 4 4"/>',
    redo: '<path d="M19.5 9.5h-10a4.5 4.5 0 0 0 0 9H15"/><path d="M16 5.5l4 4-4 4"/>',
    clear: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/>',
    'clear-deck': '<path d="M2 7h11"/><path d="M5.8 7V4.5h3.4V7"/><path d="M3.6 7l.8 12.5h6.2L11.4 7"/><path d="M15 7.5h7v5h-7z"/><path d="M15.5 16h6M15.5 19h4"/>',
    'delete-page': '<path d="M5 7h14"/><path d="M9 7V4.5h6V7"/><path d="M7 7l1 12h8l1-12"/><path d="M10 10.5v5M14 10.5v5"/>',
    rules: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pdf: '<path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5z"/><path d="M13 3.5V8.5h5"/><path d="M9 16.5v-4h1.6a1.2 1.2 0 0 1 0 2.4H9"/><path d="M13.5 12.5h2"/>',
    download: '<path d="M12 4v11"/><path d="M8 11.5l4 4 4-4"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 15.5v-11"/><path d="M8 8.5l4-4 4 4"/><path d="M4.5 19.5h15"/>',
    print: '<path d="M7.5 9.5V4.5h9v5"/><path d="M7.5 17.5H5.5A1.5 1.5 0 0 1 4 16v-5A1.5 1.5 0 0 1 5.5 9.5h13A1.5 1.5 0 0 1 20 11v5a1.5 1.5 0 0 1-1.5 1.5h-2"/><path d="M7.5 14h9v5.5h-9z"/>',
    more: '<circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  function button(attr, name, title, iconName) {
    return '<button class="ink-btn" ' + attr + '="' + name + '" title="' + title +
      '" aria-label="' + title + '">' +
      icon(iconName || name) + '</button>';
  }

  function option(attr, name, label, title) {
    return '<button class="ink-option" ' + attr + '="' + name + '" title="' + (title || label) + '">' +
      icon(name) + '<span>' + label + '</span></button>';
  }

  function cycleColour(direction) {
    colour = AnnotationModel.cycleValue(COLOURS.map(function (c) { return c[1]; }), colour, direction);
    sync();
  }

  // A wheel notch chooses the neighbouring colour. Trackpads and Magic Mouse
  // momentum arrive as a burst of wheel events, so rate-limit the burst rather
  // than racing through the whole palette at once. Ctrl-wheel remains the
  // browser's pinch/zoom gesture.
  function wheelColour(e) {
    if (e.ctrlKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    e.stopPropagation();
    var now = Date.now();
    if (now - lastWheel < 220) return;
    lastWheel = now;
    cycleColour(e.deltaY > 0 ? 1 : -1);
  }

  function open(on) {
    if (!on && editing) finishText(true);
    if (tool) lastTool = tool;
    tool = on ? lastTool : null;
    if (!on) moreOpen = false;
    sync();
  }

  // The colour this tool draws in: the swatch's own, except that the first one
  // is a highlighter's yellow while the highlighter is out.
  // The buttons in the bottom-left corner. A projected screen drops them (see
  // annotate.scss), which is right nearly always -- and "nearly" is what C is
  // for: it puts them back on that screen when it is the only one to hand, and
  // takes them away on a presenting screen when the corner is in the way.
  function showChrome(on) {
    chrome = on;
    document.documentElement.classList.toggle('ink-chrome-on', on);
    document.documentElement.classList.toggle('ink-chrome-off', !on);
  }

  function inkColour() {
    return tool === 'highlighter' && colour === COLOURS[0][1] ? HIGHLIGHT : colour;
  }

  // What the ring around a tool is coloured: what that tool would put on the
  // slide if you picked it up now. The pen and highlighter follow the chosen
  // swatch -- the highlighter turning yellow on black, as its own swatch does
  // -- and the eraser wears its rubber. A lasso and a text box lay down no
  // ink, so they fall back to the neutral in the stylesheet.
  function ringColour(name) {
    if (name === 'pen') return colour;
    if (name === 'highlighter') return colour === COLOURS[0][1] ? HIGHLIGHT : colour;
    if (name === 'eraser') return RUBBER;
    return null;
  }

  // Redraw the current slide's ink from scratch. The lists are short (a slide
  // holds tens of strokes at most), so there is nothing to be gained by
  // reconciling them; only the in-progress stroke is updated incrementally.
  function render() {
    clearSelection();
    var elements = { pen: [], highlighter: [], text: [] };
    strokes().forEach(function (s) {
      var el = elementFor(s);
      nodes.set(s, el);
      if (elements[s.t]) elements[s.t].push(el);
    });
    Object.keys(layers).forEach(function (t) {
      layers[t].replaceChildren.apply(layers[t], elements[t]);
    });
    live = null;
    sync();
  }

  function clearOverview() {
    document.querySelectorAll('.ink-overview-layer').forEach(function (el) { el.remove(); });
  }

  // Where the authored page goes while overview is open. A stage publishes the
  // card it maps the page onto; without one the section *is* the page.
  function overviewBox() {
    var stage = document.querySelector('[data-deck-stage]');
    if (!stage) return { left: '0', top: '0', width: '100%', height: '100%' };
    var css = getComputedStyle(stage);
    var edges = ['left', 'top', 'width', 'height'].map(function (edge) {
      return css.getPropertyValue('--deck-overview-card-' + edge).trim();
    });
    if (edges.some(function (value) { return !value; })) {
      return { left: '0', top: '0', width: '100%', height: '100%' };
    }
    return { left: edges[0], top: edges[1], width: edges[2], height: edges[3] };
  }

  // The geometry goes on the element itself, not in the stylesheet. These layers
  // are children of a slide section, and a deck's theme styles those children:
  // slide-stage shrinks them to its overview card, which took the layers out of
  // absolute positioning. In flow they added their own height to the slide, and
  // reveal centres a slide on the content it measures, so the heading was
  // pushed up out of its card and the ink landed nowhere near the page it was
  // drawn on. An inline style is the one thing a stylesheet cannot take back.
  function overviewLayer(slide, className) {
    var el = document.createElementNS(SVG_NS, 'svg');
    var box = overviewBox();
    el.setAttribute('class', 'ink-overview-layer ' + className);
    el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;zoom:1;left:' + box.left + ';top:' + box.top +
      ';width:' + box.width + ';height:' + box.height;
    slide.appendChild(el);
    return el;
  }

  // Overview is a grid of the actual slide sections. Put a small, inert copy
  // of each slide's own ink inside its section so reveal's overview transform
  // scales it along with the page. The live layers stay hidden there because
  // they represent only one slide and would otherwise float over the grid.
  // A cell in the grid is a few hundred pixels wide, so the copy in it is
  // drawn from a stroke thinned to what that cell can show. A page of
  // handwriting is megabytes of outline at full detail, and the grid holds one
  // copy of every page at once: an iPad runs out of memory over it.
  var PREVIEW_TOLERANCE = 300;   // page widths per unit of simplification

  function preview(stroke) {
    var p = overviewPoints.get(stroke);
    if (!p) overviewPoints.set(stroke, p = simplify(stroke.p, W / PREVIEW_TOLERANCE));
    return { t: stroke.t, c: stroke.c, w: stroke.w, s: stroke.s, p: p };
  }

  function renderOverview() {
    clearOverview();
    if (!window.Reveal || !Reveal.isOverview || !Reveal.isOverview()) return;
    Reveal.getSlides().forEach(function (slide) {
      var list = ink[slideKeyFor(slide)] || [];
      if (ruled) {
        var guideLayer = overviewLayer(slide, 'ink-overview-rules');
        var guidePath = document.createElementNS(SVG_NS, 'path');
        guidePath.setAttribute('d', rulePathData());
        guideLayer.appendChild(guidePath);
      }
      ['highlighter', 'pen'].forEach(function (t) {
        var drawn = list.filter(function (stroke) { return stroke.t === t; });
        if (!drawn.length) return;
        var layer = overviewLayer(slide, 'ink-overview-' + t);
        drawn.forEach(function (stroke) { layer.appendChild(pathFor(preview(stroke))); });
      });
      var text = list.filter(isText);
      if (text.length) {
        var textLayer = overviewLayer(slide, 'ink-overview-text');
        text.forEach(function (annotation) { textLayer.appendChild(textFor(annotation)); });
      }
    });
  }

  // Reveal's own controls: the arrows, and whatever a plugin puts beside them.
  // They sit inside `.reveal` and outside `.slides`, under the surface rather
  // than over it, so they need holes cut for them the way a slide's own
  // controls do -- and for a sharper reason. Reveal binds them on
  // `['touchstart', 'click']`, and on a touch device on `['touchstart']` alone:
  // the click listener is not merely a second way in, it is gone. Handing such
  // an arrow a click reaches nothing at all, which is why the arrows worked in
  // every desktop browser and were drawn on by a pencil on the iPad.
  //
  // Leaf controls only. `.controls` is a box the size of the stage and a hole
  // that shape would be the whole slide.
  var REVEAL_CHROME = 'button, a[href], [role="button"]';

  function revealChrome() {
    var root = window.Reveal && Reveal.getRevealElement && Reveal.getRevealElement();
    if (!root) return [];
    return [].filter.call(root.querySelectorAll(REVEAL_CHROME), function (el) {
      return !el.closest(SLIDES);
    });
  }

  // Worth a hole only if a contact would reach it: reveal leaves the arrow it
  // cannot navigate to in place and takes its pointer events away, and a
  // control on an unrevealed fragment has no box yet. A hole over either is a
  // hole in the slide where nothing can be drawn and nothing can be pressed.
  function takesAContact(el) {
    var style = getComputedStyle(el);
    if (style.pointerEvents === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) < 0.1) return false;
    var r = el.getBoundingClientRect();
    return !!(r.width && r.height);
  }

  // Holes that overlap have to become one hole before they are drawn.
  //
  // `evenodd` counts crossings, so a point inside two holes is inside an even
  // number of them and the surface closes over it again -- solid again exactly
  // where two controls meet, which is the corner reveal stacks its arrows and
  // its slide number in. `nonzero` with the holes wound the other way cancels
  // in the same way. Overlapping boxes are therefore merged into the box that
  // contains them, repeatedly, until none of them touch: a little more than was
  // asked for at a corner where both neighbours are controls anyway.
  function merged(rects) {
    var out = rects.slice();
    for (var again = true; again; ) {
      again = false;
      for (var i = 0; i < out.length && !again; i++) {
        for (var j = i + 1; j < out.length; j++) {
          var a = out[i], b = out[j];
          if (a.x > b.x2 || b.x > a.x2 || a.y > b.y2 || b.y > a.y2) continue;
          out[i] = {
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2)
          };
          out.splice(j, 1);
          again = true;
          break;
        }
      }
    }
    return out;
  }

  // Cut a hole in the input surface over every live control on the slide, so
  // that a pencil reaches the control rather than this.
  //
  // Standing aside in `ours()` is not enough for these the way it is for a
  // button: a forwarded click drives a JavaScript listener, which is all
  // reveal's arrows are, but a range or a checkbox is moved by the browser's
  // own default action and that runs on trusted events only. The contact has to
  // land on the control, which means the surface must not be what is under the
  // tip -- and hit testing, unlike anything `ours()` can decide after the fact,
  // is settled before the event exists. So the surface is given the shape it
  // needs in advance.
  //
  // `clip-path` coordinates are the element's own, before the stage's fit
  // transform; `getBoundingClientRect` reports after it. Hence the scale.
  function clipSurface() {
    if (!surface) return;
    var slide = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    var holes = tool && slide ? [].slice.call(slide.querySelectorAll(PASSTHROUGH)) : [];
    if (tool) holes = holes.concat(revealChrome());
    holes = holes.filter(takesAContact);
    if (!holes.length) { surface.style.clipPath = ''; return; }

    var box = surface.getBoundingClientRect();
    var w = surface.offsetWidth, h = surface.offsetHeight;
    var scale = w && box.width ? box.width / w : 1;
    if (!w || !h || !scale) { surface.style.clipPath = ''; return; }

    var rects = merged(holes.map(function (el) {
      var r = el.getBoundingClientRect();
      return {
        x: (r.left - box.left) / scale, y: (r.top - box.top) / scale,
        x2: (r.right - box.left) / scale, y2: (r.bottom - box.top) / scale
      };
    }));

    var d = 'M0 0H' + w + 'V' + h + 'H0Z';
    rects.forEach(function (r) {
      d += 'M' + r.x + ' ' + r.y + 'H' + r.x2 + 'V' + r.y2 + 'H' + r.x + 'Z';
    });
    surface.style.clipPath = rects.length ? 'path(evenodd, "' + d + '")' : '';
  }

  // Reveal enables and disables its arrows while handling the same
  // `slidechanged` this is hung off, and a fragment moves what it moves after
  // the event rather than during it. Measuring on the frame after settles both,
  // and coalesces the burst of resizes a rotating iPad sends.
  var clipQueued = false;
  function reclip() {
    if (clipQueued) return;
    clipQueued = true;
    requestAnimationFrame(function () { clipQueued = false; clipSurface(); });
  }

  /* ------------------------------ the dock ------------------------------ */

  // The rail can be anywhere on the stage. Where it is is kept as the centre of
  // it, in fractions of the stage, and whether it lies `across` -- along the
  // top or bottom -- or stands up beside a side. It is clamped inside the stage
  // every time it is placed, so pushing it at an edge parks it there.
  var DOCK_MARGIN = 24;  // $ink-dock-margin
  var DOCK_STARTS = {
    right: { x: 1, y: 0.5, across: false },
    left: { x: 0, y: 0.5, across: false },
    top: { x: 0.5, y: 0, across: true },
    bottom: { x: 0.5, y: 1, across: true }
  };
  var dock = DOCK_STARTS.right;

  function readDock(start) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(DOCK_STORE)); } catch (e) { /* unreadable */ }
    if (saved && isFinite(saved.x) && isFinite(saved.y)) {
      return { x: +saved.x, y: +saved.y, across: !!saved.across };
    }
    return DOCK_STARTS[start] || DOCK_STARTS.right;
  }

  function saveDock() {
    try { localStorage.setItem(DOCK_STORE, JSON.stringify(dock)); } catch (e) { /* full or blocked */ }
  }

  function clamp(v, lo, hi) { return hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)); }

  // Sizes are the stage's own, untransformed, which is what `left` and `top`
  // inside it are in. Nothing can be measured while the rail is hidden, so
  // this only does anything while it is out.
  function placePanel() {
    if (!panel.classList.contains('active')) return;
    var box = panel.parentNode, sw = box.offsetWidth, sh = box.offsetHeight;
    panel.style.setProperty('--ink-stage-height', sh + 'px');
    panel.classList.toggle('ink-across', dock.across);
    var w = panel.offsetWidth, h = panel.offsetHeight;
    var cx = clamp(dock.x * sw, DOCK_MARGIN + w / 2, sw - DOCK_MARGIN - w / 2);
    var cy = clamp(dock.y * sh, DOCK_MARGIN + h / 2, sh - DOCK_MARGIN - h / 2);
    dock = { x: cx / sw, y: cy / sh, across: dock.across };
    panel.style.left = (cx - w / 2) + 'px';
    panel.style.top = (cy - h / 2) + 'px';
    // What opens beside the rail opens into the stage, on the side with room.
    panel.dataset.open = dock.across ? (cy > sh / 2 ? 'up' : 'down')
      : (cx > sw / 2 ? 'left' : 'right');
  }

  // The grip takes the pointer for itself and keeps it until it is lifted, so
  // a drag that wanders over the slide is never ink and never reaches a tool.
  // The rail follows the finger, and lies down once the finger is nearer the
  // top or bottom than a side -- measured as a share of the stage, so the
  // middle of a wide stage is not all "side" -- and stands up again the other
  // way. The margin between the two is so that a drag along the diagonal does
  // not flip it back and forth.
  var DOCK_TURN = 0.05;

  function dragPanel(grip) {
    var drag = null;

    function at(e) {
      var box = panel.parentNode, r = box.getBoundingClientRect();
      var k = box.offsetWidth / (r.width || 1);
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k,
               sw: box.offsetWidth, sh: box.offsetHeight };
    }

    // Where the grip's middle is, from the rail's middle, as it is laid out now.
    function gripOffset() {
      return {
        x: grip.offsetLeft + grip.offsetWidth / 2 - panel.offsetWidth / 2,
        y: grip.offsetTop + grip.offsetHeight / 2 - panel.offsetHeight / 2
      };
    }

    grip.addEventListener('pointerdown', function (e) {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      var p = at(e);
      drag = { id: e.pointerId, dx: p.x - dock.x * p.sw, dy: p.y - dock.y * p.sh };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      panel.classList.add('ink-dragging');
    });

    grip.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      e.stopPropagation();
      var p = at(e);
      var side = Math.min(p.x, p.sw - p.x) / p.sw;
      var end = Math.min(p.y, p.sh - p.y) / p.sh;
      var across = dock.across ? end < side + DOCK_TURN : end < side - DOCK_TURN;
      if (across !== dock.across) {
        // Turn it about the finger: the grip comes round to the finger's end.
        dock = { x: dock.x, y: dock.y, across: across };
        placePanel();
        var g = gripOffset();
        drag.dx = g.x;
        drag.dy = g.y;
      }
      dock = { x: (p.x - drag.dx) / p.sw, y: (p.y - drag.dy) / p.sh, across: dock.across };
      placePanel();
    });

    function drop(e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
      drag = null;
      panel.classList.remove('ink-dragging');
      saveDock();
    }
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
    grip.addEventListener('lostpointercapture', drop);

    // A touch on the grip is only ever a drag: see the panel's own touchmove
    // in build() for why the browser is refused it.
    grip.addEventListener('touchstart', function (e) {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  function sync() {
    var key = slideKey(), on = !!tool;
    panel.classList.toggle('active', on);
    placePanel();
    surface.classList.toggle('drawing', on);
    // Now, so the holes are there for a tip already on its way down, and again
    // on the next frame: reveal marks an arrow usable in its own time, and a
    // hole measured a moment too early is one the arrow never gets.
    clipSurface();
    reclip();
    surface.classList.toggle('ink-text-mode', tool === 'text');
    surface.classList.toggle('ink-text-dragging', !!textMoving && textMoving.moved);
    if (tool !== 'text') surface.classList.remove('ink-text-target');
    guide.classList.toggle('ink-rules-hidden', !ruled);
    selectionLayer.classList.toggle('ink-hidden', tool !== 'select');
    // A recognised scribble lights the eraser, but only on the panel: the tool
    // itself has to stay the pen, or the stroke being drawn would be cut off.
    var shown = armed ? 'eraser' : tool;
    panel.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === shown);
      var ring = ringColour(b.dataset.tool);
      if (ring) b.style.setProperty('--ink-ring', ring);
      else b.style.removeProperty('--ink-ring');
    });
    panel.querySelectorAll('[data-colour]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.colour === colour);
    });
    // The first swatch is the one that changes colour with the tool.
    var first = panel.querySelector('[data-colour="' + COLOURS[0][1] + '"]');
    var black = tool !== 'highlighter';
    first.style.color = black ? COLOURS[0][1] : HIGHLIGHT;
    first.title = black ? COLOURS[0][0] : 'Yellow';
    var act = function (name) { return panel.querySelector('[data-act="' + name + '"]'); };
    // The width readout, and the − and + either side of it, belong to the tool
    // in hand; with the eraser out there is nothing for them to step.
    var drawing = !!TOOLS[tool];
    panel.querySelector('.ink-nib text').textContent = drawing ? widths[tool].toFixed(1) : '';
    act('thinner').disabled = !drawing || widths[tool] <= WIDTHS[tool] * NIB.min;
    act('thicker').disabled = !drawing || widths[tool] >= WIDTHS[tool] * NIB.max;
    act('undo').disabled = !(undos[key] || []).length;
    act('redo').disabled = !(redos[key] || []).length;
    act('clear').disabled = !strokes().length;
    act('clear-deck').disabled = !Object.keys(ink).some(function (k) { return ink[k].length; });
    // Only the pad can delete a page; a lecture deck has nothing to delete, so
    // the entry goes rather than sitting there greyed out for good.
    act('delete-page').hidden = !window.AnnotatePages || !AnnotatePages.count();
    act('delete-page').disabled = !window.AnnotatePages || !AnnotatePages.canRemove();
    act('copy').disabled = !selected.length;
    act('paste').disabled = !clipboard || !clipboard.strokes.length;
    act('delete').disabled = !selected.length;
    act('continue').disabled = !selected.length || (!nextSlide() && !window.AnnotatePages);
    act('rules').classList.toggle('active', ruled);
    act('rules-closer').disabled = !ruled || ruleSpacing <= RULES.min;
    act('rules-farther').disabled = !ruled || ruleSpacing >= RULES.max;
    var rulePreview = panel.querySelector('.ink-rule-preview');
    var gap = 4 + (ruleSpacing - RULES.min) / (RULES.max - RULES.min) * 4;
    rulePreview.querySelector('path').setAttribute('d',
      'M8 ' + (11 - gap) + 'H44 M8 11H44 M8 ' + (11 + gap) + 'H44');
    rulePreview.setAttribute('aria-label', 'Rule spacing: ' + ruleSpacing + ' slide units');
    act('pressure').classList.toggle('active', pressureEnabled);
    // A viewer is told the delay rather than choosing it, and shows it greyed.
    var mine = MUX !== 'viewer';
    panel.querySelector('.ink-delay text').textContent = playDelay + ' ms';
    act('delay-less').disabled = !mine || playDelay <= DELAYS[0];
    act('delay-more').disabled = !mine || playDelay >= DELAYS[DELAYS.length - 1];
    act('more').classList.toggle('active', moreOpen);
    act('more').setAttribute('aria-expanded', moreOpen ? 'true' : 'false');
    panel.querySelector('.ink-warning').hidden = !storageFull;
    panel.querySelector('.ink-more').hidden = !moreOpen || !on;
    panel.querySelector('.ink-selection-actions').hidden =
      tool !== 'select' || moreOpen || (!selected.length && !clipboard);
  }

  function build() {
    // One layer per tool: the highlighter's has to sit below the pen's so it can
    // multiply with the slide (see annotate.scss).
    //
    // They go *before* the slides, not after: reveal decides it is at the end of
    // the deck by asking whether the current section has a `nextElementSibling`,
    // so a layer appended after the last one leaves reveal (and decktape, which
    // pages through the deck until the end) believing there is always one more
    // slide to come. Nothing in reveal looks at the first child or at previous
    // siblings, and the layers' `z-index` puts them above the slide content
    // regardless of document order.
    slides = document.querySelector('[data-deck-stage]') ||
      document.querySelector('.reveal .slides');
    guide = document.createElementNS(SVG_NS, 'svg');
    guide.setAttribute('class', 'ink-guide');
    guide.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    rulesPath = document.createElementNS(SVG_NS, 'path');
    drawRules();
    guide.appendChild(rulesPath);
    slides.insertBefore(guide, slides.firstChild);

    selectionLayer = document.createElementNS(SVG_NS, 'svg');
    selectionLayer.setAttribute('class', 'ink-selection-layer');
    selectionLayer.setAttribute('viewBox', view.join(' '));
    slides.insertBefore(selectionLayer, slides.firstChild);

    ['highlighter', 'pen', 'text'].forEach(function (t) {
      var el = document.createElementNS(SVG_NS, 'svg');
      el.setAttribute('class', 'ink-layer ink-' + t);
      el.setAttribute('viewBox', view.join(' '));
      slides.insertBefore(el, slides.firstChild);
      layers[t] = el;
    });

    // The layers paint; a plain box over the deck takes the input. It is a
    // <div> rather than the layers themselves because a touch has to land on
    // one, and it hangs off `.reveal` rather than `.slides` because that is
    // where both of the drawing tools that work with a pencil on an iPad put
    // theirs — the chalkboard plugin's canvas and scribble's. Inside `.slides` it
    // would be under an ancestor with `pointer-events: none` and a `perspective`,
    // which is not somewhere a touch is reliably delivered on iPadOS. Nothing
    // is lost by leaving: `at()` measures the pen layer, and `.slides` covers
    // the whole deck anyway.
    surface = document.createElement('div');
    surface.className = 'ink-surface';
    (document.querySelector('[data-deck-stage]') || Reveal.getRevealElement())
      .appendChild(surface);

    // Every listener hangs off the window, in the capture phase, rather than
    // off the surface: on an iPad the surface is never made the target of
    // anything. Logging the deck there showed a pencil's whole stream —
    // `pointerdown`, `pointermove`, `touchstart [stylus]`, `touchmove` — arrive
    // at the window and not one of them reach an element covering the slide,
    // finger taps included. Which element the browser decides was touched is
    // therefore not something to build on; we take the events where they
    // certainly are, and `ours()` decides what they are for.
    //
    // Capturing on the window also puts us ahead of reveal, whose swipe
    // navigation reads the same pointer events, so a stroke can be kept from
    // it by stopping propagation (down(), move() and up() do).
    var input = {
      pointerdown: function (e) { pointers = true; pointerId = e.pointerId; down(e); forwardSwipe(e); },
      pointermove: function (e) { move(e); forwardSwipe(e); },
      pointerup: function (e) { up(e); forwardSwipe(e); },
      pointercancel: up,
      touchstart: touchDown,
      touchmove: touchMove,
      touchend: touchUp,
      touchcancel: touchUp
    };
    Object.keys(input).forEach(function (type) {
      window.addEventListener(type, function (e) {
        var handled = ours(e);
        if (!handled) { forwardChromeTap(type, e); trace(type, e, false); return; }
        // iPadOS decides for itself what a pencil or a finger on the page
        // means — scroll it, select the text under the tip, start a system
        // gesture — and having decided, it cancels the stream the stroke was
        // being built from. `touch-action: none` is not enough there; the
        // touch events themselves have to be refused, as the scribble deck
        // refuses them on the canvas it hands an Apple Pencil. Non-passive, or
        // the browser is free to ignore the refusal.
        if (type.indexOf('touch') === 0 && e.cancelable) e.preventDefault();
        try { input[type](e); } catch (err) { trace(type, e, true, String(err)); throw err; }
        trace(type, e, true);
      }, { capture: true, passive: false });
    });
    window.addEventListener('blur', function (e) {
      if (activePointer !== null) finishGesture();
      trace('blur', e, true);
    }, true);
    window.addEventListener('lostpointercapture', function (e) {
      var handled = AnnotationModel.ownsPointer(activePointer, e.pointerId);
      if (handled) finishGesture();
      trace('lostpointercapture', e, handled);
    }, true);
    window.addEventListener('error', function (e) {
      trace('error', e, true, e.message || 'window error');
    });
    window.addEventListener('unhandledrejection', function (e) {
      trace('unhandledrejection', e, true, String(e.reason || 'unknown rejection'));
    });
    // With a tool in hand the surface takes the click, and the surface hangs off
    // the stage rather than `.reveal` -- so reveal's zoom plugin, which listens
    // on the reveal element, never hears an Option-click and the deck refuses to
    // magnify until the tool is put down. Hand it the click it is owed. The copy
    // is untrusted, which is also what keeps it from coming back through here.
    window.addEventListener('mousedown', function (e) {
      if (!e.isTrusted || !e[zoomModifier()] || !ours(e)) return;
      Reveal.getRevealElement().dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: e.clientX, clientY: e.clientY,
        altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey
      }));
    }, true);
    // The right button is the eraser here, so it has no menu to bring up — one
    // would land mid-stroke and interrupt the erase it was part of.
    window.addEventListener('contextmenu', function (e) {
      if (ours(e)) e.preventDefault();
    }, true);
    // Suppress the compatibility click that some browsers send after a wheel
    // button press, and turn wheel motion over the slide into colour changes.
    window.addEventListener('auxclick', function (e) {
      if (e.button === 1 && ours(e)) e.preventDefault();
    }, true);
    window.addEventListener('wheel', function (e) {
      if (ours(e)) wheelColour(e);
    }, { capture: true, passive: false });
    // Safari's own pinch and rotate, which have nothing to do on a slide.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
      window.addEventListener(type, function (e) { if (tool) e.preventDefault(); }, true);
    });

    panel = document.createElement('div');
    panel.className = 'ink-panel';
    panel.innerHTML =
      '<div class="ink-grip" role="button" title="Drag to move the tools" ' +
        'aria-label="Drag to move the tools"></div>' +
      COLOURS.map(function (c) {
        return '<button class="ink-swatch" data-colour="' + c[1] + '" style="color:' + c[1] +
          '" title="' + c[0] + '"></button>';
      }).join('') +
      '<hr>' +
      button('data-tool', 'pen', 'Pen') +
      button('data-tool', 'highlighter', 'Highlighter') +
      '<hr>' +
      button('data-tool', 'eraser', 'Eraser (whole strokes; or hold the right button)') +
      '<hr>' +
      button('data-tool', 'select', 'Lasso and move') +
      button('data-tool', 'text', 'Text box') +
      '<hr>' +
      button('data-act', 'undo', 'Undo (⌘Z)') +
      button('data-act', 'redo', 'Redo (⇧⌘Z)') +
      button('data-act', 'more', 'More annotation options') +
      '<div class="ink-selection-actions" role="group" aria-label="Selection actions" hidden>' +
        button('data-act', 'continue', 'Continue on next slide (⌘Enter)') +
        button('data-act', 'copy', 'Copy selection (⌘C)') +
        button('data-act', 'paste', 'Paste copied ink (⌘V)') +
        button('data-act', 'delete', 'Delete selection (Delete)', 'clear') +
      '</div>' +
      '<div class="ink-warning" role="status" hidden>Storage full &mdash; ink is no ' +
        'longer being saved. Export it from the more menu.</div>' +
      '<div class="ink-more" role="group" aria-label="Annotation options" hidden>' +
        '<div class="ink-more-title">Stroke width</div>' +
        '<div class="ink-width-row">' +
          button('data-act', 'thinner', 'Thinner ([)') +
          // The width between them is an SVG so the deck's large body type
          // cannot enlarge it inside this compact control.
          '<svg class="ink-nib" width="52" height="22" viewBox="0 0 52 22" fill="currentColor" ' +
          'opacity="0.65"><title>How wide the tool in hand draws, in slide units</title>' +
          '<text x="26" y="16" text-anchor="middle" font-size="13"></text></svg>' +
          button('data-act', 'thicker', 'Thicker (])') +
        '</div>' +
        '<hr>' +
        option('data-act', 'rules', 'Ruled writing guides', 'Show/hide ruled writing guides (l)') +
        '<div class="ink-more-title ink-rule-title">Rule spacing</div>' +
        '<div class="ink-rule-row">' +
          button('data-act', 'rules-closer', 'Move ruled lines closer together', 'thinner') +
          '<svg class="ink-rule-preview" width="52" height="22" viewBox="0 0 52 22" ' +
          'fill="none" stroke="currentColor" stroke-width="1.5" role="img"><path/></svg>' +
          button('data-act', 'rules-farther', 'Move ruled lines farther apart', 'thicker') +
        '</div>' +
        option('data-act', 'pressure', 'Pencil pressure', 'Apple Pencil pressure changes stroke width') +
        '<div class="ink-more-title ink-rule-title">Replay delay</div>' +
        '<div class="ink-delay-row">' +
          button('data-act', 'delay-less', 'Shorter replay delay for viewers', 'thinner') +
          '<svg class="ink-delay" width="52" height="22" viewBox="0 0 52 22" fill="currentColor" ' +
          'opacity="0.65"><title>How long a viewer holds each packet before drawing it</title>' +
          '<text x="26" y="16" text-anchor="middle" font-size="13"></text></svg>' +
          button('data-act', 'delay-more', 'Longer replay delay for viewers', 'thicker') +
        '</div>' +
        '<hr>' +
        option('data-act', 'clear', 'Clear this slide', 'Clear this slide (⇧ for the whole deck)') +
        option('data-act', 'clear-deck', 'Clear this deck', 'Clear the annotations on every slide') +
        option('data-act', 'delete-page', 'Delete this page') +
        '<hr>' +
        option('data-act', 'pdf', 'Download annotated PDF') +
        option('data-act', 'download', 'Export annotations') +
        option('data-act', 'upload', 'Import annotations') +
      '</div>';

    // The file to load is chosen with an input the panel keeps out of sight;
    // its button clicks it.
    picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.style.display = 'none';
    picker.addEventListener('change', function () {
      if (picker.files[0]) upload(picker.files[0]);
      picker.value = '';  // so the same file can be loaded twice
    });
    panel.appendChild(picker);

    // A deck that opens closed needs a way in. The pad does not: its tools are
    // already in hand, and a button to open them would do nothing.
    if (!toolsOpen) {
      toggle = document.createElement('button');
      toggle.className = 'deck-launcher ink-toggle ink-pen';
      toggle.title = 'Annotate (d)';
      toggle.innerHTML = icon('pen');
      toggle.addEventListener('click', function () { open(!tool); });
    }

    var parent = document.querySelector('[data-deck-stage]') || Reveal.getRevealElement();
    parent.appendChild(panel);
    dragPanel(panel.querySelector('.ink-grip'));
    // `touch-action: none` keeps the browser from scrolling with a finger that
    // moves on the panel, but not from taking a quick one as a fling -- a
    // thumb sliding off a button, or a drag by the grip. The next tap then
    // goes to stopping that fling instead of to the button under it, and the
    // tool it was for is not chosen. Nothing here scrolls, so refuse the move
    // itself, as the ink surface does. Not the touchstart: that would take the
    // click away from every button. Nor the first pixels of a move: an Apple
    // Pencil jitters through a few of them on every tap, and WebKit drops the
    // click of a tap whose moves were refused.
    var railTouch = null;
    panel.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      railTouch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      var t = e.changedTouches[0];
      if (railTouch && Math.abs(t.clientX - railTouch.x) <= CHROME_TAP_SLOP &&
          Math.abs(t.clientY - railTouch.y) <= CHROME_TAP_SLOP) return;
      railTouch = null;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    // The stage owns the corner row and the full-screen button in it; the pen
    // joins that row rather than opening a second one in the same corner.
    if (toggle) {
      var launchers = parent.deckLaunchers;
      if (!launchers) {
        launchers = document.createElement('div');
        launchers.className = 'deck-launchers';
        parent.appendChild(launchers);
      }
      launchers.appendChild(toggle);
    }

    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tool],[data-act],[data-colour]');
      if (!b) return;
      if (b.dataset.colour) {
        colour = b.dataset.colour;
        if (tool === 'eraser') tool = lastTool = 'pen';  // a colour implies drawing
      } else if (b.dataset.tool) {
        if (activePointer !== null) finishGesture();
        if (tool === 'select' && b.dataset.tool !== 'select') clearSelection();
        tool = b.dataset.tool;
        if (tool === 'select') moreOpen = false;
        trace('toolchange', e, true, tool);
      } else if (b.dataset.act === 'close') {
        return open(false);
      } else if (b.dataset.act === 'thinner' || b.dataset.act === 'thicker') {
        resize(b.dataset.act === 'thicker');
      } else if (b.dataset.act === 'undo') {
        step(undos, redos);
      } else if (b.dataset.act === 'redo') {
        step(redos, undos);
      } else if (b.dataset.act === 'continue') {
        continueSelection();
      } else if (b.dataset.act === 'copy') {
        copySelection();
      } else if (b.dataset.act === 'paste') {
        pasteSelection();
      } else if (b.dataset.act === 'delete') {
        deleteSelection();
      } else if (b.dataset.act === 'clear') {
        clear(e.shiftKey);
      } else if (b.dataset.act === 'clear-deck') {
        clear(true);
      } else if (b.dataset.act === 'delete-page') {
        deletePage();
      } else if (b.dataset.act === 'rules') {
        toggleRules();
      } else if (b.dataset.act === 'rules-closer' || b.dataset.act === 'rules-farther') {
        resizeRules(b.dataset.act === 'rules-farther');
      } else if (b.dataset.act === 'delay-less' || b.dataset.act === 'delay-more') {
        stepDelay(b.dataset.act === 'delay-more');
      } else if (b.dataset.act === 'pressure') {
        togglePressure();
      } else if (b.dataset.act === 'more') {
        moreOpen = !moreOpen;
      } else if (b.dataset.act === 'download') {
        download();
      } else if (b.dataset.act === 'pdf') {
        downloadPdf();
      } else if (b.dataset.act === 'upload') {
        picker.click();
      }
      sync();
    });
  }

  /* ------------------------------- start-up ------------------------------ */

  function init() {
    var size = pageSize();
    W = size[0];
    H = size[1];
    view = [-OVERSCAN * W, -OVERSCAN * H, (1 + 2 * OVERSCAN) * W, (1 + 2 * OVERSCAN) * H];
    build();
    render();
    var opts = (Reveal.getConfig && Reveal.getConfig().annotate) || {};
    // Re-read rather than assign: what the deck sets is the default, and both
    // readers prefer a value this browser has already stored.
    if (opts.penWidth > 0) { WIDTHS.pen = opts.penWidth; widths = readWidths(); }
    if (DELAYS.indexOf(opts.delay) >= 0) { DELAY = opts.delay; playDelay = readDelay(); }
    toolsOpen = opts.tools === 'open';
    dock = readDock(opts.dock);
    if (toolsOpen && !tool) open(true);
    showChrome(chrome);

    // Every window shows what the transport hands it. Every window but a viewer
    // is also told when one joins, and answers with the ink drawn before it
    // arrived -- and asks that question itself, now, because the transport
    // asked it while this file was still waiting for reveal, and an answer
    // nothing was listening for is an answer lost.
    document.addEventListener('received', function (e) { receive(e.content, e.local); });
    if (MUX !== 'viewer') document.addEventListener('welcome', sendAll);
    document.dispatchEvent(new CustomEvent('rejoin'));

    Reveal.on('slidechanged', function () {
      if (editing) finishText(true);
      render();
      reclip();
      if (Reveal.isOverview()) renderOverview();
    });
    // The holes are measured from where the controls are, so anything that
    // moves them has to be followed: a fragment that reflows the slide, and the
    // stage being refitted to a resized window or a rotated iPad.
    Reveal.on('fragmentshown', reclip);
    Reveal.on('fragmenthidden', reclip);
    Reveal.on('ready', reclip);
    window.addEventListener('resize', reclip);
    window.addEventListener('orientationchange', reclip);
    // Only a deck without a stage changes size under the rail; the stage is
    // one authored page however the window is.
    window.addEventListener('resize', placePanel);
    // The previews are a grid of slides rather than something to write on, so
    // the tools go away for the duration -- and come back as they were. Opening
    // them on the way out hands a pen to a deck that was closed when it went in,
    // which `o` twice did on every lecture deck, and which the relay passed on
    // to every window following the presenter through the overview.
    var toolsBeforeOverview = false;
    Reveal.on('overviewshown', function () {
      toolsBeforeOverview = !!tool;
      open(false);
      renderOverview();
    });
    Reveal.on('overviewhidden', function () {
      clearOverview();
      open(toolsBeforeOverview);
    });
    // Quarto's support plugin binds R to its scroll view and lets reveal fall
    // into it on a narrow viewport; both break a fixed stage you write on.
    Reveal.removeKeyBinding(82);
    Reveal.configure({ scrollActivationWidth: null });

    Reveal.addKeyBinding(
      { keyCode: 68, key: 'D', description: 'Toggle drawing tools' },
      function () { open(!tool); }
    );
    Reveal.addKeyBinding(
      { keyCode: 82, key: 'R', description: 'Show/hide ruled writing guides' },
      toggleRules
    );
    Reveal.addKeyBinding(
      { keyCode: 67, key: 'C', description: 'Show/hide the corner buttons' },
      function () { showChrome(!chrome); }
    );

    // Capture the annotation shortcuts before reveal sees them.
    document.addEventListener('keydown', function (e) {
      if (!tool) return;
      if (e.key === 'Escape' && moreOpen) {
        moreOpen = false;
        sync();
      } else if (e.key === 'Escape' && selected.length) {
        clearSelection();
        sync();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.shiftKey ? step(redos, undos) : step(undos, redos);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selected.length) {
        copySelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard) {
        pasteSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selected.length && nextSlide()) {
        continueSelection();
      } else if (tool === 'select' && selected.length &&
                 (e.key === 'Delete' || e.key === 'Backspace')) {
        deleteSelection();
      } else if ((e.key === '[' || e.key === ']') && TOOLS[tool]) {
        resize(e.key === ']');
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  // This runs from include-after-body, which may be before reveal has finished
  // initialising; wait for it, as the other fixes in this deck do.
  function ready() {
    if (!window.Reveal || !Reveal.isReady || !Reveal.isReady()) return false;
    if (PRINT) {
      if (PRINT_INK) printInk();
    } else {
      init();
    }
    return true;
  }
  if (!ready()) {
    var iv = setInterval(function () { if (ready()) clearInterval(iv); }, 50);
    setTimeout(function () { clearInterval(iv); }, 10000);
  }
})();
