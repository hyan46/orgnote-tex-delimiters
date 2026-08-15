import katex from 'katex';
import {
  editorViewFromContent,
  getStateEffect,
  makeInlineWidgetClass,
  stealCM,
} from './cm-deco.js';
import { caretInMatch, findTexRanges } from './find-tex.js';
import {
  anchorRect,
  caretOffset,
  collectText,
  lineRectsForMatch,
  rectsForMatch,
  unionRects,
} from './overlay.js';

export { findTexRanges };

export const manifest = {
  name: 'TeX delimiters',
  description:
    'Render \\( \\) inline, \\[ \\] display, and multiline $$ $$ with KaTeX',
  version: '0.8.0',
  category: 'extension',
  sourceType: 'git',
  sourceUrl: 'https://github.com/hyan46/orgnote-tex-delimiters',
  author: 'Hao Yan',
  keywords: ['editor', 'latex', 'katex', 'math'],
  reloadRequired: true,
};

const STYLE_ID = 'orgnote-tex-delimiters';
const LAYER_CLASS = 'orgnote-tex-layer';
const VERSION = '0.8.0';

const STATUS = (globalThis.__orgnoteTex = {
  version: VERSION,
  mounted: false,
  paints: 0,
  matches: 0,
  inlineMode: 'overlay',
  lastError: null,
});

const installedViews = new WeakSet();

function log(...args) {
  console.info('[orgnote-tex-delimiters]', ...args);
}

function editorBackground(content) {
  const editor = content.closest('.cm-editor') || content;
  const bgRaw = getComputedStyle(editor).backgroundColor;
  if (bgRaw && bgRaw !== 'rgba(0, 0, 0, 0)' && bgRaw !== 'transparent') {
    return bgRaw;
  }
  return 'var(--bg, #ffffff)';
}

function place(el, rect, scrollRect, scroller) {
  el.style.position = 'absolute';
  el.style.left = `${rect.left - scrollRect.left + scroller.scrollLeft}px`;
  el.style.top = `${rect.top - scrollRect.top + scroller.scrollTop}px`;
  el.style.width = `${Math.max(1, rect.width)}px`;
  el.style.height = `${Math.max(1, rect.height)}px`;
}

function buildInlineDecorations(view, Decoration, TexWidget) {
  const text = view.state.doc.toString();
  const caret = view.state.selection.main.head;
  const focused = view.hasFocus;
  const ranges = [];
  for (const m of findTexRanges(text)) {
    if (m.display) continue;
    if (focused && caret >= m.from && caret < m.to) continue;
    ranges.push(
      Decoration.replace({
        widget: new TexWidget(m.body, m.from),
      }).range(m.from, m.to)
    );
  }
  return Decoration.set(ranges, true);
}

function tryInstallInlineDecorations(content) {
  const view = editorViewFromContent(content);
  if (!view) return false;
  if (installedViews.has(view)) return true;
  try {
    const stolen = stealCM(view);
    if (!stolen) return false;
    const StateEffect = getStateEffect(stolen.EditorView);
    if (!StateEffect) return false;
    const TexWidget = makeInlineWidgetClass(stolen.WidgetType, katex);
    const { Decoration, EditorView } = stolen;
    const cache = { key: '', set: Decoration.none };
    const build = (v) => {
      const key = [
        v.state.doc.toString(),
        v.state.selection.main.head,
        v.hasFocus ? '1' : '0',
      ].join('\0');
      if (cache.key === key) return cache.set;
      cache.key = key;
      cache.set = buildInlineDecorations(v, Decoration, TexWidget);
      return cache.set;
    };
    const decoExt = EditorView.decorations.of(build);
    try {
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.atomicRanges
            ? [decoExt, EditorView.atomicRanges.of(build)]
            : [decoExt]
        ),
      });
    } catch {
      view.dispatch({
        effects: StateEffect.appendConfig.of([decoExt]),
      });
    }
    installedViews.add(view);
    STATUS.inlineMode = 'decorations';
    log('inline decorations attached');
    return true;
  } catch (err) {
    STATUS.lastError = String(err);
    log('inline decorations failed', err);
    return false;
  }
}

function paintInlineOverlay(match, coverRects, layer, scrollRect, scroller, bg) {
  for (let i = 0; i < coverRects.length; i++) {
    const cover = document.createElement('div');
    cover.className = 'orgnote-tex-cover';
    place(cover, coverRects[i], scrollRect, scroller);
    cover.style.background = bg;
    layer.appendChild(cover);
  }
  const anchor = anchorRect(coverRects);
  if (!anchor) return;
  const box = document.createElement('span');
  box.className = 'orgnote-tex-inline';
  box.style.position = 'absolute';
  box.style.left = `${anchor.left - scrollRect.left + scroller.scrollLeft}px`;
  box.style.top = `${anchor.top - scrollRect.top + scroller.scrollTop}px`;
  box.style.width = 'auto';
  box.style.height = 'auto';
  box.style.maxWidth = `${Math.max(anchor.width, scroller.clientWidth - 24)}px`;
  box.style.whiteSpace = 'normal';
  box.style.background = bg;
  box.style.lineHeight = '1.2';
  try {
    katex.render(match.body, box, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
    });
  } catch {
    box.textContent = match.body;
  }
  layer.appendChild(box);
}

