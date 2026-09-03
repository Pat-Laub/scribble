const { test, expect } = require('@playwright/test');
const { openPad, paths, tool, act, openMore, drag, drawStroke, mod } = require('./support/pad');

// These cover the tools that exist only in this fork. ACTL2131's copy of
// annotate.js has pen, highlighter and eraser and nothing else, so every
// assertion here is a feature the unification has to carry across rather than
// quietly drop.

const texts = page => page.locator('svg.ink-pen .ink-text, .ink-layer .ink-text');

test('a text box can be typed and kept', async ({ page }) => {
  await openPad(page);
  await tool(page, 'text').click();

  const box = await page.locator('.ink-surface').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);

  const editor = page.locator('.ink-text-editor');
  await expect(editor).toBeVisible();
  await editor.type('Hello pad');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(editor).toBeHidden();

  await expect(page.locator('svg.ink-layer.ink-text')).toContainText('Hello pad');

  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await expect(page.locator('svg.ink-layer.ink-text')).toContainText('Hello pad');
});

test('the lasso selects a stroke and the selection can be moved', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  const before = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);

  await tool(page, 'select').click();
  // Circle the stroke.
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();

  // Drag from inside the selection to move it right.
  await drag(page, [[0.45, 0.47], [0.60, 0.47]]);
  const after = await page.evaluate(() =>
    document.querySelector('svg.ink-pen path').getBBox().x);
  expect(after, 'the selection did not move').toBeGreaterThan(before + 10);
});

test('a selection can be copied and pasted', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await expect(paths(page)).toHaveCount(1);

  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();

  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  await expect(paths(page)).toHaveCount(2);
});

test('a selection can be deleted', async ({ page }) => {
  await openPad(page);
  await drawStroke(page, [[0.35, 0.45], [0.45, 0.5], [0.55, 0.45]]);
  await tool(page, 'select').click();
  await drag(page, [[0.28, 0.36], [0.62, 0.36], [0.62, 0.60], [0.28, 0.60], [0.28, 0.36]]);
  await expect(page.locator('.ink-selection-box')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(paths(page)).toHaveCount(0);
});

test('ruled writing guides can be toggled', async ({ page }) => {
  await openPad(page);
  await openMore(page);

  // annotate.js marks the button `active` and hides the guide layer with
  // `ink-rules-hidden`, so assert on both rather than on either alone.
  const state = () => page.evaluate(() => ({
    active: document.querySelector('.ink-panel [data-act="rules"]').classList.contains('active'),
    hidden: !!document.querySelector('.ink-rules-hidden')
  }));

  const before = await state();
  await act(page, 'rules').click();
  const after = await state();

  expect(after.active, 'the guides button did not change state').not.toBe(before.active);
  expect(after.hidden, 'the guide layer did not follow the button').toBe(!after.active);
});
