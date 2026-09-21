const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, drag, drawStroke } = require('./support/pad');

// Lassoing a stroke should select it: the selection box appears and the stroke
// is marked. A loop drawn well clear of the ink is what the presenter draws.
test('a lasso around a stroke selects it', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.40, 0.48], [0.50, 0.52], [0.60, 0.48]]);
  await expect(paths(page)).toHaveCount(1);

  await tool(page, 'select').click();
  await drag(page, [[0.30, 0.35], [0.70, 0.35], [0.70, 0.65], [0.30, 0.65], [0.30, 0.35]]);

  await expect(page.locator('.ink-selection-box')).toBeAttached();
  await expect(page.locator('svg.ink-pen path.ink-selected')).toHaveCount(1);
});

// The pad is used on an iPad: the lasso is drawn with a finger or a Pencil,
// which is also what reveal's swipe navigation listens for.
test('a touch lasso selects rather than turning the page', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: false });
  const page = await ctx.newPage();
  await openPad(page);
  await drawStroke(page, [[0.40, 0.48], [0.50, 0.52], [0.60, 0.48]]);
  await expect(paths(page)).toHaveCount(1);

  await tool(page, 'select').click();
  const box = await page.locator('.ink-surface').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  const loop = [[0.30, 0.35], [0.70, 0.35], [0.70, 0.65], [0.30, 0.65], [0.30, 0.35]];
  await page.evaluate(async (pts) => {
    const el = document.querySelector('.ink-surface');
    const send = (type, [x, y]) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true,
      cancelable: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1
    }));
    send('pointerdown', pts[0]);
    for (const p of pts.slice(1)) { send('pointermove', p); await new Promise(r => setTimeout(r, 10)); }
    send('pointerup', pts[pts.length - 1]);
  }, loop.map(at));

  await expect(page.locator('.ink-selection-box')).toBeAttached();
  await expect(page.locator('svg.ink-pen path.ink-selected')).toHaveCount(1);
  await ctx.close();
});
