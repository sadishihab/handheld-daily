/**
 * Parachute rescue -- pure simulation, no rendering and no input handling.
 *
 * Parachutists bail out of a burning aircraft and descend through fixed lanes.
 * The boat catches them, carries up to four, and must cross open water to the
 * shore before it can take any more; touching the shore delivers everyone
 * aboard at once. Sharks patrol the lanes and will take whoever is aboard.
 * Only survivors delivered to shore score.
 *
 * Positions are discrete LCD segments. A parachutist is always at exactly one
 * (lane, stop), the boat at exactly one dock, a shark at exactly one water
 * position -- all small integers, never between cells and never fixed-point.
 *
 * Nothing here touches the DOM, the clock, or Math.random(). The only inputs
 * are the seed and the {left, right} snapshot handed to update() each step.
 * See docs/DETERMINISM.md.
 */

import { createRng } from '../rng.js';
import { STEPS_PER_SECOND } from '../loop.js';

/**
 * Drop lanes, left to right.
 *
 * Four, not six. With more lanes the run was decided by whether the boat could
 * cross in time, and the rescue loop became decoration: measured over 30 seeds,
 * roughly 2.6 of every 3 losses came from plain lane-chasing. Four lanes make
 * catching comfortable so that the shore trip is what actually costs you.
 */
export const LANES = 4;

/** Vertical segment positions in a lane. A parachutist spawns at stop 0. */
export const STOPS = 7;

/** The lowest stop: deck height, where a catch is resolved. */
export const DECK_STOP = STOPS - 1;

/** One past the deck: in the water. */
export const SPLASH_STOP = STOPS;

/**
 * Open-water docks between the last lane and the shore.
 *
 * The boat can neither catch nor be reached by a shark while crossing them,
 * so they are pure travel -- and with the unload now instant, they are the
 * entire price of a delivery.
 *
 * Five, which is what it takes. Measured over 60 tuning seeds and a 120-seed
 * holdout against the same greedy AI the previous tunings used, going instant
 * at the old gap of 2 did not shorten the errand so much as delete it: no run
 * in 60 ended on misses, every one ran the clock out, and average rescues went
 * from 20.8 to 32.5. Each dock added back costs about 14 steps of round trip
 * and buys back some of that, and 5 is where the balance lands on the numbers
 * the previous tunings were held to -- 40% of losses from the errand against
 * 42%, 62% of runs ending on misses against 68%, average run 54.9s against
 * 54.9s -- with time spent motionless down from 9% of a run to 1%.
 *
 * Filling the boat still beats ferrying singles, which is the thing that has
 * to stay true: a player who always delivers at four scores 305 against 132
 * for one who delivers at one. The margin is far wider than it was at gap 2,
 * where the two were within 5% and the AI stopped filling at all.
 */
export const SHORE_GAP = 5;

/**
 * Boat positions. 0 .. LANES-1 sit under the drop lanes, then SHORE_GAP
 * stretches of open water, then the shore, where survivors are unloaded. The
 * boat cannot catch anything from the crossing or the shore -- that is the
 * cost of the trip.
 */
export const SHORE_DOCK = LANES + SHORE_GAP;
export const DOCK_COUNT = SHORE_DOCK + 1;

/** Survivors the boat can hold. */
export const CAPACITY = 4;

export const RUN_SECONDS = 60;
export const RUN_STEPS = RUN_SECONDS * STEPS_PER_SECOND;
export const MAX_MISSES = 4;

/** Points for each survivor put ashore, and the bonus for a full boat. */
export const POINTS_PER_RESCUE = 10;
export const FULL_BOAT_BONUS = 20;

/**
 * Unloading is instant. The boat reaches the shore dock and everyone aboard
 * is delivered and scored in that same step -- there is no unload timer, and
 * no state for one.
 *
 * It was 75 steps, then 50. Both playtested as dead time rather than tension:
 * the boat sat still, the lanes filled up, and the player watched. Every step
 * of the cost now lives in the crossing, which is a thing you are doing
 * rather than a thing being done to you.
 *
 * The cost had to go somewhere, and it went into SHORE_GAP -- see the note
 * there, which is where the real tuning argument is.
 */

/** Steps the boat takes to move one dock. */
const BOAT_MOVE_INTERVAL = 7;

