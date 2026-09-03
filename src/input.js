/**
 * Input -- turns touches and keys into one order per fixed step.
 *
 * The game never sees an event; it sees a dock index once per fixed step, or
 * null for "no new order". That keeps input replayable: recording the value
 * each step is enough to reproduce a run exactly. See docs/DETERMINISM.md.
 *
 *
 * WHY AN ORDER AND NOT A HELD DIRECTION
 * ------------------------------------
 * A held rudder needs a continuous stream of input -- press and hold to go
 * left, keep holding, let go at the right moment. That is the thing a thumb
 * on glass is worst at, because there is no edge to feel and no detent to
 * stop at, and it means the player's attention is on the boat rather than on
 * the ship they are reading.
 *
 * An order is discrete and it persists. The column you touch picks the dock,
 * the boat sets off, and it keeps going after you lift -- so a tap is a whole
 * instruction and the time between taps is time spent watching the deck.
 *
 * Holding still works and still steers: a held pointer re-issues its order
 * every step, so sliding a thumb along the panel drags the boat with it.
 */

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
 * @param {(clientX: number) => number} options.orderAt Maps a viewport X to
 *   the dock it addresses. Supplied by the renderer, which is the only thing
 *   that knows where the board was drawn.
 * @param {number} options.docks How many docks there are, for the keyboard.
 * @param {number} [options.startDock] Where the boat begins, so the keyboard
 *   nudges from the same dock the simulation started it on.
 */
export function createInput(target, { orderAt, docks, startDock = docks - 1 }) {
  // Live value handed to the simulation each step. Held in a one-field object
  // rather than a bare variable so `state` can be read by reference, and only
  // ever written between frames -- DOM events cannot fire partway through the
  // loop's synchronous run of fixed steps.
  const state = { order: null };

  /** pointerId -> dock. A Map so a second finger does not lose the first. */
  const pointers = new Map();

  /**
   * What the keyboard last asked for.
   *
   * The keyboard nudges by a dock at a time, so it has to remember where it
   * was aiming. Touch writes into this too: otherwise a tap would move the
   * boat and the next key press would yank it back to wherever the keyboard
   * thought it had left it.
   */
  let aim = startDock;
  /** An order the keyboard raised this frame, cleared once handed over. */
  let pending = null;

  const clamp = (dock) => (dock < 0 ? 0 : dock >= docks ? docks - 1 : dock);

  function recompute() {
    let order = pending;
    // Last finger down wins, which is what a second thumb landing on the
    // glass looks like it should do.
    for (const dock of pointers.values()) {
      order = dock;
      aim = dock;
    }
    state.order = order;
    pending = null;
  }

  function onPointerDown(event) {
    pointers.set(event.pointerId, orderAt(event.clientX));
    recompute();
    event.preventDefault();
  }

  function onPointerMove(event) {
    // Sliding a held finger along the panel drags the boat with it.
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, orderAt(event.clientX));
    recompute();
  }

  function onPointerUp(event) {
    // The order stands after the thumb lifts. That is the point of the
    // scheme: the boat keeps running the errand while you watch the ship.
    if (!pointers.delete(event.pointerId)) return;
    recompute();
  }

  /**
   * Desktop keys. Left and right nudge a dock at a time; up sends the boat
   * straight home to the shore and down sends it out to the far water, which
   * are the two orders worth having a single key for.
   */
  function keyOrder(code) {
    switch (code) {
      case 'KeyA': case 'ArrowLeft': return clamp(aim - 1);
      case 'KeyD': case 'ArrowRight': return clamp(aim + 1);
      case 'KeyW': case 'ArrowUp': return 0;
      case 'KeyS': case 'ArrowDown': return docks - 1;
      default: return null;
    }
  }

  function onKeyDown(event) {
    const dock = keyOrder(event.code);
    if (dock === null) return;
    aim = dock;
    pending = dock;
    recompute();
    event.preventDefault();
  }

  /** Drop everything held -- otherwise a finger lifted while the tab is
   *  hidden stays in the map and keeps re-issuing an order on return. */
  function releaseAll() {
    pointers.clear();
    pending = null;
    aim = startDock;
    state.order = null;
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
    /** Live order. Read each fixed step. */
    state,
    /**
     * Hand the current order to one step and clear the one-shot one.
     *
     * A key press is an event, not a held state: it must reach exactly one
     * step, or holding a key would order the boat once per frame at whatever
     * rate the display happens to run -- which is a frame-rate dependency in
     * the input path, and the one place the fixed timestep cannot protect
     * the simulation from it.
     */
    consume() {
      const order = state.order;
      // A held pointer keeps issuing; a key press does not.
      recompute();
      return order;
    },
    /** Current order, for recording or replaying a run. */
    snapshot() {
      return state.order;
    },
    releaseAll,
  };
}
