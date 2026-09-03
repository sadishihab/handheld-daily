/**
 * Input -- turns touches and keys into a pair of orders, one per boat.
 *
 * The game never sees an event; it sees `{left, right}` once per fixed step,
 * where each is a dock index to send that boat to, or null for "no new order".
 * That keeps input replayable: recording the pair each step is enough to
 * reproduce a run exactly. See docs/DETERMINISM.md.
 *
 *
 * WHY ORDERS AND NOT A HELD DIRECTION
 * -----------------------------------
 * There are two boats and, on a phone, one thumb. A held rudder needs a
 * continuous stream of input per boat, and a thumb can only produce one
 * stream, so a held-direction scheme forces a mode: select a boat, steer it,
 * and leave the other one parked. Measured against a model of a hand, that
 * scheme loses 98% of its runs and 39% of its losses are a parked boat with
 * nothing to do.
 *
 * An order is discrete and it persists. The half of the panel you touch picks
 * the boat -- so the control is addressed by where you are already looking,
 * with no mode to get wrong -- and the column picks the dock. Lift your thumb
 * and that boat carries on running its errand while you deal with the other
 * side. Measured the same way, one thumb scores 0.98x of two thumbs: the
 * control is not what limits a phone player.
 *
 * Holding still works and still steers: a held pointer re-issues its order
 * every step, so sliding a thumb along the panel drags the boat with it.
 *
 *
 * THE TWO SCHEMES
 * ---------------
 * Both are shipped and switchable, because the argument between them is about
 * feel and the harness can only settle the half of it that is arithmetic.
 *
 *   'side'    The half of the panel you touch picks the boat; the column
 *             picks the dock. Two boats, addressed one at a time.
 *   'mirror'  One input, both boats. The column picks a dock index and BOTH
 *             boats take it, each measured from its own shore, so the pair is
 *             always a mirror image. There is no boat to select and nothing to
 *             cross to -- and no way to send one boat home while the other
 *             waits at the ship, which is the price.
 *
 * Only this module knows the difference. The simulation still receives an
 * order per side; mirror mode simply fills in both.
 */

/** Scheme ids, in the order the start-screen toggle cycles them. */
export const CONTROL_SCHEMES = ['side', 'mirror'];

/** What the toggle calls each one. */
export const SCHEME_LABEL = {
  side: 'ONE AT A TIME',
  mirror: 'BOTH TOGETHER',
};

export const DEFAULT_SCHEME = 'side';

/** Coerce anything -- a query param, a stored string -- to a real scheme. */
export function normaliseScheme(value) {
  return CONTROL_SCHEMES.includes(value) ? value : DEFAULT_SCHEME;
}

/**
 * Stop the browser treating the panel like a document: no pinch zoom, no
 * double-tap zoom, no long-press menu. Kept here because they are all input
 * concerns, and because iOS Safari ignores user-scalable=no in the viewport
 * meta tag, so this has to be done in script.
 */
export function blockBrowserGestures() {
  document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });

  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) event.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );

  document.addEventListener('contextmenu', (event) => event.preventDefault());
}

/**
 * @param {HTMLElement} target Element the player touches -- the canvas.
 * @param {object} options
 * @param {(clientX: number) => {side: number, dock: number}} options.orderAt
 *   Maps a viewport X to the boat and dock it addresses. Supplied by the
 *   renderer, which is the only thing that knows where the board was drawn.
 * @param {number} options.docks Docks per side, for the keyboard's range.
 * @param {number} [options.startDock] Where each boat begins, so the keyboard
 *   nudges from the same dock the simulation started the boat on.
 * @param {'side'|'mirror'} [options.scheme] Which control scheme to start in.
 */
