const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASSETS, fingerprintAssets } = require('../scripts/fingerprint-annotation-assets.js');

test('annotation assets receive content-derived filenames and stale versions are removed', (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-fingerprint-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const tags = ASSETS.map((asset) => `<script src="${asset}"></script>`).join('\n');
  fs.writeFileSync(path.join(outputDir, 'index.html'), tags);
  fs.writeFileSync(path.join(outputDir, 'annotate-deadbeef0000.js'), 'stale');

  const expected = ASSETS.map((asset, index) => {
    const contents = `asset ${index}`;
    fs.writeFileSync(path.join(outputDir, asset), contents);
    const parsed = path.parse(asset);
    const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 12);
    return `${parsed.name}-${hash}${parsed.ext}`;
  });

  assert.deepEqual(fingerprintAssets(outputDir), expected);
  const rendered = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');

  expected.forEach((asset) => assert.match(rendered, new RegExp(`src="${asset}"`)));
  ASSETS.forEach((asset) => assert.equal(fs.existsSync(path.join(outputDir, asset)), false));
  assert.equal(fs.existsSync(path.join(outputDir, 'annotate-deadbeef0000.js')), false);
});
