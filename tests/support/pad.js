const { expect } = require('@playwright/test');

// The pad opens with the tools already in hand and one blank page.
async function openPad(page) {
  await page.goto('/docs/index.html');
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.ink-surface').waitFor();
  return page;
}

const paths = page => page.locator('svg.ink-pen path');
const tool = (page, name) => page.locator(`.ink-panel [data-tool="${name}"]`);
const act = (page, name) => page.locator(`.ink-panel [data-act="${name}"]`);

// Open the ••• tray that holds the once-a-lecture controls.
async function openMore(page) {
  if (await page.locator('.ink-more:not([hidden])').count() === 0) {
    await act(page, 'more').click();
  }
  await expect(page.locator('.ink-more')).toBeVisible();
}

// Drag in fractions of the *input surface*, not the ink layer. The layers are
// overscanned to three times the page and hang outside the viewport
// (viewBox "-1244 -700 3732 2100"), so a fraction of `svg.ink-pen` lands at
// negative screen coordinates: chromium tolerates that, firefox drops the
// events entirely. `.ink-surface` is the element that takes the input.
async function drag(page, points, steps = 8) {
  const box = await page.locator('.ink-surface').boundingBox();
  if (!box) throw new Error('the ink surface is not visible');
  const at = ([x, y]) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const first = at(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const next = at(p);
    await page.mouse.move(next.x, next.y, { steps });
  }
  await page.mouse.up();
  return box;
}

async function drawStroke(page, points = [[0.3, 0.45], [0.45, 0.5], [0.6, 0.45]]) {
  await tool(page, 'pen').click();
  return drag(page, points);
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

module.exports = { openPad, paths, tool, act, openMore, drag, drawStroke, mod };
