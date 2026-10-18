const { test, expect } = require('@playwright/test');
const { openPad, paths, drawStroke } = require('./support/pad');

test('the portrait pad is a tall page', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openPad(page, 'portrait.html');
  const box = await page.locator('.ink-surface').boundingBox();
  expect(box.height).toBeGreaterThan(box.width);
});

test('the portrait pad keeps its ink apart from the landscape one', async ({ page }) => {
  await openPad(page);
  await drawStroke(page);
  await page.waitForTimeout(600);   // the debounced save

  await openPad(page, 'portrait.html');
  await expect(paths(page)).toHaveCount(0);
});
