/**
 * Ship rescue -- pure simulation, no rendering and no input handling.
 *
 * A burning ship lies across the top of the board. Passengers crowd its decks
 * and go over the side, arcing down into the water below. One boat works the
 * water: it catches them, carries up to four, and runs them to the single
 * shore at the near end of the board. Sharks patrol the water and take cargo.
 * Only passengers put ashore score.
 *
 * Positions are discrete LCD segments. A jumper is always at exactly one
 * (lane, stop), the boat at exactly one dock, a shark at exactly one dock --
 * all small integers, never between cells and never fixed-point.
 *
 * Nothing here touches the DOM, the clock, or Math.random(). The only inputs
 * are the seed and the order handed to update() each step. See
 * docs/DETERMINISM.md.
 *
 *
 * THE CONTROL MODEL, because it decides the shape of this file
 * ------------------------------------------------------------
 * The simulation does not take a held direction; it takes an ORDER -- a dock
 * index to head for, or null for "no new order this step". The boat remembers
 * its last order and drives itself toward it one dock at a time.
 *
 * A held rudder would need a continuous stream of input, which is the thing a
 * thumb on a phone is worst at. An order is discrete and persistent: touch
 * the column you want, lift, and the boat runs the errand while you watch the
 * ship. See README for the input side of it.
 */

import { createRng } from '../rng.js';
import { STEPS_PER_SECOND } from '../loop.js';

/**
 * Positions the boat can occupy, counted from the shore inward.
 *
 * Dock 0 is the shore -- the boat unloads by touching it. Docks 1 to 4 are
 * open water, so a dock index IS the length of that boat's trip home, which
 * makes the whole economy of the game readable off one number.
 *
 * Five, and five is the floor. The previous board carried a warning that at
 * four positions the run to the shore stopped being a decision, and re-swept
 * for a single boat at the slower pace that warning is not only still true,
 * it is worse -- a slower fall gives the boat more time to get home and back,
 * so the errand is cheaper than it used to be. Over 120 seeds at one cadence,
 * with the three docks furthest from the shore carrying lanes:
 *
 *   4 positions   ferry is  0% of losses, and the run is almost unloseable
 *   5 positions   ferry is 22% of losses
 *   6 positions   ferry is 52% of losses
 *   7 positions   ferry is 63% of losses
 *
 * Five is what was asked for and five is what this ships, but it does not get
 * there on dock count -- it gets there on LANE_DOCK, and the note there is the
 * one that matters. Three lanes and five positions cannot both be had; see
 * README for the whole table.
 */
export const DOCKS = 5;

/** The shore, where the boat unloads. */
export const SHORE_DOCK = 0;

/** The far end of the water, hard under the ship's stern. */
export const FAR_DOCK = DOCKS - 1;

/**
 * Which dock each jump lane comes down over.
 *
 * TWO lanes, over the two docks furthest from the shore. This is the constant
 * that makes five positions work, and it was arrived at the hard way.
 *
 * With only five positions the boat is fast relative to the fall: it can
 * cover any three neighbouring docks well inside a single catch window, so
 * spreading the lanes over docks 2-3-4 costs nothing to cover and the errand
 * home is short enough to be free. Measured over 120 seeds at one cadence:
 *
 *   lanes 1-2-3-4   ferry is  5% of losses   -- a lane one move from the
 *                                               shore is a free rescue
 *   lanes 2-3-4     ferry is 22% of losses
 *   lanes 2-4       ferry is 31% of losses
 *   lanes 3-4       ferry is 55% of losses   <- shipped
 *   lane  4         ferry is 99% of losses   -- and nothing else happens
 *
 * Slowing the boat was tried instead of dropping a lane, because keeping
 * three lanes is worth something. It does not work: at 17 steps a dock the
 * ferry only reaches 39%, and the losses it adds are jumpers the boat set off
 * for and did not reach. That is a harder catch, not a dearer errand -- the
 * exact failure this design was rebuilt away from.
 *
 * The cost of two lanes is composition: two columns of ghosted arc where the
 * old board had six. It is paid back in ARC_OFFSET, which swings the jump out
 * from amidships so the two lanes sweep a wide band of the panel on the way
 * down rather than dropping down two narrow chimneys.
 */
