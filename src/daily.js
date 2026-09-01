/**
 * Daily seed derivation.
 *
 * This module is the ONLY place the simulation is allowed to look at the
 * clock. It turns wall-clock time into a plain integer seed; everything
 * downstream consumes that integer and never asks what time it is.
 * See docs/DETERMINISM.md.
 *
 * Everything is keyed to UTC, so a player in Auckland and a player in Los
 * Angeles get the same puzzle for the same UTC day. The puzzle rolls over at
 * 00:00 UTC everywhere, not at local midnight.
 */

/**
 * First day of the game, as a UTC calendar date. Puzzle #1.
 *
 * PLACEHOLDER -- must be finalized before public launch. Changing it after
 * launch renumbers every puzzle retroactively, which invalidates any score
 * or result players have already shared.
 */
export const LAUNCH_DATE_UTC = '2026-11-01';

const MS_PER_DAY = 86400000;

/**
 * cyrb53 -- a fast, well-mixed 53-bit string hash.
 *
 * Not cryptographic. It only needs to scatter consecutive date strings
 * ('2026-08-31' vs '2026-09-01') into unrelated seeds, which it does; a naive
 * sum-of-char-codes would hand near-identical seeds to consecutive days.
 *
 * @param {string} str
 * @param {number} [seed] Optional salt.
 * @returns {number} Integer in [0, 2^53).
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The UTC calendar date as 'YYYY-MM-DD'.
 *
 * Deliberately built from getUTC* rather than any local-time accessor: the
 * whole point is that the local timezone cannot influence the result.
 *
 * @param {Date|number} [when] Date or epoch ms. Defaults to now.
 * @returns {string}
 */
export function utcDateString(when = Date.now()) {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('utcDateString: invalid date');
  }

  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The seed for a given UTC day, as a uint32 suitable for createRng().
 *
 * cyrb53 produces 53 bits; the RNG takes 32. Fold the high bits into the low
 * ones rather than truncating, so the whole hash contributes to the seed.
 *
 * @param {Date|number} [when] Date or epoch ms. Defaults to now.
 * @returns {number} uint32
 */
export function dailySeed(when = Date.now()) {
  const hash = cyrb53(utcDateString(when));
  const low = hash >>> 0;
  const high = Math.floor(hash / 4294967296) >>> 0;
  return (low ^ high) >>> 0;
}

/** Epoch ms at 00:00:00 UTC of the given day. */
function utcMidnight(when) {
  const date = when instanceof Date ? when : new Date(when);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Puzzle number, counting whole UTC days from LAUNCH_DATE_UTC.
 * Launch day is puzzle #1. Dates before launch return a value < 1.
 *
 * That value is internal. Anything about to put it in front of a player goes
 * through displayPuzzleNumber() below -- do not clamp it here.
 *
 * @param {Date|number} [when] Date or epoch ms. Defaults to now.
 * @returns {number} Integer.
 */
export function puzzleNumber(when = Date.now()) {
  const launch = Date.parse(`${LAUNCH_DATE_UTC}T00:00:00Z`);
  // Both operands are exact UTC midnights, so this division is whole-number
  // clean -- no DST or leap-second drift to round away.
  return Math.floor((utcMidnight(when) - launch) / MS_PER_DAY) + 1;
}

/**
 * The puzzle number as a player may see it: never zero, never negative.
 *
 * puzzleNumber() counts from LAUNCH_DATE_UTC and is deliberately allowed to
 * run below 1. That is what makes the dev clock useful before launch -- you
 * can wind past day one in either direction and the ordering still holds, so
 * hasPlayed() and record() keep working across the boundary. None of it
 * belongs on screen: "PUZZLE #-60" is not a puzzle anyone can play, and it
 * advertises a launch date that is still a placeholder.
 *
 * So the clamp lives here, at the render boundary, and is applied by whatever
 * draws the number rather than by whatever computes it. The internal value
 * stays honest.
 *
 * @param {number} puzzle Raw puzzle number, possibly < 1.
 * @returns {number} Integer >= 1.
 */
export function displayPuzzleNumber(puzzle) {
  return Number.isFinite(puzzle) ? Math.max(1, Math.floor(puzzle)) : 1;
}

/**
 * Milliseconds until the next 00:00 UTC -- i.e. until the next puzzle.
 *
 * @param {Date|number} [when] Date or epoch ms. Defaults to now.
 * @returns {number} Integer in (0, 86400000].
 */
export function msUntilNextPuzzle(when = Date.now()) {
  const now = when instanceof Date ? when.getTime() : when;
  return utcMidnight(now) + MS_PER_DAY - now;
}

/**
 * Everything the game needs to start a run, in one call.
 *
 * @param {Date|number} [when] Date or epoch ms. Defaults to now.
 */
export function today(when = Date.now()) {
  return {
    date: utcDateString(when),
    seed: dailySeed(when),
    puzzle: puzzleNumber(when),
    msUntilNext: msUntilNextPuzzle(when),
  };
}
