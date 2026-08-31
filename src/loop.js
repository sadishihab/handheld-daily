/**
 * Fixed-timestep game loop.
 *
 * Logic runs at exactly 60 steps per simulated second, no matter what the
 * display does. A 60Hz phone and a 120Hz phone run the same number of update()
 * calls for the same elapsed time and therefore reach byte-identical state;
 * only the number of render() calls differs. See docs/DETERMINISM.md.
 *
 * update() deliberately receives the integer step index and NOT a delta.
 * A delta parameter is how variable-timestep bugs get reintroduced -- someone
 * writes `x += v * dt` and the simulation silently starts depending on frame
 * rate. Simulation code that needs a duration multiplies by the exported
 * FIXED_DELTA_SECONDS constant instead.
 */

/** Logic steps per simulated second. */
export const STEPS_PER_SECOND = 60;

/** Duration of one logic step, in milliseconds (16.666...). */
export const FIXED_STEP_MS = 1000 / STEPS_PER_SECOND;

/** Duration of one logic step, in seconds. The only dt simulation code may use. */
export const FIXED_DELTA_SECONDS = 1 / STEPS_PER_SECOND;

/**
 * Longest frame gap the loop will honour, in ms.
 *
 * When a tab is backgrounded, requestAnimationFrame stops firing and the next
 * timestamp can be minutes later. Feeding that straight into the accumulator
 * would queue thousands of update() calls, which take longer than a frame to
 * run, which makes the next gap bigger still -- the spiral of death. Time past
 * this clamp is discarded: the simulation runs in slow motion for one frame
 * rather than locking up the phone.
 */
export const MAX_FRAME_MS = 250;

/**
 * Ceiling on update() calls per frame -- exactly the steps that fit in
 * MAX_FRAME_MS. Rounded, not floored: FIXED_STEP_MS is 16.666...67, so the
 * division lands at 14.999... and would floor to one step short of the clamp.
 */
export const MAX_STEPS_PER_FRAME = Math.round(MAX_FRAME_MS / FIXED_STEP_MS);

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Create a loop.
 *
 * The returned object exposes `advance(frameDeltaMs)` as well as
 * start/stop. advance() is the whole accumulator, driven by an explicit
 * delta -- which is what makes the loop testable headlessly, with no
 * requestAnimationFrame and no real clock involved.
 *
 * @param {object} options
 * @param {(stepIndex: number) => void} options.update Fixed-step logic. Called
 *   0..MAX_STEPS_PER_FRAME times per frame with a monotonic integer index.
 * @param {(alpha: number) => void} [options.render] Called at most once per
 *   frame. `alpha` is the fraction of a step left in the accumulator, in
 *   [0, 1), for interpolating between the last two logic states. Rendering may
 *   use floats and wall-clock freely -- it is not part of the simulation.
 * @param {() => number} [options.now] Clock source. Injectable for tests.
 */
export function createLoop({ update, render = null, now = defaultNow } = {}) {
  if (typeof update !== 'function') {
    throw new TypeError('createLoop: update must be a function');
  }

  let accumulatorMs = 0;
  let stepIndex = 0;
  let running = false;
  let frameHandle = null;
  let lastTimestamp = 0;

  /**
   * Consume a frame's worth of elapsed time.
   *
   * @param {number} frameDeltaMs Wall-clock ms since the previous frame.
   * @returns {number} How many logic steps ran.
   */
  function advance(frameDeltaMs) {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) frameDeltaMs = 0;

    accumulatorMs += Math.min(frameDeltaMs, MAX_FRAME_MS);

    let steps = 0;
    while (accumulatorMs >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      update(stepIndex);
      stepIndex += 1;
      accumulatorMs -= FIXED_STEP_MS;
      steps += 1;
    }

    // Backlog we refused to run is dropped rather than carried, so a stalled
    // frame cannot keep pushing work into the next one.
    if (steps === MAX_STEPS_PER_FRAME && accumulatorMs >= FIXED_STEP_MS) {
      accumulatorMs = 0;
    }

    if (render) render(accumulatorMs / FIXED_STEP_MS);

    return steps;
  }

  function frame(timestamp) {
    if (!running) return;
    advance(timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    frameHandle = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    if (typeof requestAnimationFrame !== 'function') {
      throw new Error('createLoop.start: no requestAnimationFrame; drive advance() directly');
    }
    running = true;
    lastTimestamp = now();
    frameHandle = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (frameHandle !== null) {
      cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
    // Drop partial time so a resumed loop does not replay the pause.
    accumulatorMs = 0;
  }

  return {
    advance,
    start,
    stop,
    get running() {
      return running;
    },
    /** Total logic steps run since creation. The simulation's clock. */
    get stepCount() {
      return stepIndex;
    },
  };
}