export const LANE_DOCK = [3, 4];
export const LANES = LANE_DOCK.length;

/** The dock nearest the shore that a lane comes down over. */
export const MIN_LANE_DOCK = LANE_DOCK[0];

/**
 * Stops in a jump arc, from the deck rail to the water.
 *
 * A jumper is at exactly one of these. The arc's horizontal shape -- out over
 * the rail, then down -- is layout, not simulation: the lane fixes the dock
 * the jumper comes down over, and the renderer decides which cells the arc
 * passes through on the way. See LAYOUT in render/rescue.js.
 */
export const ARC_STOPS = 6;

/**
 * The last stop before the water, and the one after it.
 *
 * A catch resolves over the final CATCHABLE_STOPS of the arc, so a boat
 * already waiting takes the jumper mid-arc and a boat arriving on the last
 * beat still takes them as they land. One stop of catch window made every
 * near-miss feel arbitrary; two makes arriving early visibly better than
 * arriving exactly on time, which is the habit the game wants to teach.
 */
export const CATCHABLE_STOPS = 2;
export const FIRST_CATCH_STOP = ARC_STOPS - CATCHABLE_STOPS;
export const LAND_STOP = ARC_STOPS - 1;
export const SPLASH_STOP = ARC_STOPS;

/**
 * Passengers waiting on deck at the start of a run.
 *
 * Ninety-two, drawn as a dense block of small figures that go out one at a
 * time as they jump. A good run empties about half of them, which is enough
 * for the thinning to read as progress from across the room.
 *
 * The number is a difficulty constant as much as a compositional one, which
 * was not obvious until the harness showed it. When the deck ran dry partway
 * through a good run the spawner stopped, the endgame quietly got easier, and
 * the reported share of runs ending on misses was wrong by thirty points.
 * Anything that can stop the spawner is a difficulty cliff hiding inside a
 * piece of scenery. Ninety-two never empties: over 120 seeds, 0% of runs
 * clear the deck.
 */
export const CROWD = 92;

/** Passengers the boat can hold. */
export const CAPACITY = 4;

export const RUN_SECONDS = 60;
export const RUN_STEPS = RUN_SECONDS * STEPS_PER_SECOND;
export const MAX_MISSES = 4;

/** Points for each passenger put ashore, and the bonus for a full boat. */
export const POINTS_PER_RESCUE = 10;
export const FULL_BOAT_BONUS = 20;

/**
 * Steps the boat takes to move one dock.
 *
 * The price of the ferry, and the ferry is the game. 13 puts a full round
 * trip from the far lane at 104 steps, a little under two seconds, against a
 * fall that takes about 1.8 seconds at full pressure. So a boat that leaves
 * for the shore has given up roughly the next jumper, and that is the trade
 * the whole run is made of.
 *
 * Unchanged from the two-boat board on purpose. When the number of positions
 * came down from six to five the obvious move was to slow the boat to keep
 * the round trip the same length, and it is the wrong one: a slower boat
 * makes every catch harder, not the ferry more expensive, and the harness
 * reads that as lane-chasing rather than as the errand.
 */
const BOAT_MOVE_INTERVAL = 13;

/**
 * PACE
 * ----
 * Three constants set how fast the run feels. They are not interchangeable,
 * and the harness had to be asked about each separately:
 *
 *   fall speed   slower is a pure win. It buys reaction time, and because a
 *                slower arc is a longer catch window it RAISES the score
 *                while leaving the ferry's share of losses flat.
 *   jump rate    slower is the expensive one. Rarer jumpers means the boat
 *                can finish a round trip between them, so the ferry stops
 *                costing anything and every remaining loss is arriving late.
 *                That is the game's one decision being switched off.
 *   ramp target  slower is mild and cheap; it just delays the top end.
 *
 * The fall and the ramp are carried over unchanged from the two-boat board.
 * The jump rate is not, and could not be. The instinct was that one boat
 * where there were two means half the traffic, and it is backwards: the old
 * cadence fed six lanes across two boats, this one feeds two lanes and one,
 * and
 * the boat is fast enough relative to the slowed fall that it was never under
 * any pressure at all -- at 150 steps between jumps the harness could not
 * lose a run. 90 is where a run is roughly a coin flip between running out of
 * lives and running out of clock.
 */

