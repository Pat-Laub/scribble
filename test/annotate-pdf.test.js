const test = require('node:test');
const assert = require('node:assert/strict');
const { create, quadraticPathToPdf } = require('../annotate-pdf.js');

test('quadratic freehand paths become exact cubic PDF paths', () => {
  assert.equal(
    quadraticPathToPdf('M 0 0 Q 3 6 6 0 9 -6 12 0 Z'),
    '0 0 m\n2 4 4 4 6 0 c\n8 -4 10 -4 12 0 c\nh'
  );
  assert.throws(() => quadraticPathToPdf('M 0 0 Q 3 6'), /Invalid SVG path data/);
});

test('direct PDF output has widescreen pages, ruled guides and vector ink', () => {
  const pdf = create({
    width: 1244,
    height: 700,
    rules: [64, 116],
    ruleMargin: 64,
    pages: [
      { strokes: [
        { tool: 'highlighter', colour: '#facc15', path: 'M 10 20 Q 20 30 30 20 Z' },
        { tool: 'pen', colour: '#2668c7', path: 'M 100 200 Q 110 210 120 200 Z' }
      ] },
      { strokes: [] }
    ]
  });
  const text = Buffer.from(pdf).toString('ascii');
  assert.match(text, /^%PDF-1\.7/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 959\.6571 540\]/);
  assert.match(text, /\/BM \/Multiply/);
  assert.match(text, /64 64 m 1180 64 l S/);
  assert.match(text, /0\.149 0\.4078 0\.7804 rg/);
  assert.match(text, /%%EOF\n$/);

  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref');
  const entries = text.slice(xrefAt).match(/^\d{10} 00000 n /gm) || [];
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + String(index + 1).length + 6), `${index + 1} 0 obj`);
  });
});
