/**
 * Parachute rescue -- pure simulation, no rendering and no input handling.
 *
 * Positions are discrete LCD segments, the way a Game & Watch panel works.
 * A parachutist is always at exactly one (lane, stop) segment and never
 * between two; the boat sits at exactly one of a few docks. There are no
 * continuous coordinates and no fixed-point arithmetic anywhere -- every
 * position in this module is a small integer, which is the strongest form of
 * the "prefer integers" rule in docs/DETERMINISM.md.
 *
 * Parachutists drift down toward the water; the boat slides along the docks.
 * Catch one to score, let one hit the water for a miss. Three misses or sixty
 * seconds ends the run.
 *
 * Nothing here touches the DOM, the clock, or Math.random(). The only inputs
 * are the seed and the {left, right} snapshot handed to update() each step.
 */

import { createRng } from '../rng.js';
import { STEPS_PER_SECOND } from '../loop.js';

/**
 * Drop lanes, left to right.
 *
 * Six rather than a handful: with four, the boat could always reach any lane
 * before a parachutist landed, and a greedy player never missed. Six makes a
 * full-width traverse (~1.3s) comparable to a late-game fall (~1.7s), so
 * lanes at opposite edges become a genuine choice.
 */
export const LANES = 6;

/**
 * Vertical segment positions in a lane, top to bottom. A parachutist spawns
 * at stop 0 and advances one stop at a time.
 */
export const STOPS = 7;

/** The lowest stop: deck height, where a catch is resolved. */
export const DECK_STOP = STOPS - 1;

/** One past the deck: in the water. Reached only by an uncaught parachutist. */
export const SPLASH_STOP = STOPS;

/** Docks the boat can occupy, aligned one-to-one with the lanes. */
export const DOCKS = LANES;

export const RUN_SECONDS = 60;
export const RUN_STEPS = RUN_SECONDS * STEPS_PER_SECOND;
export const MAX_MISSES = 3;

/** Steps between one stop and the next, ramping down over the run. */
const FALL_INTERVAL_START = 46;
const FALL_INTERVAL_END = 17;

/** Steps between spawns, ramping down over the run. */
const SPAWN_INTERVAL_START = 84;
const SPAWN_INTERVAL_END = 34;
const SPAWN_INTERVAL_MIN = 24;
const SPAWN_JITTER = 8;
const FIRST_SPAWN_STEP = 30;

/**
 * Steps the boat takes to move one dock. Tuned against the late-game fall
 * interval so that crossing the board costs most of a parachutist's descent.
 */
const BOAT_MOVE_INTERVAL = 16;

/** The single stop at which a drifting parachutist changes lane. */
const SWAY_AT_STOP = 3;
/** Two of four draws mean "no drift", so most fall straight down. */
const SWAY_CHOICES = [-1, 0, 0, 1];

/** How long the panel flashes after a splash, in steps. */
const MISS_FLASH_STEPS = 12;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Linear ramp between two integers across the run, in integer arithmetic. */
function ramp(from, to, step) {
  const t = clamp(step, 0, RUN_STEPS);
  return from + Math.floor(((to - from) * t) / RUN_STEPS);
}

/**
 * @param {object} options
 * @param {number} options.seed Integer seed, normally from daily.js.
 */