/** Difficulty is a 0..RAMP_SCALE pressure value, not a raw step count. */
const RAMP_SCALE = 1000;
/** Rescues that alone would take difficulty to maximum. */
const RESCUE_RAMP_TARGET = 30;
const SCORE_RAMP_WEIGHT = 2;
const TIME_RAMP_WEIGHT = 1;

/** Steps between one arc stop and the next. */
const FALL_INTERVAL_START = 50;
const FALL_INTERVAL_END = 18;

/** Steps between jumps. */
const SPAWN_INTERVAL_START = 90;
const SPAWN_INTERVAL_END = 32;
const SPAWN_INTERVAL_MIN = 28;
const SPAWN_JITTER = 8;
const FIRST_SPAWN_STEP = 46;

/** Sharks. */
const SHARK_INTERVAL_START = 900;
const SHARK_INTERVAL_END = 480;
const SHARK_INTERVAL_MIN = 380;
const FIRST_SHARK_STEP = 380;
const SHARK_MOVE_INTERVAL = 17;
/**
 * A shark takes the cargo and not a life -- carried over from earlier boards,
 * where charging a life measured three times worse: it became the thing that
 * ended runs and buried the rescue loop it exists to complicate. Taking the
 * cargo keeps it a tax on greed, which is the decision the game is about.
 */
const SHARK_COSTS_LIFE = 0;
const MAX_SHARKS = 1;
/**
 * The stretch of water a shark patrols: the lanes, and one dock shorewards.
 *
 * Dock 1 and the shore are shark-free, so the last leg of the run home is the
 * safest water on the board -- the crossing is where you can finally stop
 * worrying. It also clears the shore end of the water for the landing art,
 * which needs somewhere to put a jetty that is not a cell a shark can occupy.
 *
 * One dock shorewards of the lanes rather than none: with only two lanes a
 * shark confined to them would enter and leave in two moves and never be
 * anything to steer around. Reaching dock 2 means a loaded boat setting off
 * for the shore has to get past it, which is the moment the shark is for.
 */
const SHARK_FAR_DOCK = FAR_DOCK;
const SHARK_NEAR_DOCK = MIN_LANE_DOCK - 1;

/**
 * Every dock a shark can be standing on, low to high.
 *
 * Exported because the renderer has to ghost exactly this set and no other:
 * a ghosted shark at a dock no shark can reach is a segment the player learns
 * to watch for nothing, and a lit shark at a dock that was never ghosted
 * appears out of blank glass.
 */
export const SHARK_DOCKS = Array.from(
  { length: SHARK_FAR_DOCK - SHARK_NEAR_DOCK + 1 },
  (_, i) => SHARK_NEAR_DOCK + i
);

/** How long the flail-and-splash reaction runs, and how many frames it has. */
export const SPLASH_FRAME_COUNT = 5;
export const SPLASH_FRAME_STEPS = 7;
export const SPLASH_STEPS = SPLASH_FRAME_COUNT * SPLASH_FRAME_STEPS;

const MISS_FLASH_STEPS = 12;
const SHARK_FLASH_STEPS = 18;

/** Why a jumper was lost. Reported by the tuning harness, not by the panel. */
export const MISS_CAUSES = ['errand', 'full', 'late', 'idle'];

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Difficulty pressure, 0 .. RAMP_SCALE.
 *
 * Weighted toward rescues rather than the clock, so a player who is doing
 * well is pushed harder while someone struggling is not buried by the timer
 * alone. Integer arithmetic throughout.
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