export function createInput(target, { orderAt, docks, startDock = docks - 1, scheme = DEFAULT_SCHEME }) {
  let mode = normaliseScheme(scheme);
  // Live object handed to the simulation each step. Mutated in place rather
  // than reallocated, and only ever between frames -- DOM events cannot fire
  // partway through the loop's synchronous run of fixed steps, so the value
  // is stable across every step of a given frame.
  const state = { left: null, right: null };

  /** pointerId -> {side, dock}. A Map so multi-touch is tracked per finger. */
  const pointers = new Map();

  /**
   * What the keyboard last asked each boat to do.
   *
   * The keyboard nudges by a dock at a time, so it has to remember where it
   * was aiming. Touch writes into this too: otherwise a tap would move the
   * boat and the next key press would yank it back to wherever the keyboard
   * thought it had left it.
   */
  const aim = [startDock, startDock];
  /** Orders the keyboard raised this frame, cleared once handed over. */
  const pending = [null, null];

  const clamp = (dock) => (dock < 0 ? 0 : dock >= docks ? docks - 1 : dock);

  /**
   * Write one order into the pair, which is the only place the two schemes
   * differ: 'side' addresses the boat the touch landed on, 'mirror' gives the
   * dock to both. Everything downstream -- the standing order, the simulation,
   * the replay -- is identical either way.
   */
  function issue(order, side, dock) {
    if (mode === 'mirror') {
      order[0] = dock;
      order[1] = dock;
      aim[0] = dock;
      aim[1] = dock;
      return;
    }
    order[side] = dock;
    aim[side] = dock;
  }

  function recompute() {
    const order = [pending[0], pending[1]];
    for (const held of pointers.values()) issue(order, held.side, held.dock);
    state.left = order[0];
    state.right = order[1];
    pending[0] = null;
    pending[1] = null;
  }

  function onPointerDown(event) {
    pointers.set(event.pointerId, orderAt(event.clientX));
    recompute();
    event.preventDefault();
  }

  function onPointerMove(event) {
    // Sliding a held finger along the panel drags that boat with it.
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, orderAt(event.clientX));
    recompute();
  }

  function onPointerUp(event) {
    // The order stands after the thumb lifts. That is the point of the
    // scheme: the boat keeps running the errand while you work the other side.
    if (!pointers.delete(event.pointerId)) return;
    recompute();
  }

  /**
   * Desktop keys.
   *
   * Side-addressed: A/D work the left boat, the arrows the right one, and on
   * each side the outward key is the one that points at that boat's own
   * shore -- so "away from the ship" is always away from the middle of the
   * keyboard as well as away from the middle of the screen. Mirror mode has
   * only one boat to speak of, and its mapping is in the branch below.
   */
  function keyOrder(code) {
    // Mirror mode has no left boat and no right boat, only a distance from
    // the shores, so every key means out or in. Left keys pull the pair out
    // toward the land -- which does move the left boat left -- and right keys
    // push it back in toward the ship.
    if (mode === 'mirror') {
      switch (code) {
        case 'KeyA': case 'ArrowLeft': return [0, clamp(aim[0] - 1)];
        case 'KeyD': case 'ArrowRight': return [0, clamp(aim[0] + 1)];
        case 'KeyW': case 'ArrowUp': return [0, 0];
        case 'KeyS': case 'ArrowDown': return [0, docks - 1];
        default: return null;
      }
    }
    switch (code) {
      case 'KeyA': return [0, clamp(aim[0] - 1)];
      case 'KeyD': return [0, clamp(aim[0] + 1)];
      case 'KeyW': return [0, 0];
      case 'KeyS': return [0, docks - 1];
      case 'ArrowRight': return [1, clamp(aim[1] - 1)];
      case 'ArrowLeft': return [1, clamp(aim[1] + 1)];
      case 'ArrowUp': return [1, 0];
      case 'ArrowDown': return [1, docks - 1];
      default: return null;
    }
  }

  function onKeyDown(event) {
    const order = keyOrder(event.code);
    if (!order) return;
    const [side, dock] = order;
    const pair = [null, null];
    issue(pair, side, dock);
    pending[0] = pair[0];
    pending[1] = pair[1];
    recompute();
    event.preventDefault();
  }

  /** Drop everything held -- otherwise a finger lifted while the tab is
   *  hidden stays in the map and keeps re-issuing an order on return. */
  function releaseAll() {
    pointers.clear();
    pending[0] = null;
    pending[1] = null;
    aim[0] = startDock;
    aim[1] = startDock;
    state.left = null;
    state.right = null;
  }

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  return {
    /** Live order pair. Read each fixed step. */
    state,
    get scheme() {
      return mode;
    },
    /**
     * Swap schemes between runs. Everything held is dropped first: a finger
     * still down when the scheme changes would otherwise re-issue its old
     * order under the new rules.
     */
    setScheme(next) {
      mode = normaliseScheme(next);
      releaseAll();
      return mode;
    },
    /**
     * Hand the current orders to one step and clear the one-shot ones.
     *
     * A key press is an event, not a held state: it must reach exactly one
     * step, or holding a key would order the boat once per frame at whatever
     * rate the display happens to run -- which is a frame-rate dependency in
     * the input path, and the one place the fixed timestep cannot protect
     * the simulation from it.
     */
    consume() {
      const order = { left: state.left, right: state.right };
      // A held pointer keeps issuing; a key press does not.
      recompute();
      return order;
    },
    /** Immutable copy, for recording or replaying a run. */
    snapshot() {
      return { left: state.left, right: state.right };
    },
    releaseAll,
  };
}