function paintDisplayOverlay(coverRects, match, layer, scrollRect, scroller, bg) {
  const union = unionRects(coverRects);
  if (!union) return;
  for (let i = 0; i < coverRects.length; i++) {
    const cover = document.createElement('div');
    cover.className = 'orgnote-tex-cover';
    place(cover, coverRects[i], scrollRect, scroller);
    cover.style.background = bg;
    layer.appendChild(cover);
  }
  const box = document.createElement('div');
  box.className = 'orgnote-tex-display';
  place(box, union, scrollRect, scroller);
  box.style.height = 'auto';
  box.style.minHeight = `${Math.max(1, union.height)}px`;
  box.style.minWidth = `${Math.max(1, union.width)}px`;
  box.style.overflow = 'visible';
  box.style.background = 'transparent';
  try {
    katex.render(match.body, box, {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    });
  } catch {
    box.textContent = match.body;
  }
  layer.appendChild(box);
}

function paintContent(content) {
  const scroller = content.parentElement;
  if (!scroller) return 0;
  const decoOn = tryInstallInlineDecorations(content);
  let layer = scroller.querySelector(`:scope > .${LAYER_CLASS}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.className = LAYER_CLASS;
    layer.style.cssText =
      'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:20;';
    const pos = getComputedStyle(scroller).position;
    if (!pos || pos === 'static') scroller.style.position = 'relative';
    scroller.appendChild(layer);
  }
  layer.replaceChildren();

  const { text, parts } = collectText(content);
  const matches = findTexRanges(text);
  if (!parts.length || !matches.length) return matches.length;

  const caret = caretOffset(parts, document.getSelection(), content);
  const scrollRect = scroller.getBoundingClientRect();
  const bg = editorBackground(content);
  let painted = 0;

  for (const match of matches) {
    if (caretInMatch(caret, match)) continue;
    if (!match.display && decoOn) continue;

    const textRects = rectsForMatch(parts, match);
    const lineRects = lineRectsForMatch(content, parts, match);
    const coverRects = match.display
      ? lineRects.length
        ? lineRects
        : textRects
      : textRects.length
        ? textRects
        : lineRects;
    if (!coverRects.length) continue;

    if (match.display) {
      paintDisplayOverlay(coverRects, match, layer, scrollRect, scroller, bg);
    } else {
      paintInlineOverlay(match, coverRects, layer, scrollRect, scroller, bg);
    }
    painted += 1;
  }
  return painted;
}

function paintAll() {
  try {
    const contents = document.querySelectorAll('.cm-content');
    let total = 0;
    contents.forEach((el) => {
      total += paintContent(el);
    });
    STATUS.paints += 1;
    STATUS.matches = total;
    const mode = STATUS.inlineMode === 'decorations' ? 'inline widgets' : 'overlay';
    setBadge(
      contents.length
        ? `TeX delimiters v${VERSION} — ${mode}`
        : `TeX delimiters v${VERSION} loaded — open a note`
    );
  } catch (err) {
    STATUS.lastError = String(err);
    log('paint failed', err);
    setBadge('TeX delimiters error — see console');
  }
}

let paintTimer = 0;
function schedulePaint() {
  if (paintTimer) return;
  paintTimer = window.setTimeout(() => {
    paintTimer = 0;
    paintAll();
  }, 30);
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
      'position:fixed;z-index:99999;left:8px;bottom:8px;background:#14532d;color:#fff;padding:6px 10px;border-radius:8px;font:12px/1.3 system-ui,sans-serif;opacity:.94;';
    document.body.appendChild(el);
  }
  el.textContent = message;
}

let observer = null;
let pollTimer = 0;

export default {
  async onMounted(api) {
    STATUS.mounted = true;
    log('mounted', STATUS.version);
    applyStyles(
      api,
      STYLE_ID,
      `
.orgnote-tex-cover { pointer-events: none; }
.orgnote-tex-display, .orgnote-tex-inline { box-sizing: border-box; }
.orgnote-tex-inline { display: inline; }
.orgnote-tex-inline .katex { white-space: normal; }
.orgnote-tex-display .katex-display { margin: 0; }
.cm-content [class*="org-embedded"],
.cm-content .katex {
  position: relative;
  z-index: 40;
}
`
    );
    setBadge(`TeX delimiters v${VERSION} loaded — open a note`);
    observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const node =
          mutations[i].target.nodeType === 1
            ? mutations[i].target
            : mutations[i].target.parentElement;
        if (
          node &&
          node.closest &&
          node.closest(`.${LAYER_CLASS}, .orgnote-tex-inline, .orgnote-tex-display`)
        ) {
          continue;
        }
        schedulePaint();
        return;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener('selectionchange', schedulePaint);
    schedulePaint();
    pollTimer = window.setInterval(schedulePaint, 1000);
  },

  async onUnmounted(api) {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('selectionchange', schedulePaint);
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
    STATUS.mounted = false;
    document.querySelectorAll(`.${LAYER_CLASS}`).forEach((el) => el.remove());
    document.getElementById('orgnote-tex-badge')?.remove();
    removeStyles(api, STYLE_ID);
  },
};