/** Difficulty is a 0..RAMP_SCALE pressure value, not a raw step count. */
const RAMP_SCALE = 1000;
/** Rescues that alone would take difficulty to maximum. */
const RESCUE_RAMP_TARGET = 22;
/** How much of the ramp comes from rescues rather than elapsed time. */
const SCORE_RAMP_WEIGHT = 2;
const TIME_RAMP_WEIGHT = 1;

/** Steps between one stop and the next. */
const FALL_INTERVAL_START = 50;
const FALL_INTERVAL_END = 22;

/** Steps between parachutist spawns. */
const SPAWN_INTERVAL_START = 124;
const SPAWN_INTERVAL_END = 82;
const SPAWN_INTERVAL_MIN = 68;
const SPAWN_JITTER = 8;
const FIRST_SPAWN_STEP = 40;

/** Sharks. */
const SHARK_INTERVAL_START = 980;
const SHARK_INTERVAL_END = 520;
const SHARK_INTERVAL_MIN = 420;
const FIRST_SHARK_STEP = 420;
const SHARK_MOVE_INTERVAL = 17;
/**
 * Whether a shark costs a life as well as the cargo. It does not.
 *
 * Measured both ways over 40 seeds: charging a life dropped runs reaching the
 * full sixty seconds from 33% to 3%, and average rescues from 22 to 17. The
 * shark became the thing that ended runs, which buries the rescue loop it is
 * supposed to complicate. Taking only the cargo keeps it a tax on greed --
 * it punishes carrying four, which is exactly the decision the game is about.
 */
const SHARK_COSTS_LIFE = 0;
const MAX_SHARKS = 2;

/** The single stop at which a drifting parachutist changes lane. */
const SWAY_AT_STOP = 3;
const SWAY_CHOICES = [-1, 0, 0, 1];

const MISS_FLASH_STEPS = 12;
const SHARK_FLASH_STEPS = 18;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Difficulty pressure, 0 .. RAMP_SCALE.
 *
 * Weighted toward rescues rather than the clock, so a player who is doing well
 * is pushed harder while someone struggling is not buried by the timer alone.
 * Integer arithmetic throughout.
 */
function pressure(state) {
  const byTime = Math.floor((clamp(state.step, 0, RUN_STEPS) * RAMP_SCALE) / RUN_STEPS);
  const byScore = Math.floor(
    (clamp(state.rescued, 0, RESCUE_RAMP_TARGET) * RAMP_SCALE) / RESCUE_RAMP_TARGET
  );
  const total = byTime * TIME_RAMP_WEIGHT + byScore * SCORE_RAMP_WEIGHT;
  return clamp(Math.floor(total / (TIME_RAMP_WEIGHT + SCORE_RAMP_WEIGHT)), 0, RAMP_SCALE);
}

/** Linear ramp between two integers across the pressure range. */
function ramp(from, to, level) {
  return from + Math.floor(((to - from) * clamp(level, 0, RAMP_SCALE)) / RAMP_SCALE);
}

