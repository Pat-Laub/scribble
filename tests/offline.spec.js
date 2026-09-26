const { test, expect } = require('@playwright/test');
const { openPad, paths, drawStroke } = require('./support/pad');

// Playwright can only drive service workers in chromium; the other engines
// ignore them under automation, so there is nothing to test there.
test.skip(({ browserName }) => browserName !== 'chromium', 'service workers are chromium-only in Playwright');

test('the pad opens and keeps its ink with the network gone', async ({ page, context }) => {
  await openPad(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await drawStroke(page);
  await page.waitForTimeout(600);   // the debounced save

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(page.locator('.ink-panel')).toBeVisible();
  await expect(paths(page)).toHaveCount(1);
});
