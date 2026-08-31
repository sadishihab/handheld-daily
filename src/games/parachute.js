/**
 * Parachute rescue -- pure simulation, no rendering and no input handling.
 *
 * Parachutists drift down toward the water; a boat slides along the bottom.
 * Catch one to score, let one hit the water for a miss. Three misses or
 * sixty seconds ends the run.
 *
 * Nothing in this module touches the DOM, the clock, or Math.random(). The
 * only inputs are the seed handed to createParachuteGame() and the
 * {left, right} snapshot handed to update() each step, which is exactly what
 * makes a run reproducible. See docs/DETERMINISM.md.
 *
 * Positions are integers throughout. Vertical position is fixed-point in
 * SUBCELL units per grid cell rather than a float, so a long run cannot
 * accumulate rounding error.
 */

import { createRng } from '../rng.js';
import { STEPS_PER_SECOND } from '../loop.js';

/** Playfield dimensions, in cells. The renderer scales this to the screen. */
export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 32;

/** Fixed-point resolution: sub-units per cell. A power of two, so the
 *  division back to a cell index is exact. */
const SUBCELL = 64;

export const RUN_SECONDS = 60;
export const RUN_STEPS = RUN_SECONDS * STEPS_PER_SECOND;
export const MAX_MISSES = 3;

/** Row layout. Rows 0-1 are the readout, 3 is the drop line. */
export const READOUT_ROW = 0;
export const SKY_TOP_ROW = 3;
export const BOAT_ROW = GRID_HEIGHT - 5;
export const WATER_ROW = GRID_HEIGHT - 3;

export const BOAT_WIDTH = 3;
/**
 * Sub-units per step -- ~1.4s to cross the full screen. Tuned against the
 * fall speed: the boat must be able to cross from one edge to the other in
 * comfortably less time than a parachutist takes to fall, or back-to-back
 * spawns in opposite corners are unwinnable rather than merely hard.
 */
const BOAT_SPEED_SUB = 16;

/** Fall speed ramps over the run, in sub-units per step. */
const FALL_SPEED_START = 6;
const FALL_SPEED_END = 15;

/** Steps between spawns, ramping down over the run. */
const SPAWN_INTERVAL_START = 84;
const SPAWN_INTERVAL_END = 40;
const SPAWN_INTERVAL_MIN = 24;
const SPAWN_JITTER = 8;
const FIRST_SPAWN_STEP = 30;

/** A parachutist shifts one column every this many steps, if it sways. */
const SWAY_PERIOD = 22;
/** Two of four draws mean "no sway", so most fall straight. */
const SWAY_CHOICES = [-1, 0, 0, 1];

/** How long the screen flashes after a miss, in steps. Cosmetic but
 *  simulated, so it stays identical across devices. */
const MISS_FLASH_STEPS = 12;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Linear ramp between two integers across the run, in integer arithmetic.
 * Floor keeps this exact; no float accumulates from step to step.
 */
function ramp(from, to, step) {
  const t = clamp(step, 0, RUN_STEPS);
  return from + Math.floor(((to - from) * t) / RUN_STEPS);
}

/**
 * Create a run.
 *
 * @param {object} options
 * @param {number} options.seed Integer seed, normally from daily.js.
 * @returns Game instance. `state` is live and read-only to callers -- the
 *   renderer reads it every frame and must never write to it.
 */
export function createParachuteGame({ seed } = {}) {
  const rng = createRng(seed);

  let nextId = 1;
  let nextSpawnStep = FIRST_SPAWN_STEP;

  const state = {
    /** 'playing' | 'ended' */
    phase: 'playing',
    /** null | 'misses' | 'time' */
    endReason: null,
    /** Steps elapsed in THIS run -- the simulation's only clock. */
    step: 0,
    score: 0,
    misses: 0,
    /** Boat position, fixed-point, left edge. */
    boatXSub: Math.floor(((GRID_WIDTH - BOAT_WIDTH) * SUBCELL) / 2),
    /** Live parachutists, oldest first. */
    parachutists: [],
    missFlash: 0,
  };

  const boatMaxSub = (GRID_WIDTH - BOAT_WIDTH) * SUBCELL;

  function spawn() {
    // Draw order is part of the seed: column, then sway. Never reorder these
    // or add a draw between them without accepting that every seeded run
    // changes.
    const col = rng.nextIntExclusive(1, GRID_WIDTH - 1);
    const swayDir = SWAY_CHOICES[rng.nextIntExclusive(0, SWAY_CHOICES.length)];

    state.parachutists.push({
      id: nextId++,
      col,
      ySub: SKY_TOP_ROW * SUBCELL,
      swayDir,
      spawnStep: state.step,
      /** Set once it has passed the boat uncaught -- it is falling to water. */
      doomed: false,
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
    const direction = (right ? 1 : 0) - (left ? 1 : 0);
    if (direction !== 0) {
      state.boatXSub = clamp(state.boatXSub + direction * BOAT_SPEED_SUB, 0, boatMaxSub);
    }

    // 2. Spawning.
    if (state.step >= nextSpawnStep) {
      spawn();
      scheduleNextSpawn();
    }

    // 3. Parachutists. Compaction in place, preserving order, so the
    //    iteration order can never depend on how the engine reclaims memory.
    const fallSpeed = ramp(FALL_SPEED_START, FALL_SPEED_END, state.step);
    const boatCol = Math.floor(state.boatXSub / SUBCELL);
    const list = state.parachutists;
    let write = 0;

    for (let read = 0; read < list.length; read++) {
      const p = list[read];
      p.ySub += fallSpeed;

      if (!p.doomed && p.swayDir !== 0 && (state.step - p.spawnStep) % SWAY_PERIOD === 0) {
        p.col = clamp(p.col + p.swayDir, 1, GRID_WIDTH - 2);
      }

      const row = Math.floor(p.ySub / SUBCELL);

      // Resolve once, on the way past the boat's deck.
      if (!p.doomed && row >= BOAT_ROW) {
        if (p.col >= boatCol && p.col < boatCol + BOAT_WIDTH) {
          state.score += 1;
          continue; // caught -- drop from the list
        }
        p.doomed = true;
      }

      if (row >= WATER_ROW) {
        state.misses += 1;
        state.missFlash = MISS_FLASH_STEPS;
        continue; // splashed -- drop from the list
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
