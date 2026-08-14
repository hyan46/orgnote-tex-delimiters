import katex from 'katex';
import { findTexRanges } from './find-tex.js';

export { findTexRanges };

export const manifest = {
  name: 'TeX delimiters',
  description:
    'Render \\( \\) inline, \\[ \\] display, and multiline $$ $$ with KaTeX',
  version: '0.4.0',
  category: 'extension',
  sourceType: 'git',
  sourceUrl: 'https://github.com/hyan46/orgnote-tex-delimiters',
  author: 'Hao Yan',
  keywords: ['editor', 'latex', 'katex', 'math'],
  reloadRequired: true,
};

const STYLE_ID = 'orgnote-tex-delimiters';
const LAYER_CLASS = 'orgnote-tex-layer';
const SKIP_SEL =
  '.katex,.org-embedded-latexfragment,.org-embedded-latexenvironment,.org-embedded-exportblock,.orgnote-tex-layer';

const STATUS = (globalThis.__orgnoteTex = {
  version: '0.4.0',
  mounted: false,
  paints: 0,
  matches: 0,
  lastError: null,
});

function log(...args) {
  console.info('[orgnote-tex-delimiters]', ...args);
}

function shouldSkip(el) {
  return !!(el && el.closest && el.closest(SKIP_SEL));
}

function collectText(root) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      if (shouldSkip(node.parentElement)) return;
      parts.push({ node, text: node.nodeValue || '', start: 0 });
      return;
    }
    if (node.nodeType !== 1) return;
    if (shouldSkip(node)) return;
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) walk(children[i]);
  };
  walk(root);
  let offset = 0;
  for (const part of parts) {
    part.start = offset;
    offset += part.text.length;
  }
  return { text: parts.map((p) => p.text).join(''), parts };
}

function pointFromParts(parts, index, edge) {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const end = part.start + part.text.length;
    if (index < end || (index === end && (edge === 'end' || i === parts.length - 1))) {
      return { node: part.node, offset: Math.max(0, Math.min(part.text.length, index - part.start)) };
    }
  }
  const last = parts[parts.length - 1];
  return last ? { node: last.node, offset: last.text.length } : null;
}

function paintContent(content) {
  const scroller = content.parentElement;
  if (!scroller) return 0;
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

  const scrollRect = scroller.getBoundingClientRect();
  const editor = content.closest('.cm-editor') || content;
  const bgRaw = getComputedStyle(editor).backgroundColor;
  const bg =
    bgRaw && bgRaw !== 'rgba(0, 0, 0, 0)' && bgRaw !== 'transparent'
      ? bgRaw
      : 'var(--bg, #ffffff)';

  for (const match of matches) {
    const start = pointFromParts(parts, match.from, 'start');
    const end = pointFromParts(parts, match.to, 'end');
    if (!start || !end) continue;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      continue;
    }
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const box = document.createElement('div');
    box.className = match.display ? 'orgnote-tex-display' : 'orgnote-tex-inline';
    box.style.position = 'absolute';
    box.style.left = `${left - scrollRect.left + scroller.scrollLeft}px`;
    box.style.top = `${top - scrollRect.top + scroller.scrollTop}px`;
    box.style.minWidth = `${Math.max(1, right - left)}px`;
    box.style.background = bg;
    try {
      katex.render(match.body, box, {
        throwOnError: false,
        displayMode: match.display,
        output: 'html',
      });
    } catch {
      box.textContent = match.body;
    }
    layer.appendChild(box);
  }
  return matches.length;
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
    setBadge(
      contents.length
        ? `TeX delimiters v0.4 — ${total} formula${total === 1 ? '' : 's'}`
        : 'TeX delimiters v0.4 loaded — open a note'
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
.orgnote-tex-display { display: block; overflow-x: auto; padding: 0.15em 0; }
.orgnote-tex-inline { display: inline-block; }
.orgnote-tex-display .katex-display { margin: 0.3em 0; }
`
    );
    setBadge('TeX delimiters v0.4 loaded — open a note');
    observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const node =
          mutations[i].target.nodeType === 1
            ? mutations[i].target
            : mutations[i].target.parentElement;
        if (node && node.closest && node.closest(`.${LAYER_CLASS}`)) continue;
        schedulePaint();
        return;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    schedulePaint();
    pollTimer = window.setInterval(schedulePaint, 1000);
  },

  async onUnmounted(api) {
    observer?.disconnect();
    observer = null;
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
    STATUS.mounted = false;
    document.querySelectorAll(`.${LAYER_CLASS}`).forEach((el) => el.remove());
    document.getElementById('orgnote-tex-badge')?.remove();
    removeStyles(api, STYLE_ID);
  },
};
