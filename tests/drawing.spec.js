const { test, expect } = require('@playwright/test');
const { openPad, paths, drawStroke } = require('./support/pad');

test('the pad opens ready to draw', async ({ page }) => {
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  await openPad(page);
  await expect(page.locator('.ink-panel')).toBeVisible();
  await expect(page.locator('svg.ink-pen')).toBeAttached();
  expect(failures, failures.join('\n')).toEqual([]);
});

test('a stroke is drawn and survives a reload', async ({ page }) => {
  await openPad(page);
  await drawStroke(page);
  await expect(paths(page)).toHaveCount(1);

  await page.waitForTimeout(600);   // the debounced save
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(paths(page)).toHaveCount(1);
});

test('undo removes the last stroke', async ({ page }) => {
  const { mod } = require('./support/pad');
  await openPad(page);
  await drawStroke(page, [[0.2, 0.4], [0.4, 0.4]]);
  await drawStroke(page, [[0.2, 0.6], [0.4, 0.6]]);
  await expect(paths(page)).toHaveCount(2);
  await page.keyboard.press(`${mod}+z`);
  await expect(paths(page)).toHaveCount(1);
});

// The panel and the corner buttons are children of the stage, which is
// transformed. `position: fixed` inside a transformed ancestor resolves against
// that ancestor, not the viewport, so authored-unit offsets silently put the
// chrome off the bottom of the screen -- and chromium's auto-scrolling click
// still finds it, so only firefox failed and only because a drag followed.
// Assert the geometry directly instead.
test('the tool panel and corner buttons are on screen', async ({ page }) => {
  await openPad(page);
  const boxes = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; };
    return { panel: g('.ink-panel'), launchers: g('.ink-launchers'),
             viewport: { w: window.innerWidth, h: window.innerHeight } };
  });

  for (const [name, box] of [['panel', boxes.panel], ['launchers', boxes.launchers]]) {
    expect(box, `${name} is missing`).not.toBeNull();
    expect(box.w, `${name} has no width`).toBeGreaterThan(0);
    expect(box.h, `${name} has no height`).toBeGreaterThan(0);
    expect(box.left, `${name} is off the left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${name} is off the top edge`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${name} is off the right edge`).toBeLessThanOrEqual(boxes.viewport.w + 1);
    expect(box.bottom, `${name} is off the bottom edge`).toBeLessThanOrEqual(boxes.viewport.h + 1);
  }
});
