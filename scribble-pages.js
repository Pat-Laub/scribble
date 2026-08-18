// A reveal.js deck that grows one blank page at a time.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.ScribblePages = api;
    if (root.document) api.install(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  var PREFIX = 'scribble-slide-';
  var MAX_PAGES = 5000;
  var runtime = null;

  function pageId(number) {
    return PREFIX + String(Math.max(1, Math.floor(Number(number) || 1))).padStart(3, '0');
  }

  function pageNumber(value) {
    var match = String(value || '').match(/scribble-slide-(\d+)/);
    return match ? Math.max(1, Math.min(MAX_PAGES, Number(match[1]))) : 0;
  }

  function requiredPageCount(keys) {
    return Array.from(keys || []).reduce(function (count, key) {
      return Math.max(count, pageNumber(key));
    }, 1);
  }

  function install(win) {
    if (runtime) return runtime;
    var doc = win.document;
    var slides = doc.querySelector('.reveal .slides');
    if (!slides) return null;
    var store = 'scribble-page-count-v1:' + win.location.pathname;
    var touchStart = null;

    function existingCount() {
      return Array.prototype.filter.call(slides.children, function (child) {
        return child.tagName === 'SECTION';
      }).length;
    }

    function storedCount() {
      try { return Number(win.localStorage.getItem(store)) || 1; } catch (error) { return 1; }
    }

    function persist(count) {
      try { win.localStorage.setItem(store, String(count)); } catch (error) { /* unavailable */ }
    }

    function makePage(number) {
      var section = doc.createElement('section');
      section.id = pageId(number);
      section.className = 'slide level2 annotation-slide-heading';
      section.appendChild(doc.createElement('h2'));
      slides.appendChild(section);
      return section;
    }

    function pageIndex(section) {
      return Array.prototype.filter.call(slides.children, function (child) {
        return child.tagName === 'SECTION';
      }).indexOf(section);
    }

    function addMenuItem(section, index) {
      var list = doc.querySelector('.slide-menu-panel[data-panel="Slides"] > .slide-menu-items');
      if (!list || list.querySelector('[data-slide-h="' + index + '"]')) return;
      var item = doc.createElement('li');
      item.className = 'slide-menu-item future';
      item.dataset.item = String(index);
      item.dataset.slideH = String(index);
      item.dataset.slideV = '0';
      var title = doc.createElement('span');
      title.className = 'slide-menu-item-title';
      title.textContent = 'Slide ' + (index + 1);
      item.appendChild(title);
      item.addEventListener('click', function () {
        win.Reveal.slide(index, 0);
        var menu = win.Reveal.getPlugin && win.Reveal.getPlugin('menu');
        if (menu && menu.closeMenu) menu.closeMenu();
      });
      list.appendChild(item);
    }

    function refreshMenu() {
      var index = 0;
      Array.prototype.forEach.call(slides.children, function (section) {
        if (section.tagName === 'SECTION') addMenuItem(section, index++);
      });
    }

    function ensure(wanted, sync) {
      wanted = Math.max(1, Math.min(MAX_PAGES, Math.floor(Number(wanted) || 1)));
      var added = [];
      while (existingCount() < wanted) added.push(makePage(existingCount() + 1));
      persist(existingCount());
      if (sync && added.length && win.Reveal && win.Reveal.sync) {
        win.Reveal.sync();
        added.forEach(function (section) {
          addMenuItem(section, pageIndex(section));
        });
      }
      return added.length ? added[added.length - 1] : slides.querySelector('#' + pageId(wanted));
    }

    function append() {
      return ensure(existingCount() + 1, true);
    }

    function atEnd() {
      if (!win.Reveal || !win.Reveal.isReady || !win.Reveal.isReady()) return false;
      if (win.Reveal.isOverview && win.Reveal.isOverview()) return false;
      if (!win.Reveal.isLastSlide || !win.Reveal.isLastSlide()) return false;
      var fragments = win.Reveal.availableFragments && win.Reveal.availableFragments();
      return !(fragments && fragments.next);
    }

    // Reveal normally hides and disables its forward arrow on the final slide.
    // Here that arrow means "make the next page", so keep it available there.
    function refreshForwardControl() {
      var button = doc.querySelector('.controls .navigate-right');
      if (!button || !atEnd()) return;
      button.disabled = false;
      button.classList.add('enabled');
    }

    function prepareForwardPage() {
      if (atEnd()) append();
    }

    function forwardKey(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      var target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n', 'N'].indexOf(event.key) !== -1) {
        prepareForwardPage();
      }
    }

    function forwardControl(event) {
      var target = event.target && event.target.closest &&
        event.target.closest('.navigate-right, .navigate-down');
      if (target) prepareForwardPage();
    }

    function touchDown(event) {
      if (event.touches.length !== 1 || !atEnd()) { touchStart = null; return; }
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    function touchUp(event) {
      if (!touchStart || event.changedTouches.length !== 1) { touchStart = null; return; }
      var dx = event.changedTouches[0].clientX - touchStart.x;
      var dy = event.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      if (dx < -40 && Math.abs(dx) > Math.abs(dy)) prepareForwardPage();
    }

    // Keep the requested id before reveal has a chance to replace an unknown
    // dynamic-slide hash with the first page during its own initialisation.
    var requestedPage = pageNumber(win.__scribbleInitialHash || win.location.hash);
    var wanted = Math.max(existingCount(), storedCount(), requestedPage);
    ensure(wanted, false); // before reveal reads a restored page hash, when possible

    function attach() {
      if (!win.Reveal || !win.Reveal.isReady || !win.Reveal.isReady()) return false;
      win.Reveal.sync();
      var hashPage = requestedPage;
      if (hashPage) {
        var target = doc.getElementById(pageId(hashPage));
        if (target && win.Reveal.getCurrentSlide() !== target) {
          var indices = win.Reveal.getIndices(target);
          win.Reveal.slide(indices.h, indices.v);
        }
      }
      refreshForwardControl();
      refreshMenu();
      // Reveal dispatches slidechanged before its controls plugin performs its
      // final update, so restore the create-page arrow on the following frame.
      win.Reveal.on('slidechanged', function () {
        win.requestAnimationFrame(refreshForwardControl);
      });
      var revealElement = doc.querySelector('.reveal');
      if (revealElement) revealElement.addEventListener('menu-ready', refreshMenu);
      win.setTimeout(refreshMenu, 100);
      win.addEventListener('click', forwardControl, true);
      win.addEventListener('keydown', forwardKey, true);
      win.addEventListener('touchstart', touchDown, { capture: true, passive: true });
      win.addEventListener('touchend', touchUp, { capture: true, passive: true });
      win.addEventListener('touchcancel', function () { touchStart = null; }, true);
      return true;
    }

    if (!attach()) {
      var interval = win.setInterval(function () { if (attach()) win.clearInterval(interval); }, 50);
      win.setTimeout(function () { win.clearInterval(interval); }, 10000);
    }

    runtime = {
      append: append,
      count: existingCount,
      ensure: function (count) { return ensure(count, true); },
      ensureForKeys: function (keys) { return ensure(requiredPageCount(keys), true); }
    };
    return runtime;
  }

  return {
    install: install,
    pageId: pageId,
    pageNumber: pageNumber,
    requiredPageCount: requiredPageCount,
    append: function () { return runtime && runtime.append(); },
    count: function () { return runtime ? runtime.count() : 0; },
    ensure: function (count) { return runtime && runtime.ensure(count); },
    ensureForKeys: function (keys) { return runtime && runtime.ensureForKeys(keys); }
  };
});
