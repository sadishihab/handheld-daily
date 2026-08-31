/**
 * Input -- turns touches and keys into a {left, right} held state.
 *
 * The game never sees an event; it sees two booleans per fixed step. That
 * keeps input replayable: recording the pair each step is enough to reproduce
 * a run exactly. See docs/DETERMINISM.md.
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
 * @param {HTMLElement} target Element whose left/right halves are the pads.
 */
export function createInput(target) {
  // Live object handed to the simulation each step. Mutated in place rather
  // than reallocated, and only ever between frames -- DOM events cannot fire
  // partway through the loop's synchronous run of fixed steps, so the value
  // is stable across every step of a given frame.
  const state = { left: false, right: false };

  const keys = { left: false, right: false };
  /** pointerId -> 'left' | 'right'. A Map so multi-touch is tracked per finger. */
  const pointers = new Map();

  function halfAt(clientX) {
    const rect = target.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? 'left' : 'right';
  }

  function recompute() {
    let left = keys.left;
    let right = keys.right;
    for (const half of pointers.values()) {
      if (half === 'left') left = true;
      else right = true;
    }
    state.left = left;
    state.right = right;
  }

  function onPointerDown(event) {
    pointers.set(event.pointerId, halfAt(event.clientX));
    recompute();
    event.preventDefault();
  }

  function onPointerMove(event) {
    // Sliding a held finger across the midline switches direction.
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, halfAt(event.clientX));
    recompute();
  }

  function onPointerUp(event) {
    if (!pointers.delete(event.pointerId)) return;
    recompute();
  }

  function keyDirection(code) {
    if (code === 'ArrowLeft' || code === 'KeyA') return 'left';
    if (code === 'ArrowRight' || code === 'KeyD') return 'right';
    return null;
  }

  function onKeyDown(event) {
    const direction = keyDirection(event.code);
    if (!direction) return;
    keys[direction] = true;
    recompute();
    event.preventDefault();
  }

  function onKeyUp(event) {
    const direction = keyDirection(event.code);
    if (!direction) return;
    keys[direction] = false;
    recompute();
  }

  /** Drop everything held -- otherwise a key released while the tab is
   *  hidden stays stuck down and the boat drives into the wall on return. */
  function releaseAll() {
    keys.left = false;
    keys.right = false;
    pointers.clear();
    recompute();
  }

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  return {
    /** Live held state. Read each fixed step. */
    state,
    /** Immutable copy, for recording or replaying a run. */
    snapshot() {
      return { left: state.left, right: state.right };
    },
    releaseAll,
  };
}
