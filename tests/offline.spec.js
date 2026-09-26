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

// A deploy is picked up by the first reload after it, not the second: the page
// itself comes from the network whenever there is one, and only from the cache
// when there is not.
test('one reload fetches a newly deployed page', async ({ page, context }) => {
  await openPad(page);
  await page.evaluate(() => navigator.serviceWorker.ready);

  await context.route(/\/index\.html$|\/docs\/$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('<body', '<body data-deployed="new"');
    await route.fulfill({ response, body });
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-deployed', 'new');
});