export function createRescueGame({ seed } = {}) {
  const rng = createRng(seed);

  let nextId = 1;
  let nextSharkId = 1;
  let nextSpawnStep = FIRST_SPAWN_STEP;
  let nextSharkStep = FIRST_SHARK_STEP;

  const state = {
    /** 'playing' | 'ended' */
    phase: 'playing',
    /** null | 'misses' | 'time' */
    endReason: null,
    /** Steps elapsed in THIS run -- the simulation's only clock. */
    step: 0,
    score: 0,
    rescued: 0,
    fullBoats: 0,
    misses: 0,
    /** The boat. `target` is the dock it is driving toward. */
    boat: {
      dock: FAR_DOCK,
      target: FAR_DOCK,
      aboard: 0,
      nextMoveStep: 0,
    },
    /** Passengers still on deck. Drawn as the crowd. */
    waiting: CROWD,
    jumpers: [],
    sharks: [],
    /** Multi-frame flail-and-splash reactions. Cosmetic, but simulated so
     *  they are identical on every device and can be asserted. */
    splashes: [],
    missFlash: 0,
    sharkFlash: 0,
    /** Tallies for the tuning harness. Not drawn. */
    missCauses: { errand: 0, full: 0, late: 0, idle: 0 },
  };

  function spawnJumper() {
    // Draw order is part of the seed, and jumpers are always drawn before
    // sharks. Never reorder without accepting that every seeded run changes.
    const lane = rng.nextIntExclusive(0, LANES);
    if (state.waiting <= 0) return;
    state.waiting -= 1;

    state.jumpers.push({
      id: nextId++,
      lane,
      stop: 0,
      nextMoveStep: state.step + ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, pressure(state)),
    });
  }

  function spawnShark(fromSeaward) {
    state.sharks.push({
      id: nextSharkId++,
      pos: fromSeaward ? SHARK_FAR_DOCK : SHARK_NEAR_DOCK,
      dir: fromSeaward ? -1 : 1,
      nextMoveStep: state.step + SHARK_MOVE_INTERVAL,
    });
  }

  function deliver() {
    const boat = state.boat;
    const delivered = boat.aboard;
    state.score += delivered * POINTS_PER_RESCUE;
    if (delivered === CAPACITY) {
      state.score += FULL_BOAT_BONUS;
      state.fullBoats += 1;
    }
    state.rescued += delivered;
    boat.aboard = 0;
  }

  /**
   * Why this jumper was lost, decided at the moment the water takes them.
   *
   * Only ever read by the tuning harness, but it lives here because it is the
   * one place that can see the boat's state at the instant of the loss.
   */
  function missCause(wantedDock) {
    const boat = state.boat;
    if (boat.aboard >= CAPACITY) return 'full';
    // Shorewards of every lane, or ordered there: this jumper was lost to the
    // ferry, which is the cost the design is trying to charge.
    if (boat.dock < MIN_LANE_DOCK || boat.target < MIN_LANE_DOCK) return 'errand';
    if (boat.target === wantedDock) return 'late';
    return 'idle';
  }

  /**
   * Advance one fixed logic step.
   *
   * @param {number|null} order Dock to head for, or null to leave the boat's
   *   standing order alone.
   */
  function update(order) {
    if (state.phase !== 'playing') return;

    const level = pressure(state);
    const boat = state.boat;

    // 1. The order. A null leaves the standing order in place, so the boat
    //    keeps running its last errand while the thumb is off the glass --
    //    which is the entire reason this is playable one-handed.
    if (order !== null && order !== undefined) {
      boat.target = clamp(Math.trunc(order), SHORE_DOCK, FAR_DOCK);
    }

    // 2. The boat. Moving before catches resolve keeps the last-instant save.
    if (boat.dock !== boat.target && state.step >= boat.nextMoveStep) {
      boat.dock += boat.target > boat.dock ? 1 : -1;
      boat.nextMoveStep = state.step + BOAT_MOVE_INTERVAL;
    }
    // 3. Touching the shore delivers everyone aboard in the same step. The
    //    boat is never held there, so the player is never not playing.
    if (boat.dock === SHORE_DOCK && boat.aboard > 0) deliver();

    // 4. Spawning: jumpers, then sharks. Fixed order.
    if (state.step >= nextSpawnStep) {
      spawnJumper();
      const base = ramp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, level);
      const jitter = rng.nextIntExclusive(-SPAWN_JITTER, SPAWN_JITTER + 1);
      nextSpawnStep = state.step + Math.max(SPAWN_INTERVAL_MIN, base + jitter);
    }

    if (state.step >= nextSharkStep) {
      // Which end it swims in from is drawn whether or not there is room for
      // another shark -- a draw taken inside a conditional is a draw that
      // reorders the whole stream when the condition changes.
      const fromSeaward = rng.nextIntExclusive(0, 2) === 0;
      if (state.sharks.length < MAX_SHARKS) spawnShark(fromSeaward);
      const base = ramp(SHARK_INTERVAL_START, SHARK_INTERVAL_END, level);
      nextSharkStep = state.step + Math.max(SHARK_INTERVAL_MIN, base);
    }

    // 5. Sharks. A shark reaching a loaded boat takes everyone aboard; an
    //    empty boat is ignored, so the danger scales with what is being
    //    carried -- which is what makes "one more catch" a gamble.
    {
      const sharks = state.sharks;
      let write = 0;
      for (let read = 0; read < sharks.length; read++) {
        const shark = sharks[read];
        if (state.step >= shark.nextMoveStep) {
          shark.pos += shark.dir;
          shark.nextMoveStep = state.step + SHARK_MOVE_INTERVAL;
        }
        if (shark.pos < SHARK_NEAR_DOCK || shark.pos > SHARK_FAR_DOCK) continue; // swum off

        if (shark.pos === boat.dock && boat.aboard > 0) {
          boat.aboard = 0;
          state.sharkFlash = SHARK_FLASH_STEPS;
          if (SHARK_COSTS_LIFE) state.misses += 1;
        }
        sharks[write++] = shark;
      }
      sharks.length = write;
    }

    // 6. Jumpers.
    const fallInterval = ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, level);
    const list = state.jumpers;
    let write = 0;

    for (let read = 0; read < list.length; read++) {
      const j = list[read];
      const dock = LANE_DOCK[j.lane];

      if (state.step >= j.nextMoveStep) {
        j.stop += 1;
        j.nextMoveStep = state.step + fallInterval;
      }

      // A catch resolves anywhere in the final stretch of the arc, so a boat
      // that got there early takes the jumper out of the air.
      if (j.stop >= FIRST_CATCH_STOP && j.stop <= LAND_STOP) {
        if (boat.dock === dock && boat.aboard < CAPACITY) {
          boat.aboard += 1;
          continue; // aboard -- drop from the list. No points yet.
        }
      } else if (j.stop >= SPLASH_STOP) {
        state.misses += 1;
        state.missCauses[missCause(dock)] += 1;
        state.missFlash = MISS_FLASH_STEPS;
        state.splashes.push({ lane: j.lane, age: 0 });
        continue;
      }

      list[write++] = j;
    }
    list.length = write;

    // 7. The flail-and-splash reaction. Purely a picture, but it is a
    //    simulated one: a miss has to read as an event, and an event needs a
    //    clock, and the only clock this code may read is the step counter.
    {
      const splashes = state.splashes;
      let keep = 0;
      for (let read = 0; read < splashes.length; read++) {
        const splash = splashes[read];
        splash.age += 1;
        if (splash.age < SPLASH_STEPS) splashes[keep++] = splash;
      }
      splashes.length = keep;
    }

    if (state.missFlash > 0) state.missFlash -= 1;
    if (state.sharkFlash > 0) state.sharkFlash -= 1;

    // 8. End conditions.
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

/** Which animation frame a splash is showing. Shared by renderer and tests. */
export function splashFrame(splash) {
  return clamp(Math.floor(splash.age / SPLASH_FRAME_STEPS), 0, SPLASH_FRAME_COUNT - 1);
}
