/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The simulation must be reproducible on every device, so this is the ONLY
 * source of randomness the game is allowed to use. Math.random() is never
 * called here and must never be called anywhere under src/ that participates
 * in the simulation. See docs/DETERMINISM.md.
 *
 * mulberry32 is ~10 lines, passes gjrand's test suite for a 32-bit generator,
 * and has a 2^32 period -- far more than a daily puzzle consumes.
 */

const UINT32_RANGE = 4294967296; // 2^32

/**
 * Create an independent RNG stream.
 *
 * @param {number} seed Integer seed. Coerced to a uint32.
 * @returns {{nextUint32: () => number, nextFloat: () => number, nextInt: (min: number, max: number) => number}}
 */
export function createRng(seed) {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new TypeError(`createRng: seed must be an integer, got ${seed}`);
  }

  let state = seed >>> 0;

  /** Raw generator output: a uniform integer in [0, 2^32). */
  function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  function nextFloat() {
    return nextUint32() / UINT32_RANGE;
  }

  /**
   * Uniform integer in [min, max) -- min inclusive, max EXCLUSIVE, matching
   * Array indexing so `nextInt(0, arr.length)` is always in bounds.
   *
   * Uses rejection sampling rather than a plain modulo: modulo bias would
   * skew low values for ranges that do not divide 2^32. Rejection is still
   * fully deterministic -- the same seed rejects the same draws.
   */
  function nextInt(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError(`nextInt: bounds must be integers, got (${min}, ${max})`);
    }
    const range = max - min;
    if (range <= 0) {
      throw new RangeError(`nextInt: max must be greater than min, got (${min}, ${max})`);
    }

    // Discard the tail that would wrap unevenly under the modulo.
    const limit = UINT32_RANGE - (UINT32_RANGE % range);
    let draw = nextUint32();
    while (draw >= limit) draw = nextUint32();

    return min + (draw % range);
  }

  return { nextUint32, nextFloat, nextInt };
}
