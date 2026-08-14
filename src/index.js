import katex from 'katex';
import { findTexRanges } from './find-tex.js';

export { findTexRanges };

export const manifest = {
  name: 'TeX delimiters',
  description:
    'Render \\( \\) inline, \\[ \\] display, and multiline $$ $$ with KaTeX',
  version: '0.3.0',
  category: 'extension',
  sourceType: 'git',
  sourceUrl: 'https://github.com/hyan46/orgnote-tex-delimiters',
  author: 'Hao Yan',
  keywords: ['editor', 'latex', 'katex', 'math'],
  reloadRequired: true,
};

const STYLE_ID = 'orgnote-tex-delimiters';
const STATUS = (globalThis.__orgnoteTex = {
  version: '0.3.0',
  mounted: false,
  views: 0,
  mode: null,
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

function stealCM(view) {
  const EditorView = view.constructor;
  const sources = [];
  for (const name of ['decorations', 'outerDecorations']) {
    const facet = EditorView[name];
    if (!facet) continue;
    try {
      const sets = view.state.facet(facet);
      if (sets) sources.push(...(Array.isArray(sets) ? sets : [sets]));
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

  const Decoration = walkToDecoration((decoValue || anyDeco)?.constructor);
  const WidgetType = decoValue?.widget
    ? walkToWidgetType(decoValue.widget.constructor)
    : null;
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

function installDecorationOverlay(view) {
  const stolen = stealCM(view);
  if (!stolen) return false;
  const EditorView = stolen.EditorView;
  const StateEffect = getStateEffect(EditorView);
  if (!StateEffect) return false;
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
  view.dispatch({
    effects: StateEffect.appendConfig.of([
      EditorView.decorations.of(build),
      EditorView.atomicRanges.of(build),
    ]),
  });
  STATUS.mode = 'decorations';
  setBadge(`TeX delimiters on (${STATUS.matches} formulas)`);
  return true;
}

function paintDomOverlay(view) {
  const scroll = view.scrollDOM || view.dom;
  if (!scroll) return;
  let layer = scroll.querySelector(':scope > .orgnote-tex-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'orgnote-tex-layer';
    layer.style.cssText =
      'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:6;';
    const pos = getComputedStyle(scroll).position;
    if (!pos || pos === 'static') scroll.style.position = 'relative';
    scroll.appendChild(layer);
  }
  layer.replaceChildren();

  const text = view.state.doc.toString();
  const matches = findTexRanges(text);
  STATUS.matches = matches.length;
  const caret = view.state.selection.main.head;
  const focused = view.hasFocus;
  const scrollRect = scroll.getBoundingClientRect();
  const bgRaw = getComputedStyle(view.contentDOM || view.dom).backgroundColor;
  const bg =
    bgRaw && bgRaw !== 'rgba(0, 0, 0, 0)' && bgRaw !== 'transparent'
      ? bgRaw
      : 'var(--bg, #fff)';

  for (const m of matches) {
    if (focused && caret >= m.from && caret <= m.to) continue;
    const start = view.coordsAtPos(m.from);
    const end = view.coordsAtPos(m.to);
    if (!start) continue;
    let left = start.left;
    let top = start.top;
    let right = start.right ?? start.left;
    let bottom = start.bottom;
    if (end) {
      left = Math.min(left, end.left);
      top = Math.min(top, end.top);
      right = Math.max(right, end.right ?? end.left);
      bottom = Math.max(bottom, end.bottom);
    }
    const box = document.createElement('div');
    box.className = m.display ? 'orgnote-tex-display' : 'orgnote-tex-inline';
    box.style.position = 'absolute';
    box.style.left = `${left - scrollRect.left + scroll.scrollLeft}px`;
    box.style.top = `${top - scrollRect.top + scroll.scrollTop}px`;
    box.style.minWidth = `${Math.max(1, right - left)}px`;
    box.style.background = bg;
    try {
      katex.render(m.body, box, {
        throwOnError: false,
        displayMode: m.display,
        output: 'html',
      });
    } catch {
      box.textContent = m.body;
    }
    layer.appendChild(box);
  }
}

function installDomOverlay(view) {
  const paint = () => {
    try {
      paintDomOverlay(view);
    } catch (err) {
      STATUS.lastError = String(err);
      log('paint failed', err);
    }
  };
  paint();
  const EditorView = view.constructor;
  const StateEffect = getStateEffect(EditorView);
  if (StateEffect && EditorView.updateListener) {
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of(paint)
      ),
    });
  } else {
    const obs = new MutationObserver(paint);
    obs.observe(view.contentDOM || view.dom, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  STATUS.mode = 'overlay';
  setBadge(`TeX delimiters overlay (${STATUS.matches} formulas)`);
}

function attachOverlay(view) {
  if (!view || view.__orgnoteTexAttached) return;
  if (!view.state || !view.dispatch) return;
  view.__orgnoteTexAttached = true;
  STATUS.views += 1;
  log('attached view', view);
  try {
    if (installDecorationOverlay(view)) return;
    log('decoration steal failed, using DOM overlay', STATUS.lastError);
    installDomOverlay(view);
  } catch (err) {
    STATUS.lastError = String(err);
    log('attach failed', err);
    view.__orgnoteTexAttached = false;
  }
}

function editorViewFromDom(el) {
  const content = el.classList?.contains('cm-content')
    ? el
    : el.querySelector?.('.cm-content');
  const editor = el.classList?.contains('cm-editor')
    ? el
    : el.closest?.('.cm-editor') || el;

  const cmView = content?.cmView || editor?.cmView;
  const fromOld =
    cmView?.rootView?.view || cmView?.view || cmView?.editorView;
  if (fromOld?.dispatch && fromOld.state) return fromOld;

  const cmTile = content?.cmTile || editor?.cmTile;
  const fromTile = cmTile?.root?.view;
  if (fromTile?.dispatch && fromTile.state) return fromTile;

  for (const node of [content, editor, el]) {
    if (!node) continue;
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (val?.state && val.dispatch && val.coordsAtPos) return val;
      if (val?.rootView?.view?.dispatch) return val.rootView.view;
      if (val?.view?.state && val.view.dispatch) return val.view;
      if (val?.root?.view?.dispatch) return val.root.view;
    }
  }
  return null;
}

function hookOfficialEditorApi(api) {
  const add =
    api.editor?.extensions?.add ||
    api.core?.useEditor?.()?.addExtensions;
  if (typeof add !== 'function') {
    log('no editor.extensions.add on this API');
    return;
  }
  add((params) => {
    const tryView = () => {
      const view = params.editorViewGetter?.();
      if (view) attachOverlay(view);
    };
    queueMicrotask(tryView);
    setTimeout(tryView, 0);
    setTimeout(tryView, 50);
    setTimeout(tryView, 300);
    return [];
  });
  log('registered editor extension hook');
}

function applyStyles(api, name, css) {
  if (api.ui?.applyStyles) api.ui.applyStyles(name, css);
  else api.utils?.applyScopedStyles?.(name, css);
}

function removeStyles(api, name) {
  if (api.ui?.removeStyles) api.ui.removeStyles(name);
  else api.utils?.removeScopedStyles?.(name);
}

function setBadge(message) {
  let el = document.getElementById('orgnote-tex-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'orgnote-tex-badge';
    el.style.cssText =
      'position:fixed;z-index:99999;left:8px;bottom:8px;background:#14532d;color:#fff;padding:6px 10px;border-radius:8px;font:12px/1.3 system-ui,sans-serif;opacity:.92;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = message;
}

let observer = null;

export default {
  async onMounted(api) {
    STATUS.mounted = true;
    log('mounted', STATUS.version, api?.editor ? 'legacy-api' : 'core-api');
    applyStyles(
      api,
      STYLE_ID,
      `
.orgnote-tex-display { display: block; width: 100%; overflow-x: auto; padding: 0.2em 0; }
.orgnote-tex-inline { display: inline; }
.orgnote-tex-display .katex-display { margin: 0.4em 0; }
`
    );
    setBadge('TeX delimiters v0.3 loaded — open a note');
    hookOfficialEditorApi(api);

    const scan = () => {
      document.querySelectorAll('.cm-editor, .cm-content').forEach((el) => {
        const view = editorViewFromDom(el);
        if (view) attachOverlay(view);
      });
    };
    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    setTimeout(scan, 500);
    setTimeout(scan, 1500);
  },

  async onUnmounted(api) {
    observer?.disconnect();
    observer = null;
    STATUS.mounted = false;
    document.getElementById('orgnote-tex-badge')?.remove();
    removeStyles(api, STYLE_ID);
  },
};
