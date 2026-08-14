import katex from 'katex';
import { findTexRanges } from './find-tex.js';

export { findTexRanges };

export const manifest = {
  name: 'TeX delimiters',
  description:
    'Render \\( \\) inline, \\[ \\] display, and multiline $$ $$ with KaTeX',
  version: '0.2.0',
  category: 'extension',
  sourceType: 'git',
  sourceUrl: 'https://github.com/hyan46/orgnote-tex-delimiters',
  author: 'Hao Yan',
  keywords: ['editor', 'latex', 'katex', 'math'],
  reloadRequired: true,
};

const STYLE_ID = 'orgnote-tex-delimiters';
const STATUS = (globalThis.__orgnoteTex = {
  version: '0.2.0',
  mounted: false,
  views: 0,
  installed: 0,
  stolen: false,
  lastError: null,
  matches: 0,
});

function log(...args) {
  console.info('[orgnote-tex-delimiters]', ...args);
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

function resolveDecoSet(set, view) {
  try {
    if (typeof set === 'function') set = set(view);
  } catch {
    return null;
  }
  return set && typeof set.between === 'function' ? set : null;
}

function findWidgetOnElement(el) {
  if (!el) return null;
  const direct = el.cmView?.widget;
  if (direct && typeof direct.toDOM === 'function') return direct;
  for (const key of Object.keys(el)) {
    const val = el[key];
    if (val && val.widget && typeof val.widget.toDOM === 'function') {
      return val.widget;
    }
    if (val && typeof val.toDOM === 'function' && val.eq) return val;
  }
  return null;
}

function stealWidgetTypeFromDom(view) {
  const root = view.dom || view.contentDOM;
  if (!root?.querySelectorAll) return null;
  const nodes = root.querySelectorAll('*');
  for (let i = 0; i < nodes.length; i++) {
    const widget = findWidgetOnElement(nodes[i]);
    if (widget) return walkToWidgetType(widget.constructor);
  }
  return null;
}

function stealCM(view) {
  const EditorView = view.constructor;
  const sources = [];
  for (const name of ['decorations', 'outerDecorations']) {
    const facet = EditorView[name];
    if (!facet) continue;
    try {
      const sets = view.state.facet(facet);
      if (sets) {
        if (Array.isArray(sets)) sources.push(...sets);
        else sources.push(sets);
      }
    } catch (err) {
      STATUS.lastError = String(err);
    }
  }

  let decoValue = null;
  let anyDeco = null;
  for (const raw of sources) {
    const set = resolveDecoSet(raw, view);
    if (!set) continue;
    set.between(0, view.state.doc.length, (_from, _to, value) => {
      if (!value) return;
      if (!anyDeco) anyDeco = value;
      if (value.widget) {
        decoValue = value;
        return false;
      }
    });
    if (decoValue) break;
  }

  const Decoration = walkToDecoration(
    (decoValue || anyDeco)?.constructor
  );
  let WidgetType = decoValue?.widget
    ? walkToWidgetType(decoValue.widget.constructor)
    : stealWidgetTypeFromDom(view);

  if (!Decoration || !WidgetType) return null;
  STATUS.stolen = true;
  return { Decoration, WidgetType, EditorView };
}

function makeWidgetClass(WidgetType) {
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
  STATUS.matches = matches.length;
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

function getStateEffect(EditorView) {
  if (typeof EditorView.scrollIntoView !== 'function') return null;
  const sample = EditorView.scrollIntoView(0);
  const StateEffect = sample && sample.constructor;
  return StateEffect && StateEffect.appendConfig ? StateEffect : null;
}

function attachOverlay(view) {
  if (view.__orgnoteTexInstalled) return true;
  const EditorView = view.constructor;
  const StateEffect = getStateEffect(EditorView);
  if (!StateEffect) {
    STATUS.lastError = 'StateEffect.appendConfig missing';
    log(STATUS.lastError);
    return false;
  }

  const stolen = stealCM(view);
  if (!stolen) {
    if (!view.__orgnoteTexWatching) {
      view.__orgnoteTexWatching = true;
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.updateListener.of((update) => {
            if (!update.view.__orgnoteTexInstalled) attachOverlay(update.view);
          })
        ),
      });
    }
    return false;
  }

  const TexWidget = makeWidgetClass(stolen.WidgetType);
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

  view.__orgnoteTexInstalled = true;
  STATUS.installed += 1;
  view.dispatch({
    effects: StateEffect.appendConfig.of([
      EditorView.decorations.of(build),
      EditorView.atomicRanges.of(build),
    ]),
  });
  log('installed overlay', { matches: STATUS.matches });
  return true;
}

function editorViewFromDom(el) {
  const content = el.classList?.contains('cm-content')
    ? el
    : el.querySelector?.('.cm-content');
  if (!content) return null;
  if (content.cmView?.editorView) return content.cmView.editorView;
  for (const key of Object.keys(content)) {
    const val = content[key];
    if (val?.editorView?.dispatch) return val.editorView;
    if (val?.state && val.dispatch && val.dom) return val;
  }
  return null;
}

function applyStyles(api, name, css) {
  if (api.ui?.applyStyles) api.ui.applyStyles(name, css);
  else api.utils?.applyScopedStyles?.(name, css);
}

function removeStyles(api, name) {
  if (api.ui?.removeStyles) api.ui.removeStyles(name);
  else api.utils?.removeScopedStyles?.(name);
}

function toast(message) {
  try {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText =
      'position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);background:#1f2937;color:#fff;padding:8px 14px;border-radius:8px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  } catch {
    /* ignore */
  }
}

let observer = null;

export default {
  async onMounted(api) {
    STATUS.mounted = true;
    log('mounted', STATUS.version);
    applyStyles(
      api,
      STYLE_ID,
      `
.orgnote-tex-display { display: block; width: 100%; overflow-x: auto; padding: 0.2em 0; }
.orgnote-tex-inline { display: inline; }
.orgnote-tex-display .katex-display { margin: 0.4em 0; }
`
    );
    toast('TeX delimiters loaded — open a note with \\( or \\[');

    const seen = new WeakSet();
    const scan = () => {
      document.querySelectorAll('.cm-editor, .cm-content').forEach((el) => {
        const view = editorViewFromDom(el);
        if (!view) return;
        STATUS.views += 1;
        if (seen.has(view) && view.__orgnoteTexInstalled) return;
        seen.add(view);
        setTimeout(() => attachOverlay(view), 0);
      });
    };

    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  },

  async onUnmounted(api) {
    observer?.disconnect();
    observer = null;
    STATUS.mounted = false;
    removeStyles(api, STYLE_ID);
  },
};
