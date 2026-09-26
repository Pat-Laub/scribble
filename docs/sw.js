const VERSION = "scribble-fc31e15f8855";
const FILES = [
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "index_files/libs/clipboard/clipboard.min.js",
  "index_files/libs/quarto-html/light-border.css",
  "index_files/libs/quarto-html/popper.min.js",
  "index_files/libs/quarto-html/quarto-syntax-highlighting-64a204ab8560d761af7679ceaba22944.css",
  "index_files/libs/quarto-html/tabby.min.js",
  "index_files/libs/quarto-html/tippy.css",
  "index_files/libs/quarto-html/tippy.umd.min.js",
  "index_files/libs/revealjs/dist/reset.css",
  "index_files/libs/revealjs/dist/reveal.css",
  "index_files/libs/revealjs/dist/reveal.esm.js",
  "index_files/libs/revealjs/dist/reveal.esm.js.map",
  "index_files/libs/revealjs/dist/reveal.js",
  "index_files/libs/revealjs/dist/reveal.js.map",
  "index_files/libs/revealjs/dist/theme/fonts/league-gothic/LICENSE",
  "index_files/libs/revealjs/dist/theme/fonts/league-gothic/league-gothic.css",
  "index_files/libs/revealjs/dist/theme/fonts/league-gothic/league-gothic.eot",
  "index_files/libs/revealjs/dist/theme/fonts/league-gothic/league-gothic.ttf",
  "index_files/libs/revealjs/dist/theme/fonts/league-gothic/league-gothic.woff",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/LICENSE",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-italic.eot",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-italic.ttf",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-italic.woff",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-regular.eot",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-regular.ttf",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-regular.woff",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibold.eot",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibold.ttf",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibold.woff",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibolditalic.eot",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibolditalic.ttf",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro-semibolditalic.woff",
  "index_files/libs/revealjs/dist/theme/fonts/source-sans-pro/source-sans-pro.css",
  "index_files/libs/revealjs/dist/theme/quarto-2e9fe607c51929acdcf521055f80c550.css",
  "index_files/libs/revealjs/plugin/annotate/annotate-bfd2fe022e75.js",
  "index_files/libs/revealjs/plugin/annotate/annotate-codec-4f180b57059f.js",
  "index_files/libs/revealjs/plugin/annotate/annotate-geometry-43788bd40d25.js",
  "index_files/libs/revealjs/plugin/annotate/annotate-model-3a71aa2e3281.js",
  "index_files/libs/revealjs/plugin/annotate/annotate-pages-2af095def630.js",
  "index_files/libs/revealjs/plugin/annotate/annotate-pdf-5a1b804c1bf2.js",
  "index_files/libs/revealjs/plugin/annotate/palm-rejection-5124b7a316ef.js",
  "index_files/libs/revealjs/plugin/annotate/perfect-freehand.min.js",
  "index_files/libs/revealjs/plugin/highlight/highlight.esm.js",
  "index_files/libs/revealjs/plugin/highlight/highlight.js",
  "index_files/libs/revealjs/plugin/highlight/monokai.css",
  "index_files/libs/revealjs/plugin/highlight/plugin.js",
  "index_files/libs/revealjs/plugin/highlight/zenburn.css",
  "index_files/libs/revealjs/plugin/markdown/markdown.esm.js",
  "index_files/libs/revealjs/plugin/markdown/markdown.js",
  "index_files/libs/revealjs/plugin/markdown/plugin.js",
  "index_files/libs/revealjs/plugin/math/katex.js",
  "index_files/libs/revealjs/plugin/math/math.esm.js",
  "index_files/libs/revealjs/plugin/math/math.js",
  "index_files/libs/revealjs/plugin/math/mathjax2.js",
  "index_files/libs/revealjs/plugin/math/mathjax3.js",
  "index_files/libs/revealjs/plugin/math/plugin.js",
  "index_files/libs/revealjs/plugin/notes/notes.esm.js",
  "index_files/libs/revealjs/plugin/notes/notes.js",
  "index_files/libs/revealjs/plugin/notes/plugin.js",
  "index_files/libs/revealjs/plugin/notes/speaker-view.html",
  "index_files/libs/revealjs/plugin/pdf-export/pdfexport.js",
  "index_files/libs/revealjs/plugin/pdf-export/plugin.yml",
  "index_files/libs/revealjs/plugin/quarto-line-highlight/line-highlight.css",
  "index_files/libs/revealjs/plugin/quarto-line-highlight/line-highlight.js",
  "index_files/libs/revealjs/plugin/quarto-line-highlight/plugin.yml",
  "index_files/libs/revealjs/plugin/quarto-support/footer.css",
  "index_files/libs/revealjs/plugin/quarto-support/plugin.yml",
  "index_files/libs/revealjs/plugin/quarto-support/support.js",
  "index_files/libs/revealjs/plugin/reveal-menu/menu.css",
  "index_files/libs/revealjs/plugin/reveal-menu/menu.js",
  "index_files/libs/revealjs/plugin/reveal-menu/plugin.yml",
  "index_files/libs/revealjs/plugin/reveal-menu/quarto-menu.css",
  "index_files/libs/revealjs/plugin/reveal-menu/quarto-menu.js",
  "index_files/libs/revealjs/plugin/reveal-multiplex/multiplex.js",
  "index_files/libs/revealjs/plugin/reveal-multiplex/socket.io.min.js",
  "index_files/libs/revealjs/plugin/search/plugin.js",
  "index_files/libs/revealjs/plugin/search/search.esm.js",
  "index_files/libs/revealjs/plugin/search/search.js",
  "index_files/libs/revealjs/plugin/zoom/plugin.js",
  "index_files/libs/revealjs/plugin/zoom/zoom.esm.js",
  "index_files/libs/revealjs/plugin/zoom/zoom.js",
  "manifest.webmanifest"
];

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
