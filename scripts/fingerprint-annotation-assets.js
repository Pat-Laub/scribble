const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Quarto copies a revealjs plugin's scripts here and references them from the
// deck; it hashes its own CSS but not these, so Safari will happily keep a
// week-old annotate.js. The vendored library is left alone: it changes only
// when it is deliberately replaced.
const PLUGIN_SUFFIX = path.join('libs', 'revealjs', 'plugin', 'scribble');

const ASSETS = [
  'scribble-pages.js',
  'palm-rejection.js',
  'annotate-geometry.js',
  'annotate-model.js',
  'annotate-pdf.js',
  'annotate.js'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Quarto gives every deck its own `<name>_files` tree, so fingerprint each one
// rather than only index.html -- a deck the loop misses keeps unhashed script
// names and quietly goes stale.
function fingerprintAssets(outputDir) {
  const decks = fs.readdirSync(outputDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => ({ html: name, dir: path.join(`${name.slice(0, -5)}_files`, PLUGIN_SUFFIX) }))
    .filter((deck) => fs.existsSync(path.join(outputDir, deck.dir)));
  return decks.flatMap((deck) => fingerprintDeck(outputDir, deck.html, deck.dir));
}

function fingerprintDeck(outputDir, indexName, PLUGIN_DIR) {
  const indexPath = path.join(outputDir, indexName);
  let html = fs.readFileSync(indexPath, 'utf8');
  const generated = [];

  const pluginDir = path.join(outputDir, PLUGIN_DIR);
  for (const asset of ASSETS) {
    const sourcePath = path.join(pluginDir, asset);
    const contents = fs.readFileSync(sourcePath);
    const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 12);
    const parsed = path.parse(asset);
    const fingerprinted = `${parsed.name}-${hash}${parsed.ext}`;
    const fingerprintedPath = path.join(pluginDir, fingerprinted);
    const href = `${PLUGIN_DIR.split(path.sep).join('/')}/${asset}`;
    const reference = new RegExp(`(<script\\s+[^>]*src=["'])${escapeRegExp(href)}(["'])`, 'g');

    if (!reference.test(html)) {
      throw new Error(`Could not find ${href} in ${indexPath}`);
    }
    html = html.replace(reference, `$1${PLUGIN_DIR.split(path.sep).join('/')}/${fingerprinted}$2`);

    const stalePattern = new RegExp(`^${escapeRegExp(parsed.name)}-[0-9a-f]{12}${escapeRegExp(parsed.ext)}$`);
    for (const candidate of fs.readdirSync(pluginDir)) {
      if (candidate !== fingerprinted && stalePattern.test(candidate)) {
        fs.unlinkSync(path.join(pluginDir, candidate));
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

module.exports = { ASSETS, PLUGIN_SUFFIX, fingerprintAssets };
