# scribble

A blank reveal.js deck to write on: 60 empty slides, no title page and no text.
Drawing uses the MIT-licensed [perfect-freehand](https://github.com/steveruizok/perfect-freehand) package through the self-contained `annotate.js` tool.

## Using it

Press `d` during a presentation (or click the pen in the bottom-left corner) to open drawing tools. Choose a pen, highlighter or eraser and one of five colours. `Cmd/Ctrl+Z` undoes, `v` hides ink, and `Esc` puts the tools away. Scribble over a stroke, or hold the right mouse/stylus barrel button, to erase it.

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
perfect-freehand.min.js   vendored MIT stroke-shaping library
reveal-fixes.html         reveal.js fixes and annotation script includes
docs/                     rendered output for GitHub Pages
```
