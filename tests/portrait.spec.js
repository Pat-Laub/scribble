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

test('a corner button swaps between the landscape and portrait pads', async ({ page }) => {
  await openPad(page);
  await page.locator('.deck-launchers .scribble-swap').click();
  await expect(page).toHaveURL(/\/portrait\.html(#.*)?$/);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.locator('.deck-launchers .scribble-swap').click();
  await expect(page).toHaveURL(/\/index\.html(#.*)?$/);
});

for (const [file, width, height] of [['index.html', 1366, 1024], ['portrait.html', 1024, 1366]]) {
  test(`${file} fills a 12.9-inch iPad screen without bars`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPad(page, file);
    const box = await page.locator('.ink-surface').boundingBox();
    expect(box.width).toBeCloseTo(width, -1);
    expect(box.height).toBeCloseTo(height, -1);
  });
}
