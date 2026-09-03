const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pageId, pageNumber, normalisePageIds, requiredPageCount, install
} = require('../scribble-pages.js');

test('dynamic pages retain stable, explicitly numbered slide IDs', () => {
  assert.equal(pageId(1), 'scribble-slide-001');
  assert.equal(pageId(61), 'scribble-slide-061');
  assert.equal(pageId(1234), 'scribble-slide-1234');
  assert.equal(pageNumber('scribble-slide-009'), 9);
  assert.equal(pageNumber('unrelated-slide'), 0);
});

test('persisted page IDs retain order and gaps after a deletion', () => {
  assert.deepEqual(
    normalisePageIds(['scribble-slide-001', 'scribble-slide-003', 'scribble-slide-008']),
    ['scribble-slide-001', 'scribble-slide-003', 'scribble-slide-008']
  );
  assert.deepEqual(
    normalisePageIds(['scribble-slide-003', 'scribble-slide-003', 'invalid']),
    ['scribble-slide-003']
  );
});

test('annotation keys restore enough dynamic pages for their highest slide', () => {
  assert.equal(requiredPageCount([]), 1);
  assert.equal(requiredPageCount([
    'scribble-slide-002',
    'scribble-slide-017',
    'generated:4'
  ]), 17);
});

test('deleting a page preserves its gap and a new page gets a fresh stable ID', () => {
  const { win, slides, storage } = fakeWindow();
  const pages = install(win);
  pages.ensure(3);
  win.Reveal.current = slides.children[1];

  assert.equal(pages.removeCurrent(), 'scribble-slide-002');
  assert.deepEqual(pages.ids(), ['scribble-slide-001', 'scribble-slide-003']);
  assert.deepEqual(slides.children.map(section => section.id), [
    'scribble-slide-001', 'scribble-slide-003'
  ]);

  assert.equal(pages.append().id, 'scribble-slide-004');
  assert.deepEqual(pages.ids(), [
    'scribble-slide-001', 'scribble-slide-003', 'scribble-slide-004'
  ]);
  assert.deepEqual(JSON.parse(storage.get('scribble-page-ids-v2:/deck')), pages.ids());
});

function fakeWindow() {
  class Element {
    constructor(tagName, document) {
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = document;
      this.children = [];
      this.id = '';
      this.className = '';
    }
    appendChild(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);
      return child;
    }
    querySelector(selector) {
      if (selector[0] === '#') return this.children.find(child => child.id === selector.slice(1)) || null;
      return null;
    }
    addEventListener() {}
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  const storage = new Map();
  const document = {
    createElement(tag) { return new Element(tag, document); },
    getElementById(id) { return slides.children.find(child => child.id === id) || null; },
    querySelector(selector) {
      if (selector === '.reveal .slides') return slides;
      if (selector === '.reveal') return revealElement;
      return null;
    }
  };
  const slides = new Element('div', document);
  const revealElement = new Element('div', document);
  const first = new Element('section', document);
  first.id = 'scribble-slide-001';
  slides.appendChild(first);

  const win = {
    document,
    location: { pathname: '/deck', hash: '' },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); }
    },
    requestAnimationFrame(callback) { callback(); },
    setTimeout() { return 0; },
    addEventListener() {},
    Reveal: {
      current: first,
      isReady() { return true; },
      sync() {},
      getCurrentSlide() { return this.current; },
      getIndices(section) { return { h: slides.children.indexOf(section), v: 0 }; },
      slide(h) { this.current = slides.children[h]; },
      on() {},
      isOverview() { return false; },
      isLastSlide() { return this.current === slides.children[slides.children.length - 1]; },
      availableFragments() { return {}; }
    }
  };
  return { win, slides, storage };
}
