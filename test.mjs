import assert from 'node:assert/strict';
import { findTexRanges } from './index.js';
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
