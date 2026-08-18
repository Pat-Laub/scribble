const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = [
  'palm-rejection.js',
  'perfect-freehand.min.js',
  'annotate-geometry.js',
  'annotate-model.js',
  'annotate.js'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fingerprintAssets(outputDir) {
  const indexPath = path.join(outputDir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const generated = [];

  for (const asset of ASSETS) {
    const sourcePath = path.join(outputDir, asset);
    const contents = fs.readFileSync(sourcePath);
    const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 12);
    const parsed = path.parse(asset);
    const fingerprinted = `${parsed.name}-${hash}${parsed.ext}`;
    const fingerprintedPath = path.join(outputDir, fingerprinted);
    const reference = new RegExp(`(<script\\s+[^>]*src=["'])${escapeRegExp(asset)}(["'])`, 'g');

    if (!reference.test(html)) {
      throw new Error(`Could not find ${asset} in ${indexPath}`);
    }
    html = html.replace(reference, `$1${fingerprinted}$2`);

    const stalePattern = new RegExp(`^${escapeRegExp(parsed.name)}-[0-9a-f]{12}${escapeRegExp(parsed.ext)}$`);
    for (const candidate of fs.readdirSync(outputDir)) {
      if (candidate !== fingerprinted && stalePattern.test(candidate)) {
        fs.unlinkSync(path.join(outputDir, candidate));
      }
    }

    if (fs.existsSync(fingerprintedPath)) fs.unlinkSync(sourcePath);
    else fs.renameSync(sourcePath, fingerprintedPath);
    generated.push(fingerprinted);
  }

  const temporaryIndex = `${indexPath}.fingerprinting`;
  fs.writeFileSync(temporaryIndex, html);
  fs.renameSync(temporaryIndex, indexPath);
  return generated;
}

if (require.main === module) {
  const outputDir = path.resolve(process.argv[2] || 'docs');
  const generated = fingerprintAssets(outputDir);
  process.stdout.write(`Fingerprinting annotation assets: ${generated.join(', ')}\n`);
}

module.exports = { ASSETS, fingerprintAssets };
