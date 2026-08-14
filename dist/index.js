/**
 * OrgNote extension: render \( \), \[ \], and multiline $$ $$ with KaTeX.
 *
 * OrgNote's parser only turns $ / $$ (same line) into latexFragment nodes.
 * This overlay scans the CodeMirror document and replaces the missing
 * delimiters using the *host* CodeMirror classes (user extensions cannot
 * import @codemirror/view from a data: URL).
 */

export const manifest = {
  name: 'TeX delimiters',
  description:
    'Render \\( \\) inline, \\[ \\] display, and multiline $$ $$ with KaTeX',
  version: '0.1.0',
  category: 'extension',
  sourceType: 'git',
  sourceUrl: 'https://github.com/hyan46/orgnote-tex-delimiters',
  author: 'Hao Yan',
  keywords: ['editor', 'latex', 'katex', 'math'],
  reloadRequired: true,
};

const STYLE_ID = 'orgnote-tex-delimiters';
const KATEX_CSS_ID = 'orgnote-tex-katex-css';
const KATEX_ESM = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/+esm';
const KATEX_CSS =
  'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';

const BLOCK_RE =
  /^[ \t]*#\+BEGIN_(SRC|EXAMPLE|EXPORT|COMMENT|VERSE)\b[\s\S]*?^[ \t]*#\+END_\1\b.*$/gim;
const ENV_RE =
  /\\begin\{((?:equation|align|eqnarray|multline|gather|displaymath)\*?)\}[\s\S]*?\\end\{\1\}/g;

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
          take(i, end + 2, true, body.trim());
          i = end + 2;
          continue;
        }
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '\\' && text[i + 1] === '[') {
      const end = text.indexOf('\\]', i + 2);
      if (end !== -1) {
        const body = text.slice(i + 2, end).trim();
        if (take(i, end + 2, true, body)) {
          i = end + 2;
          continue;
        }
      }
    }

    if (text[i] === '\\' && text[i + 1] === '(') {
      const end = text.indexOf('\\)', i + 2);
      if (end !== -1) {
        const body = text.slice(i + 2, end).trim();
        if (take(i, end + 2, false, body)) {
          i = end + 2;
          continue;
        }
      }
    }

    i++;
  }

  return results;
}

function walkToDecoration(ctor) {
  let current = ctor;
  for (let n = 0; n < 6 && current; n++) {
    if (
      typeof current.replace === 'function' &&
      typeof current.set === 'function'
    ) {
      return current;
    }
    const parent = Object.getPrototypeOf(current);
    if (!parent || parent === Function.prototype) break;
    current = parent;
  }
  return null;
}

function walkToWidgetType(ctor) {
  let current = ctor;
  for (let n = 0; n < 8 && current; n++) {
    const parent = Object.getPrototypeOf(current);
    if (
      !parent ||
      parent === Function.prototype ||
      parent === Object ||
      !parent.prototype ||
      typeof parent.prototype.toDOM !== 'function'
    ) {
      return current;
    }
    current = parent;
  }
  return ctor;
}

function stealCM(view) {
  const EditorView = view.constructor;
  const facet = EditorView.decorations;
  if (!facet) return null;
  let sets;
  try {
    sets = view.state.facet(facet);
  } catch {
    return null;
  }
  if (!sets) return null;

  let decoValue = null;
  const list = Array.isArray(sets) ? sets : [sets];
  for (const set of list) {
    if (!set || typeof set.between !== 'function') continue;
    set.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value && value.widget) {
        decoValue = value;
        return false;
      }
    });
    if (decoValue) break;
  }
  if (!decoValue?.widget) return null;

  const Decoration = walkToDecoration(decoValue.constructor);
  const WidgetType = walkToWidgetType(decoValue.widget.constructor);
  if (!Decoration || !WidgetType) return null;
  return { Decoration, WidgetType, EditorView };
}

function makeWidgetClass(WidgetType, katex) {
  return class OrgnoteTexWidget extends WidgetType {
    constructor(body, display) {
      super();
      this.body = body;
      this.display = display;
    }
    eq(other) {
      return other && other.body === this.body && other.display === this.display;
    }
    toDOM() {
      const el = document.createElement(this.display ? 'div' : 'span');
      el.className = this.display
        ? 'orgnote-tex-display'
        : 'orgnote-tex-inline';
      try {
        katex.render(this.body, el, {
          throwOnError: false,
          displayMode: this.display,
          output: 'html',
        });
      } catch {
        el.textContent = this.body;
      }
      return el;
    }
    ignoreEvent() {
      return false;
    }
  };
}

