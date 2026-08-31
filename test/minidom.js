/* A mini-DOM just large enough to boot src/main.js in Node. */
export function installDom({ hostname = 'localhost', search = '', storage } = {}) {
  const frames = [];
  const intervals = [];

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.listeners = new Map();
      this._text = '';
      this.hidden = false;
      this.className = '';
      this.style = {};
      this.attributes = {};
      this.classList = {
        _s: new Set(),
        add: (c) => this.classList._s.add(c),
        remove: (c) => this.classList._s.delete(c),
        contains: (c) => this.classList._s.has(c),
      };
    }
    get firstChild() { return this.children[0] || null; }
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
    }
    set textContent(v) { this._text = String(v); this.children = []; }
    append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
    appendChild(n) { this.append(n); return n; }
    removeChild(n) { this.children = this.children.filter((c) => c !== n); return n; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatch(type, ev = {}) {
      (this.listeners.get(type) || []).forEach((fn) => fn({ preventDefault() {}, ...ev }));
    }
    select() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 420, height: 860 }; }
    /** Depth-first search for a descendant button by its label. */
    findButton(label) {
      if (this.tagName === 'BUTTON' && this.textContent === label) return this;
      for (const c of this.children) { const hit = c.findButton?.(label); if (hit) return hit; }
      return null;
    }
    buttons(out = []) {
      if (this.tagName === 'BUTTON') out.push(this.textContent);
      for (const c of this.children) c.buttons?.(out);
      return out;
    }
  }

  const ids = {};
  for (const id of ['lcd', 'panel', 'panel-eyebrow', 'panel-title', 'panel-stats', 'panel-note', 'panel-actions', 'panel-footer']) {
    ids[id] = new El('div');
    ids[id].id = id;
  }
  ids.panel.hidden = true;
  ids['panel-note'].hidden = true;
  ids['panel-footer'].hidden = true;
  // Nest so findButton from #panel reaches the action buttons.
  ids.panel.append(ids['panel-eyebrow'], ids['panel-title'], ids['panel-stats'], ids['panel-note'], ids['panel-actions'], ids['panel-footer']);

  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect() {}, fillText() {},
  };
  const canvas = new El('canvas');
  canvas.id = 'screen';
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext = () => ctx;
  ids.screen = canvas;

  const body = new El('body');

  global.window = {
    devicePixelRatio: 2,
    addEventListener() {},
    localStorage: storage,
  };
  global.document = {
    readyState: 'complete',
    hidden: false,
    body,
    getElementById: (id) => ids[id] || null,
    createElement: (tag) => new El(tag),
    addEventListener() {},
  };
  global.getComputedStyle = () => ({
    getPropertyValue: (n) => ({ '--lcd-on': '#7dff8a', '--lcd-bg': '#0b1a0f', '--lcd-ghost': 'rgba(125,255,138,.08)' }[n] ?? ''),
  });
  global.location = { hostname, search };
  global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  global.cancelAnimationFrame = () => {};
  global.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  global.clearInterval = () => {};

  const clipboard = { written: [] };
  // Node 22 exposes `navigator` as a getter-only global, so it has to be
  // redefined rather than assigned.
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: { clipboard: { writeText: async (t) => { clipboard.written.push(t); } } },
  });

  return {
    ids, canvas, frames, intervals, clipboard,
    /** Run n animation frames at 60Hz. */
    pump(n) {
      let t = 0;
      for (let i = 0; i < n; i++) {
        const fn = frames.shift();
        if (!fn) break;
        t += 1000 / 60;
        fn(t);
      }
    },
    tickIntervals() { intervals.forEach((fn) => fn()); },
    panelText() { return ids.panel.hidden ? null : `${ids['panel-eyebrow'].textContent} | ${ids['panel-title'].textContent}`; },
    buttons() { return ids.panel.hidden ? [] : ids['panel-actions'].buttons(); },
    click(label) {
      const b = ids['panel-actions'].findButton(label);
      if (!b) throw new Error(`no button "${label}"; have ${JSON.stringify(ids['panel-actions'].buttons())}`);
      b.dispatch('click');
      return b;
    },
    stats() {
      const out = {};
      const kids = ids['panel-stats'].children;
      for (let i = 0; i < kids.length; i += 2) out[kids[i].textContent] = kids[i + 1]?.textContent;
      return out;
    },
  };
}
