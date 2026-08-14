import { caretInMatch } from './find-tex.js';

export { caretInMatch };

const SKIP_SEL =
  '.katex,.org-embedded-latexfragment,.org-embedded-latexenvironment,.org-embedded-exportblock,.orgnote-tex-layer';

export function shouldSkip(el) {
  return !!(el && el.closest && el.closest(SKIP_SEL));
}

function walkText(node, parts) {
  if (!node) return;
  if (node.nodeType === 3) {
    if (shouldSkip(node.parentElement)) return;
    parts.push({ node, text: node.nodeValue || '', start: 0 });
    return;
  }
  if (node.nodeType !== 1) return;
  if (shouldSkip(node)) return;
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) walkText(children[i], parts);
}

export function assignStarts(parts) {
  let offset = 0;
  for (const part of parts) {
    part.start = offset;
    offset += part.text.length;
  }
  return parts;
}

/** Join .cm-line text with explicit newlines so \\[ \\] spans lines. */
export function collectText(root) {
  const parts = [];
  const lines = root.querySelectorAll ? root.querySelectorAll('.cm-line') : [];
  if (lines.length) {
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) parts.push({ node: null, text: '\n', start: 0 });
      walkText(lines[i], parts);
    }
  } else {
    walkText(root, parts);
  }
  assignStarts(parts);
  return { text: parts.map((p) => p.text).join(''), parts };
}

export function pointFromParts(parts, index, edge) {
  let lastReal = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.node) continue;
    lastReal = part;
    const end = part.start + part.text.length;
    if (index < end || (index === end && edge === 'end')) {
      return {
        node: part.node,
        offset: Math.max(0, Math.min(part.text.length, index - part.start)),
      };
    }
  }
  if (lastReal) {
    return { node: lastReal.node, offset: lastReal.text.length };
  }
  return null;
}

export function caretOffset(parts, sel, root) {
  if (!sel || !sel.rangeCount || !root) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  let node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType !== 3) {
    if (node.childNodes[offset] && node.childNodes[offset].nodeType === 3) {
      node = node.childNodes[offset];
      offset = 0;
    } else {
      const prev = node.childNodes[offset - 1];
      if (prev && prev.nodeType === 3) {
        node = prev;
        offset = prev.nodeValue ? prev.nodeValue.length : 0;
      } else {
        return null;
      }
    }
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.node === node) {
      return part.start + Math.max(0, Math.min(offset, part.text.length));
    }
  }
  return null;
}

function isHidden(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  const view = el && el.ownerDocument && el.ownerDocument.defaultView;
  if (!el || !view) return false;
  const style = view.getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

/**
 * Per-text-node rects. A single Range that starts on a display:none `\\(`
 * often returns no client rects even when the formula body is visible.
 */
export function rectsForMatch(parts, match) {
  const rects = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.node || !part.text) continue;
    const partEnd = part.start + part.text.length;
    if (partEnd <= match.from || part.start >= match.to) continue;
    if (isHidden(part.node)) continue;
    const localFrom = Math.max(0, match.from - part.start);
    const localTo = Math.min(part.text.length, match.to - part.start);
    if (localFrom >= localTo) continue;
    const range = part.node.ownerDocument.createRange();
    try {
      range.setStart(part.node, localFrom);
      range.setEnd(part.node, localTo);
    } catch {
      continue;
    }
    const list = range.getClientRects();
    for (let j = 0; j < list.length; j++) {
      const r = list[j];
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
  }
  return rects;
}

export function lineRectsForMatch(root, parts, match) {
  const seen = new Set();
  const rects = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.node) continue;
    const partEnd = part.start + part.text.length;
    if (partEnd <= match.from || part.start >= match.to) continue;
    const line = part.node.parentElement && part.node.parentElement.closest
      ? part.node.parentElement.closest('.cm-line')
      : null;
    if (!line || seen.has(line) || lineHasBuiltinWidget(line)) continue;
    seen.add(line);
    const r = line.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push(r);
  }
  return rects;
}

export function lineHasBuiltinWidget(line) {
  if (!line || !line.querySelector) return false;
  return !!line.querySelector(
    '[class*="org-embedded"],.katex,.cm-widgetBuffer'
  );
}

export function unionRects(rects) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
