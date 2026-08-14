import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caretInMatch, findTexRanges } from './src/find-tex.js';
import {
  assignStarts,
  caretOffset,
  lineHasBuiltinWidget,
  pointFromParts,
  unionRects,
} from './src/overlay.js';
import test from 'node:test';

test('inline \\( \\)', () => {
  const text = 'Hawkes is self-exciting when \\( a > 0 \\) for \\( s < t \\).';
  const found = findTexRanges(text);
  assert.equal(found.length, 2);
  assert.equal(found[0].display, false);
  assert.equal(found[0].body, 'a > 0');
  assert.equal(found[1].body, 's < t');
});

test('display \\[ \\]', () => {
  const text = 'before\n\\[\n  E = mc^2\n\\]\nafter';
  const found = findTexRanges(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].display, true);
  assert.equal(found[0].body, 'E = mc^2');
});

test('multiline $$ is matched', () => {
  const text = '$$\nE = mc^2\n$$';
  const found = findTexRanges(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].display, true);
  assert.equal(found[0].body, 'E = mc^2');
});

test('same-line $$ is left for OrgNote', () => {
  const found = findTexRanges('$$E = mc^2$$');
  assert.equal(found.length, 0);
});

test('single $ is left for OrgNote', () => {
  const found = findTexRanges('Hawkes when $a > 0$ for $s < t$.');
  assert.equal(found.length, 0);
});

test('skips src blocks', () => {
  const text = '#+BEGIN_SRC python\n\\( x \\)\n#+END_SRC\n\\( y \\)';
  const found = findTexRanges(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].body, 'y');
});

test('skips export blocks', () => {
  const text = '#+BEGIN_EXPORT latex\nE=mc^2\n#+END_EXPORT\n\\( x \\)';
  const found = findTexRanges(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].body, 'x');
});

test('skips equation environments', () => {
  const text = '\\begin{equation}\n\\( x \\)\n\\end{equation}\n\\( y \\)';
  const found = findTexRanges(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].body, 'y');
});

test('latex test note fixtures', () => {
  const note = `* Display math
\\[
  \\lambda^*(t) = 1
\\]

Same-line:
$$\\lambda^*(t) = 1$$

Multiline:
$$
  \\lambda^*(t) = 1
$$

Inline: \\( a > 0 \\) and $b > 0$.
`;
  const found = findTexRanges(note);
  assert.deepEqual(
    found.map((f) => [f.display, f.body]),
    [
      [true, '\\lambda^*(t) = 1'],
      [true, '\\lambda^*(t) = 1'],
      [false, 'a > 0'],
    ]
  );
});

test('heading =$$= does not swallow later \\( \\)', () => {
  const text = `* Display math =$$ $$= (must be one line; multiline =$$= is plain text)
Same-line:
$$\\lambda^*(t) = 1$$

Hawkes when \\( a > 0 \\) for \\( s < t < u \\).
`;
  const found = findTexRanges(text);
  assert.deepEqual(
    found.map((f) => f.body),
    ['a > 0', 's < t < u']
  );
});

test('Hawkes Cov line from the OrgNote test note', () => {
  const line =
    'Hawkes is self-exciting when \\( \\mathrm{Cov}(N(s,t), N(t,u)) > 0 \\) for \\( s < t < u \\).';
  const found = findTexRanges(line);
  assert.equal(found.length, 2);
  assert.equal(found[0].display, false);
  assert.equal(found[0].body, '\\mathrm{Cov}(N(s,t), N(t,u)) > 0');
  assert.equal(found[1].body, 's < t < u');
});

test('matches \\( \\) when ZWSP sits between backslash and paren', () => {
  const zw = '\u200b';
  const text = `when \\${zw}( a > 0 \\${zw}) for \\${zw}( s < t \\${zw}).`;
  const found = findTexRanges(text);
  assert.equal(found.length, 2);
  assert.equal(found[0].body, 'a > 0');
  assert.equal(found[1].body, 's < t');
});

test('latex test note file includes the Cov inline formulas', () => {
  const note = readFileSync(
    new URL('../20260814-orgnote-latex.org', import.meta.url),
    'utf8'
  );
  const found = findTexRanges(note);
  const bodies = found.map((f) => f.body);
  assert.ok(bodies.includes('\\mathrm{Cov}(N(s,t), N(t,u)) > 0'));
  assert.ok(bodies.includes('s < t < u'));
  assert.ok(found.some((f) => f.display && f.body.includes('\\lambda^*')));
});

test('caret inside a match hides it', () => {
  const [match] = findTexRanges('hello \\( a \\) there');
  assert.equal(caretInMatch(match.from, match), true);
  assert.equal(caretInMatch(match.to - 1, match), true);
  assert.equal(caretInMatch(match.to, match), false);
  assert.equal(caretInMatch(0, match), false);
  assert.equal(caretInMatch(null, match), false);
});

test('pointFromParts skips synthetic newlines', () => {
  const n1 = { value: '\\[' };
  const n2 = { value: '  a' };
  const n3 = { value: '\\]' };
  const parts = assignStarts([
    { node: n1, text: '\\[', start: 0 },
    { node: null, text: '\n', start: 0 },
    { node: n2, text: '  a', start: 0 },
    { node: null, text: '\n', start: 0 },
    { node: n3, text: '\\]', start: 0 },
  ]);
  const text = parts.map((p) => p.text).join('');
  const [match] = findTexRanges(text);
  assert.equal(match.body, 'a');
  const start = pointFromParts(parts, match.from, 'start');
  const end = pointFromParts(parts, match.to, 'end');
  assert.equal(start.node, n1);
  assert.equal(start.offset, 0);
  assert.equal(end.node, n3);
  assert.equal(end.offset, 2);
});

test('unionRects covers every client rect so \\] is not left exposed', () => {
  const union = unionRects([
    { left: 10, top: 10, right: 40, bottom: 24, width: 30, height: 14 },
    { left: 10, top: 24, right: 80, bottom: 38, width: 70, height: 14 },
    { left: 10, top: 38, right: 30, bottom: 52, width: 20, height: 14 },
  ]);
  assert.equal(union.top, 10);
  assert.equal(union.bottom, 52);
  assert.equal(union.height, 42);
  assert.equal(union.width, 70);
});

test('caretOffset maps a text node selection onto collected parts', () => {
  const node = { nodeType: 3, nodeValue: '\\( a \\)' };
  const parts = assignStarts([{ node, text: '\\( a \\)', start: 0 }]);
  const root = {
    contains(n) {
      return n === node;
    },
  };
  const sel = {
    rangeCount: 1,
    getRangeAt() {
      return { startContainer: node, startOffset: 3 };
    },
  };
  assert.equal(caretOffset(parts, sel, root), 3);
});

test('does not treat OrgNote widget lines as overlay covers', () => {
  const line = {
    querySelector(sel) {
      assert.ok(sel.includes('org-embedded'));
      return { className: 'org-embedded-exportblock' };
    },
  };
  assert.equal(lineHasBuiltinWidget(line), true);
  assert.equal(lineHasBuiltinWidget({ querySelector: () => null }), false);
  assert.equal(lineHasBuiltinWidget(null), false);
});

test('same-line $ and $$ and export blocks stay out of overlay matches', () => {
  const note = `#+BEGIN_EXPORT latex
E = mc^2
#+END_EXPORT

$$\\lambda^*(t) = 1$$

Hawkes when $\\mathrm{Cov}(N(s,t), N(t,u)) > 0$ for $s < t < u$.
`;
  const found = findTexRanges(note);
  assert.equal(found.length, 0);
});
