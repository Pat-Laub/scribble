const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Writes <output>/sw.js, which precaches the rendered pad so the Home Screen
// app opens without a network. Run after fingerprinting: the cache is named
// after a hash of every precached file, so any change to the site gives a new
// sw.js, which Safari installs on the next online launch.
const ROOT_FILES = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

function listFiles(outputDir, dir) {
  return fs.readdirSync(path.join(outputDir, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(outputDir, relative) : [relative];
  });
}

function writeServiceWorker(outputDir) {
  const files = [...ROOT_FILES, ...listFiles(outputDir, 'index_files')].sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file).update(fs.readFileSync(path.join(outputDir, file)));
  const version = `scribble-${hash.digest('hex').slice(0, 12)}`;

  const source = `const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.open(VERSION).then((cache) =>
    cache.match(event.request, { ignoreSearch: true })
      .then((hit) => hit || (event.request.mode === 'navigate' ? cache.match('index.html') : undefined))
      .then((hit) => hit || fetch(event.request))));
});
`;
  fs.writeFileSync(path.join(outputDir, 'sw.js'), source);
  return { version, count: files.length };
}

if (require.main === module) {
  const { version, count } = writeServiceWorker(path.resolve(process.argv[2] || 'docs'));
  process.stdout.write(`Service worker ${version} precaches ${count} files\n`);
}

module.exports = { writeServiceWorker };
