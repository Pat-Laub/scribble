const { test, expect } = require('@playwright/test');
const { openPad, act, openMore, drawStroke, paths } = require('./support/pad');

// scribble-pages.js grows the deck a page at a time and can delete one. Neither
// exists in any other copy of the annotation code, and both interact with the
// per-slide ink store, so they need covering before the forks are merged.

const count = page => page.evaluate(() =>
  document.querySelectorAll('.reveal .slides section').length);

test('the pad starts on a single page', async ({ page }) => {
  await openPad(page);
  expect(await count(page)).toBe(1);
});

test('navigating past the last page grows a new one', async ({ page }) => {
  await openPad(page);
  expect(await count(page)).toBe(1);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => count(page), { message: 'no page was grown' }).toBe(2);
  await expect.poll(() => page.evaluate(() => Reveal.getIndices().h)).toBe(1);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => count(page)).toBe(3);
});

test('grown pages and their ink survive a reload', async ({ page }) => {
  await openPad(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => count(page)).toBe(2);
  await drawStroke(page, [[0.3, 0.4], [0.5, 0.5]]);
  await expect(paths(page)).toHaveCount(1);

  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect.poll(() => count(page), { message: 'the grown page was lost' }).toBe(2);
});

test('a page can be deleted once more than one exists', async ({ page }) => {
  await openPad(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => count(page)).toBe(2);

  // The confirm() the delete raises would block the page, so answer it.
  page.on('dialog', dialog => dialog.accept());
  await openMore(page);
  await act(page, 'delete-page').click();
  await expect.poll(() => count(page), { message: 'the page was not deleted' }).toBe(1);
});
