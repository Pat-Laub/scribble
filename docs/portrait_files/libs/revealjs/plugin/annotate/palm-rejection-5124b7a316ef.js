// Keep reveal.js from confusing two separate palm contacts for one swipe.
//
// Reveal converts every touch pointer into a one-item `touches` array and does
// not retain the pointer id. A second contact can therefore replace the start
// point of the first, after which movement from either contact looks like a
// large swipe. This capture-phase guard lets genuine one-finger gestures pass
// through unchanged, but quarantines a gesture as soon as it has two contacts.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RevealPalmRejection = api;
    api.attach(root);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  // iPadOS does not always report that a contact lifted: a system gesture can
  // claim it, or the app can suspend mid-touch. Such a contact goes quiet, so
  // treat one that has produced no events for this long as gone.
  var STALE_MS = 3000;

  function createGuard(now) {
    var clock = now || Date.now;
    var active = new Map();
    var rejected = false;

    return function block(type, e) {
      if (e.pointerType !== 'touch') return false;
      var at = clock();

      if (type === 'pointerdown') {
        active.forEach(function (seen, id) {
          if (at - seen > STALE_MS) active.delete(id);
        });
        if (!active.size) rejected = false;
        active.set(e.pointerId, at);
        if (active.size > 1) rejected = true;
      } else if (active.has(e.pointerId)) {
        active.set(e.pointerId, at);
      }

      var blocked = rejected && active.has(e.pointerId);

      if (type === 'pointerup' || type === 'pointercancel') {
        active.delete(e.pointerId);
        if (!active.size) rejected = false;
      }

      return blocked;
    };
  }

  function attach(target) {
    if (!target || !target.addEventListener) return;
    var block = createGuard();
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (type) {
      target.addEventListener(type, function (e) {
        if (!block(type, e)) return;
        if (e.cancelable) e.preventDefault();
        // Capture on window keeps the event from reaching reveal's listener on
        // `.reveal`. Other capture listeners on window may still clean up.
        e.stopPropagation();
      }, { capture: true, passive: false });
    });
  }

  return { createGuard: createGuard, attach: attach };
});
