function walkToDecoration(ctor) {
  let current = ctor;
  for (let n = 0; n < 6 && current; n++) {
    if (typeof current.replace === 'function' && typeof current.set === 'function') {
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

export function editorViewFromContent(content) {
  const cv = content && content.cmView;
  if (!cv) return null;
  return cv.rootView?.view || cv.view || cv.editorView || null;
}

export function stealCM(view) {
  const EditorView = view.constructor;
  const sources = [];
  for (const name of ['decorations', 'outerDecorations']) {
    const facet = EditorView[name];
    if (!facet) continue;
    try {
      const sets = view.state.facet(facet);
      if (sets) sources.push(...(Array.isArray(sets) ? sets : [sets]));
    } catch {
      /* ignore */
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
  return { Decoration, WidgetType, EditorView };
}

export function getStateEffect(EditorView) {
  if (typeof EditorView.scrollIntoView !== 'function') return null;
  const sample = EditorView.scrollIntoView(0);
  const StateEffect = sample && sample.constructor;
  return StateEffect && StateEffect.appendConfig ? StateEffect : null;
}

export function makeInlineWidgetClass(WidgetType, katex) {
  return class OrgnoteTexInlineWidget extends WidgetType {
    constructor(body, from) {
      super();
      this.body = body;
      this.from = from;
    }
    eq(other) {
      return other && other.body === this.body;
    }
    toDOM(view) {
      const el = document.createElement('span');
      el.className = 'orgnote-tex-inline';
      el.style.display = 'inline';
      el.style.whiteSpace = 'normal';
      try {
        katex.render(this.body, el, {
          throwOnError: false,
          displayMode: false,
          output: 'html',
        });
      } catch {
        el.textContent = this.body;
      }
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        try {
          view.dispatch({
            selection: { anchor: this.from + 1, head: this.from + 1 },
          });
          view.focus();
        } catch {
          /* ignore */
        }
      });
      return el;
    }
    ignoreEvent() {
      return false;
    }
  };
}