export function createParachuteGame({ seed } = {}) {
  const rng = createRng(seed);

  let nextId = 1;
  let nextSpawnStep = FIRST_SPAWN_STEP;
  let nextBoatMoveStep = 0;

  const state = {
    /** 'playing' | 'ended' */
    phase: 'playing',
    /** null | 'misses' | 'time' */
    endReason: null,
    /** Steps elapsed in THIS run -- the simulation's only clock. */
    step: 0,
    score: 0,
    misses: 0,
    /** Which dock the boat occupies, 0 .. DOCKS-1. */
    boatDock: Math.floor((DOCKS - 1) / 2),
    /** Live parachutists, oldest first. */
    parachutists: [],
    missFlash: 0,
  };

  function spawn() {
    // Draw order is part of the seed: lane, then drift. Never reorder these
    // or add a draw between them without accepting that every seeded run
    // changes. See the golden fingerprint in test/determinism.test.js.
    const lane = rng.nextIntExclusive(0, LANES);
    const swayDir = SWAY_CHOICES[rng.nextIntExclusive(0, SWAY_CHOICES.length)];

    state.parachutists.push({
      id: nextId++,
      lane,
      stop: 0,
      swayDir,
      spawnStep: state.step,
      /** Set once it has passed the deck uncaught -- it is falling to water. */
      doomed: false,
      nextMoveStep: state.step + ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, state.step),
    });
  }

  function scheduleNextSpawn() {
    const base = ramp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, state.step);
    const jitter = rng.nextIntExclusive(-SPAWN_JITTER, SPAWN_JITTER + 1);
    nextSpawnStep = state.step + Math.max(SPAWN_INTERVAL_MIN, base + jitter);
  }

  /**
   * Advance one fixed logic step.
   *
   * @param {{left: boolean, right: boolean}} input Held state for this step.
   */
  function update(input) {
    if (state.phase !== 'playing') return;

    const left = Boolean(input && input.left);
    const right = Boolean(input && input.right);

    // 1. Boat. Both halves held cancel out, which is what a player expects.
    //    Moving first means an input on this step counts toward a catch
    //    resolved on this step -- the last-instant save stays possible.
    const direction = (right ? 1 : 0) - (left ? 1 : 0);
    if (direction !== 0 && state.step >= nextBoatMoveStep) {
      const target = clamp(state.boatDock + direction, 0, DOCKS - 1);
      // Only start the cooldown on an actual move, so holding against the
      // end dock does not stall the boat when the player reverses.
      if (target !== state.boatDock) {
        state.boatDock = target;
        nextBoatMoveStep = state.step + BOAT_MOVE_INTERVAL;
      }
    }

    // 2. Spawning.
    if (state.step >= nextSpawnStep) {
      spawn();
      scheduleNextSpawn();
    }

    // 3. Parachutists. Compaction in place, preserving order, so iteration
    //    order can never depend on how the engine reclaims memory.
    const fallInterval = ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, state.step);
    const list = state.parachutists;
    let write = 0;

    for (let read = 0; read < list.length; read++) {
      const p = list[read];

      if (state.step >= p.nextMoveStep) {
        p.stop += 1;
        p.nextMoveStep = state.step + fallInterval;

        if (p.stop === SWAY_AT_STOP && p.swayDir !== 0) {
          p.lane = clamp(p.lane + p.swayDir, 0, LANES - 1);
        }

        if (p.stop === DECK_STOP) {
          if (state.boatDock === p.lane) {
            state.score += 1;
            continue; // caught -- drop from the list
          }
          p.doomed = true;
        } else if (p.stop >= SPLASH_STOP) {
          state.misses += 1;
          state.missFlash = MISS_FLASH_STEPS;
          continue; // splashed -- drop from the list
        }
      }

      list[write++] = p;
    }
    list.length = write;

    if (state.missFlash > 0) state.missFlash -= 1;

    // 4. End conditions. Misses are checked first so that a third miss on the
    //    final step ends the run as a loss rather than a timeout.
    state.step += 1;
    if (state.misses >= MAX_MISSES) {
      state.phase = 'ended';
      state.endReason = 'misses';
    } else if (state.step >= RUN_STEPS) {
      state.phase = 'ended';
      state.endReason = 'time';
    }
  }

  return {
    state,
    update,
    get isOver() {
      return state.phase === 'ended';
    },
    /** Steps left in the run. Render-only convenience. */
    get stepsRemaining() {
      return Math.max(0, RUN_STEPS - state.step);
    },
  };
}