function buildDecorations(view, Decoration, TexWidget) {
  const text = view.state.doc.toString();
  const caret = view.state.selection.main.head;
  const focused = view.hasFocus;
  const matches = findTexRanges(text);
  const ranges = [];
  for (const m of matches) {
    if (focused && caret >= m.from && caret <= m.to) continue;
    ranges.push(
      Decoration.replace({
        widget: new TexWidget(m.body, m.display),
      }).range(m.from, m.to)
    );
  }
  return Decoration.set(ranges, true);
}

function attachOverlay(view, katex) {
  if (view.__orgnoteTexInstalled || view.__orgnoteTexWatching) return;
  const EditorView = view.constructor;
  const sample =
    typeof EditorView.scrollIntoView === 'function'
      ? EditorView.scrollIntoView(0)
      : null;
  const StateEffect = sample && sample.constructor;
  if (!StateEffect || !StateEffect.appendConfig) {
    console.warn(
      '[orgnote-tex-delimiters] cannot append CodeMirror config on this build'
    );
    return;
  }

  const install = (ed) => {
    if (ed.__orgnoteTexInstalled) return true;
    const stolen = stealCM(ed);
    if (!stolen) return false;
    const TexWidget = makeWidgetClass(stolen.WidgetType, katex);
    const { Decoration } = stolen;
    const cache = { key: '', set: Decoration.none };
    const build = (v) => {
      const key = [
        v.state.doc.toString(),
        v.state.selection.main.head,
        v.hasFocus ? '1' : '0',
      ].join('\0');
      if (cache.key === key) return cache.set;
      cache.key = key;
      cache.set = buildDecorations(v, Decoration, TexWidget);
      return cache.set;
    };
    ed.__orgnoteTexInstalled = true;
    ed.dispatch({
      effects: StateEffect.appendConfig.of([
        EditorView.decorations.of(build),
        EditorView.atomicRanges.of(build),
      ]),
    });
    return true;
  };

  if (install(view)) return;

  view.__orgnoteTexWatching = true;
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.view.__orgnoteTexInstalled) return;
        install(update.view);
      })
    ),
  });
}

function editorViewFromDom(el) {
  const content =
    el.classList?.contains('cm-content') && el.cmView
      ? el
      : el.querySelector?.('.cm-content');
  return content?.cmView?.editorView || null;
}

function applyStyles(api, name, css) {
  if (api.ui?.applyStyles) api.ui.applyStyles(name, css);
  else api.utils?.applyScopedStyles?.(name, css);
}

function removeStyles(api, name) {
  if (api.ui?.removeStyles) api.ui.removeStyles(name);
  else api.utils?.removeScopedStyles?.(name);
}

function ensureKatexCss() {
  if (document.getElementById(KATEX_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = KATEX_CSS_ID;
  link.rel = 'stylesheet';
  link.href = KATEX_CSS;
  document.head.appendChild(link);
}

let observer = null;

export default {
  async onMounted(api) {
    let katexMod;
    try {
      katexMod = await import(/* @vite-ignore */ KATEX_ESM);
    } catch (err) {
      console.error('[orgnote-tex-delimiters] failed to load KaTeX', err);
      return;
    }
    const katex = katexMod.default || katexMod;
    ensureKatexCss();
    applyStyles(
      api,
      STYLE_ID,
      `
.orgnote-tex-display { display: block; width: 100%; overflow-x: auto; padding: 0.2em 0; }
.orgnote-tex-inline { display: inline; }
.orgnote-tex-display .katex-display { margin: 0.4em 0; }
`
    );

    const seen = new WeakSet();
    const scan = () => {
      document.querySelectorAll('.cm-editor, .cm-content').forEach((el) => {
        const view = editorViewFromDom(el);
        if (!view || seen.has(view)) return;
        seen.add(view);
        attachOverlay(view, katex);
      });
    };

    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  },

  async onUnmounted(api) {
    observer?.disconnect();
    observer = null;
    removeStyles(api, STYLE_ID);
  },
};
