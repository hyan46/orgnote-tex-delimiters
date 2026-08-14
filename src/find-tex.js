const BLOCK_RE =
  /^[ \t]*#\+BEGIN_(SRC|EXAMPLE|EXPORT|COMMENT|VERSE)\b[\s\S]*?^[ \t]*#\+END_\1\b.*$/gim;
const ENV_RE =
  /\\begin\{((?:equation|align|eqnarray|multline|gather|displaymath)\*?)\}[\s\S]*?\\end\{\1\}/g;
const INVISIBLE = /[\u200b\u200c\u200d\ufeff]/;

function mergeRanges(ranges) {
  const sorted = ranges
    .map((r) => ({ from: r.from, to: r.to }))
    .sort((a, b) => a.from - b.from);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push(r);
  }
  return out;
}

function collectRegexRanges(text, re) {
  const ranges = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    ranges.push({ from: m.index, to: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return ranges;
}

function overlaps(from, to, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (from < r.to && to > r.from) return true;
  }
  return false;
}

/** Length of `\\` + optional ZWSP + `brace`, or 0. */
export function delimLen(text, i, brace) {
  if (text[i] !== '\\') return 0;
  let k = i + 1;
  while (k < text.length && INVISIBLE.test(text[k])) k++;
  if (text[k] === brace) return k + 1 - i;
  return 0;
}

function findClose(text, from, brace) {
  for (let j = from; j < text.length; j++) {
    const n = delimLen(text, j, brace);
    if (n) return { from: j, to: j + n };
  }
  return null;
}

function atLineStart(text, i) {
  let j = i;
  while (j > 0 && (text[j - 1] === ' ' || text[j - 1] === '\t')) j--;
  return j === 0 || text[j - 1] === '\n';
}

/**
 * Find math ranges OrgNote does not parse as latexFragment.
 * Same-line $...$ / $$...$$ are left to the builtin widget.
 */
export function findTexRanges(text) {
  const skips = mergeRanges([
    ...collectRegexRanges(text, BLOCK_RE),
    ...collectRegexRanges(text, ENV_RE),
  ]);
  const covered = [];
  const results = [];

  const take = (from, to, display, body) => {
    if (!body || overlaps(from, to, skips) || overlaps(from, to, covered)) {
      return false;
    }
    results.push({ from, to, display, body });
    covered.push({ from, to });
    return true;
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const body = text.slice(i + 2, end);
        if (body.includes('\n')) {
          // Headings like =$$= must not pair with a later $$ and swallow \( \).
          if (
            atLineStart(text, i) &&
            atLineStart(text, end) &&
            take(i, end + 2, true, body.trim())
          ) {
            i = end + 2;
            continue;
          }
        } else {
          i = end + 2;
          continue;
        }
      }
    }

    const openDisp = delimLen(text, i, '[');
    if (openDisp) {
      const close = findClose(text, i + openDisp, ']');
      if (close) {
        const body = text.slice(i + openDisp, close.from).trim();
        if (take(i, close.to, true, body)) {
          i = close.to;
          continue;
        }
      }
    }

    const openInline = delimLen(text, i, '(');
    if (openInline) {
      const close = findClose(text, i + openInline, ')');
      if (close) {
        const body = text.slice(i + openInline, close.from).trim();
        if (take(i, close.to, false, body)) {
          i = close.to;
          continue;
        }
      }
    }

    i++;
  }

  return results;
}

export function caretInMatch(caret, match) {
  return caret != null && caret >= match.from && caret < match.to;
}
