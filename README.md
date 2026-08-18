# scribble

A 16:9 blank reveal.js deck to write on: 60 empty slides, no title page and no text.
Drawing uses the MIT-licensed [perfect-freehand](https://github.com/steveruizok/perfect-freehand) package through the self-contained `annotate.js` tool.

## Using it

The drawing tools are open as soon as the deck starts. The compact rail keeps the pen, highlighter, text box, eraser, lasso selector, undo/redo, and all five colours in immediate reach; its ••• button opens width, pressure, ruled guides, clear, direct PDF download, and file transfer. With the text tool, tap where the box should begin, type normally, use Enter for a new paragraph, and press `Cmd/Ctrl+Enter` or tap elsewhere to finish; tap existing text to edit it, or drag it directly to move it. Circle annotations with the lasso, then drag inside its selection box to move them or drag a corner handle to resize them proportionally. Text boxes participate in the same selection operations as ink. A contextual strip can copy, delete, or continue with the selection: Continue advances one slide, pastes the working at the top margin, and leaves it selected. Copied annotations can also be pasted normally on any slide and are selected immediately for positioning. `Cmd/Ctrl+Enter`, `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, and Delete/Backspace provide the same selection actions from a keyboard. Apple Pencil pressure sensitivity is on by default and can be toggled in the options. Width changes apply to future strokes; finished strokes keep the width they were drawn with. Ruled guides can be toggled and spaced closer together or farther apart; both settings stay local to this browser and appear with each slide's annotations in Overview and in PDF output. `Cmd/Ctrl+Z` undoes, `v` hides or restores annotations, and `l` toggles ruled writing guides. Scribble over a stroke, or hold the right mouse/stylus barrel button, to erase it. A mouse wheel cycles the visible colours, and its middle button alternates the pen and highlighter. On iPad, fingers navigate from the first touch while Pencil input draws; elsewhere, mouse and touch input can doodle. Multi-contact gestures are ignored so a resting palm cannot accidentally navigate.

Annotations are saved locally by each slide's explicit ID and survive reloads, reordering, or insertion of other slides. Use the panel's export/import buttons to move them to another browser or device. Exports also include a bounded, session-only interaction trace and device details for diagnosing input failures; nothing in that trace is sent or persisted by the app. Give every new slide a unique ID; Reveal fragment animations remain part of their containing slide, while uncounted replacement slides need their own IDs.

The writing canvas is 16:9 so its visible left and right edges agree with Overview and PDF pages on modern widescreen displays. On screens with a different aspect ratio, a hairline and subtly shaded margins distinguish the space outside the target 16:9 canvas; those local guides are omitted from Overview and PDF output.

Choose **Download annotated PDF** in the options to save a vector PDF directly. Its pages retain the deck's 16:9 shape without depending on the browser's paper-size settings; pen and highlighter strokes remain sharp, and enabled ruled guides use their current spacing on every page. If direct PDF creation is unavailable, the app falls back to Reveal's print view and the browser's PDF dialog.

## Rendering

```sh
quarto preview
quarto render
```

`docs/` is committed intentionally and served directly by GitHub Pages. Render and commit it whenever the deck changes. A post-render step gives each annotation JavaScript asset a content-hashed filename, so browsers fetch changed drawing code without requiring a hard refresh.

## Layout

```
index.qmd                 the blank slides
_quarto.yml               reveal.js configuration
scribble.scss             paper and presentation chrome
annotate.scss             annotation UI styling
annotate.js               pen, highlighter, eraser and persistence
annotate-geometry.js      portable, DOM-free annotation geometry
annotate-model.js         portable pressure and stroke model helpers
annotate-pdf.js           dependency-free vector PDF encoder
palm-rejection.js         keeps multi-contact palm touches out of reveal swipes
perfect-freehand.min.js   vendored MIT stroke-shaping library
reveal-fixes.html         reveal.js fixes and annotation script includes
docs/                     rendered output for GitHub Pages
```
