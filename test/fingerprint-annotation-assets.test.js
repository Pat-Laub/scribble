const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASSETS, PLUGIN_SUFFIX, fingerprintAssets } = require('../scripts/fingerprint-annotation-assets.js');

test('annotation assets receive content-derived filenames and stale versions are removed', (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-fingerprint-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  // Quarto puts a revealjs plugin's scripts in their own directory and
  // references them by that path, so the fixture has to be shaped the same way.
  const PLUGIN_DIR = path.join('index_files', PLUGIN_SUFFIX);
  const pluginDir = path.join(outputDir, PLUGIN_DIR);
  const href = (name) => `${PLUGIN_DIR.split(path.sep).join('/')}/${name}`;
  fs.mkdirSync(pluginDir, { recursive: true });

  const tags = ASSETS.map((asset) => `<script src="${href(asset)}"></script>`).join('\n');
  fs.writeFileSync(path.join(outputDir, 'index.html'), tags);
  fs.writeFileSync(path.join(pluginDir, 'annotate-deadbeef0000.js'), 'stale');

  const expected = ASSETS.map((asset, index) => {
    const contents = `asset ${index}`;
    fs.writeFileSync(path.join(pluginDir, asset), contents);
    const parsed = path.parse(asset);
    const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 12);
    return `${parsed.name}-${hash}${parsed.ext}`;
  });

  assert.deepEqual(fingerprintAssets(outputDir), expected);
  const rendered = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');

  expected.forEach((asset) => assert.match(rendered, new RegExp(`src="${href(asset)}"`)));
  ASSETS.forEach((asset) => assert.equal(fs.existsSync(path.join(pluginDir, asset)), false));
  assert.equal(fs.existsSync(path.join(pluginDir, 'annotate-deadbeef0000.js')), false);
});
