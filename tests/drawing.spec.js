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
