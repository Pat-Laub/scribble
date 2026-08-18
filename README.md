# scribble

A blank reveal.js deck to write on: 60 empty slides, no title page and no text.
Drawing uses the MIT-licensed [perfect-freehand](https://github.com/steveruizok/perfect-freehand) package through the self-contained `annotate.js` tool.

## Using it

The drawing tools are open as soon as the deck starts. Choose a pen, highlighter, eraser, or lasso and one of five colours. Circle annotations with the lasso, then drag inside its selection box to move them. `Cmd/Ctrl+Z` undoes, `v` hides or restores ink, and `l` toggles ruled writing guides. Scribble over a stroke, or hold the right mouse/stylus barrel button, to erase it. A one-finger horizontal swipe changes slide; multi-contact gestures are ignored so a resting palm cannot accidentally navigate.

Annotations are saved locally by slide and survive reloads. Use the panel's export/import buttons to move them to another browser or device. Add blank slides only at the end of `index.qmd`: annotations are keyed by slide index.

## Rendering

```sh
quarto preview
quarto render
```

`docs/` is committed intentionally and served directly by GitHub Pages. Render and commit it whenever the deck changes.

## Layout

```
index.qmd                 the blank slides
_quarto.yml               reveal.js configuration
scribble.scss             paper and presentation chrome
annotate.scss             annotation UI styling
annotate.js               pen, highlighter, eraser and persistence
annotate-geometry.js      portable, DOM-free annotation geometry
palm-rejection.js         keeps multi-contact palm touches out of reveal swipes
perfect-freehand.min.js   vendored MIT stroke-shaping library
reveal-fixes.html         reveal.js fixes and annotation script includes
docs/                     rendered output for GitHub Pages
```