export function createParachuteGame({ seed } = {}) {
  const rng = createRng(seed);

  let nextId = 1;
  let nextSharkId = 1;
  let nextSpawnStep = FIRST_SPAWN_STEP;
  let nextSharkStep = FIRST_SHARK_STEP;
  let nextBoatMoveStep = 0;

  const state = {
    /** 'playing' | 'ended' */
    phase: 'playing',
    /** null | 'misses' | 'time' */
    endReason: null,
    /** Steps elapsed in THIS run -- the simulation's only clock. */
    step: 0,
    /** Points. Only delivered survivors score. */
    score: 0,
    /** Survivors delivered to shore. */
    rescued: 0,
    /** Full boats of CAPACITY delivered, for the combo bonus. */
    fullBoats: 0,
    /** Survivors currently on the boat. */
    aboard: 0,
    misses: 0,
    /** 0 .. SHORE_DOCK. */
    boatDock: Math.floor((LANES - 1) / 2),
    parachutists: [],
    sharks: [],
    missFlash: 0,
    sharkFlash: 0,
  };

  function spawnParachutist() {
    // Draw order is part of the seed: lane, then drift, and parachutists are
    // always drawn before sharks. Never reorder without accepting that every
    // seeded run changes.
    const lane = rng.nextIntExclusive(0, LANES);
    const swayDir = SWAY_CHOICES[rng.nextIntExclusive(0, SWAY_CHOICES.length)];

    state.parachutists.push({
      id: nextId++,
      lane,
      stop: 0,
      swayDir,
      spawnStep: state.step,
      doomed: false,
      nextMoveStep: state.step + ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, pressure(state)),
    });
  }

  function spawnShark() {
    const fromLeft = rng.nextIntExclusive(0, 2) === 0;
    state.sharks.push({
      id: nextSharkId++,
      pos: fromLeft ? 0 : LANES - 1,
      dir: fromLeft ? 1 : -1,
      nextMoveStep: state.step + SHARK_MOVE_INTERVAL,
    });
  }

  function deliver() {
    const delivered = state.aboard;
    state.score += delivered * POINTS_PER_RESCUE;
    if (delivered === CAPACITY) {
      state.score += FULL_BOAT_BONUS;
      state.fullBoats += 1;
    }
    state.rescued += delivered;
    state.aboard = 0;
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
    const level = pressure(state);

    // 1. Boat. Moving before catches resolve keeps the last-instant save.
    const direction = (right ? 1 : 0) - (left ? 1 : 0);
    if (direction !== 0 && state.step >= nextBoatMoveStep) {
      const target = clamp(state.boatDock + direction, 0, SHORE_DOCK);
      if (target !== state.boatDock) {
        state.boatDock = target;
        nextBoatMoveStep = state.step + BOAT_MOVE_INTERVAL;
      }
    }

    // 2. Touching the shore delivers everyone aboard, in this same step. The
    //    boat is never held there, so the player is never not playing.
    if (state.boatDock === SHORE_DOCK && state.aboard > 0) deliver();

    // 3. Spawning: parachutists, then sharks. Fixed order.
    if (state.step >= nextSpawnStep) {
      spawnParachutist();
      const base = ramp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, level);
      const jitter = rng.nextIntExclusive(-SPAWN_JITTER, SPAWN_JITTER + 1);
      nextSpawnStep = state.step + Math.max(SPAWN_INTERVAL_MIN, base + jitter);
    }

    if (state.step >= nextSharkStep) {
      if (state.sharks.length < MAX_SHARKS) spawnShark();
      const base = ramp(SHARK_INTERVAL_START, SHARK_INTERVAL_END, level);
      nextSharkStep = state.step + Math.max(SHARK_INTERVAL_MIN, base);
    }

    // 4. Sharks. A shark reaching the boat takes everyone aboard; an empty
    //    boat is ignored, so the danger scales with what the player is
    //    carrying -- which is exactly what makes "one more catch" a gamble.
    {
      const sharks = state.sharks;
      let write = 0;
      for (let read = 0; read < sharks.length; read++) {
        const shark = sharks[read];
        if (state.step >= shark.nextMoveStep) {
          shark.pos += shark.dir;
          shark.nextMoveStep = state.step + SHARK_MOVE_INTERVAL;
        }
        if (shark.pos < 0 || shark.pos > LANES - 1) continue; // swum off, drop it

        // No check for being ashore: SHORE_DOCK is past every lane and a
        // shark off the lanes has already been dropped, so a docked boat is
        // unreachable by construction.
        if (shark.pos === state.boatDock && state.aboard > 0) {
          state.aboard = 0;
          state.sharkFlash = SHARK_FLASH_STEPS;
          if (SHARK_COSTS_LIFE) state.misses += 1;
        }
        sharks[write++] = shark;
      }
      sharks.length = write;
    }

    // 5. Parachutists.
    const fallInterval = ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, level);
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
          // Caught only if the boat is in this lane and has room. Being at
          // the shore needs no test of its own: SHORE_DOCK is not a lane.
          const canCatch = state.boatDock === p.lane && state.aboard < CAPACITY;
          if (canCatch) {
            state.aboard += 1;
            continue; // aboard -- drop from the list. No points yet.
          }
          p.doomed = true;
        } else if (p.stop >= SPLASH_STOP) {
          state.misses += 1;
          state.missFlash = MISS_FLASH_STEPS;
          continue;
        }
      }

      list[write++] = p;
    }
    list.length = write;

    if (state.missFlash > 0) state.missFlash -= 1;
    if (state.sharkFlash > 0) state.sharkFlash -= 1;

    // 6. End conditions.
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
    get stepsRemaining() {
      return Math.max(0, RUN_STEPS - state.step);
    },
  };
}
