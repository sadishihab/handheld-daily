/**
 * Ship rescue -- pure simulation, no rendering and no input handling.
 *
 * A burning ship sits across the middle of the board. Passengers crowd its
 * decks and jump from either end, arcing out and down into the water. A boat
 * on each side catches them, carries up to four, and ferries them out to the
 * shore at its own outer edge. Sharks patrol the water and take cargo.
 * Only passengers put ashore score.
 *
 * Positions are discrete LCD segments. A jumper is always at exactly one
 * (side, lane, stop), a boat at exactly one (side, dock), a shark at exactly
 * one (side, dock) -- all small integers, never between cells and never
 * fixed-point.
 *
 * Nothing here touches the DOM, the clock, or Math.random(). The only inputs
 * are the seed and the order pair handed to update() each step. See
 * docs/DETERMINISM.md.
 *
 *
 * THE CONTROL MODEL, because it decides the shape of this file
 * ------------------------------------------------------------
 * Two boats and one thumb. The simulation therefore does not take a held
 * direction; it takes an ORDER per side -- a dock index to head for, or null
 * for "no new order this step". Each boat remembers its last order and drives
 * itself toward it one dock at a time.
 *
 * That is the whole trick. A held rudder needs a continuous stream of input
 * per boat, and a thumb can only produce one stream. An order is discrete and
 * persistent, so one thumb can keep two boats busy by alternating between
 * them, and the cost of the second boat is a switch of attention rather than
 * a second hand. See README for the input side of it.
 */

import { createRng } from '../rng.js';
import { STEPS_PER_SECOND } from '../loop.js';

/** Sides of the ship. Index 0 is left, 1 is right; they mirror exactly. */
export const SIDES = 2;
export const LEFT = 0;
export const RIGHT = 1;

/**
 * Dock positions on one side, counted inward from the land.
 *
 * Dock 0 is the shore -- the boat unloads by touching it. Higher indices run
 * back in toward the ship, so a dock index IS the length of that boat's trip
 * home, which makes the whole economy of the game readable off one number.
 *
 * Six, and six is not negotiable. The two sides split the panel down the
 * middle, so each side has to fit every dock into half its width, and a dock
 * needs the hull's width plus clear water either side of it or the ghost row
 * reads as one bar rather than a line of moorings. Fewer docks is a shorter
 * ferry, and the ferry is what this design is for. Measured over 120 seeds
 * with the boat speed swept from 13 to 24 steps a dock:
 *
 *   6 docks  ferry is 61% of losses, lane-chasing 33%   <- shipped
 *   5 docks  ferry is 23-50%, lane-chasing 43-73%
 *   4 docks  ferry is 0-25%, lane-chasing 72-100%
 *
 * At four docks the run to the shore is three moves long and stops being a
 * decision: at the shipped boat speed *every single loss* is lane-chasing,
 * and slowing the boat to a sluggish 24 steps a dock still only buys 25%.
 * That is the exact failure the old game was rebuilt away from.
 *
 * This is what constrains the hull, and therefore the figures standing in
 * it -- see the note on the boat in render/rescue.js.
 */
export const DOCKS_PER_SIDE = 6;

/** The shore dock, where a boat unloads. */
export const SHORE_DOCK = 0;

/** The innermost dock, hard against the ship. */
export const INNER_DOCK = DOCKS_PER_SIDE - 1;

/**
 * Which dock each jump lane comes down over, on each side.
 *
 * Three lanes per side, six across the board -- twice the old game's four,
 * which is most of why the panel now reads as busy.
 *
 * They are bunched at the inner end, docks 3-4-5, and the shore is dock 0.
 * The alternative -- spreading them out to 2-3-5 or 1-3-5, the way the old
 * game spread its lanes for composition -- was measured over 60 seeds and is
 * the wrong shape here. Spreading them turns the game back into lane-chasing:
 * at 1-3-5 only 11-16% of losses came from the ferry and half came from
 * failing to cross the lane band in time. Bunched at 3-4-5, 61% of losses are
 * the ferry and the share of losses to a boat with nothing to do falls from
 * 27% to 6%.
 *
 * That is the whole point of this layout. The old game needed spread lanes
 * because the lanes were the only thing on the board; here the crowd on the
 * ship carries the composition, so the lanes are free to bunch and let the
 * run to the shore be what costs you. The lanes still differ -- a jumper at
 * dock 5 is a five-dock round trip to bank and one at dock 3 is three -- but
 * the spread between them is small enough that choosing a side matters more
 * than choosing a lane, which is the decision two boats exist to create.
 */
export const LANE_DOCK = [3, 4, 5];
export const LANES_PER_SIDE = LANE_DOCK.length;

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
 * Passengers waiting on each side's deck at the start of a run.
 *
 * 46 a side, 92 across the ship, drawn as a dense block of small figures that
 * go out one at a time as they jump. A good run empties about half of them,
 * which is enough for the thinning to read as progress from across the room.
 *
 * The number is a difficulty constant as much as a compositional one, which
 * was not obvious until the harness showed it. At 26 a side the deck ran dry
 * partway through a good run, spawning on that side stopped, and the endgame
 * quietly got easier -- runs ending on misses read 57% when the real figure
 * for those constants was 92%. Anything that can stop the spawner is a
 * difficulty cliff hiding inside a piece of scenery. 46 never empties: over
 * 60 seeds, 0% of runs exhaust either deck.
 */
export const CROWD_PER_SIDE = 46;

/** Passengers a boat can hold. */
export const CAPACITY = 4;

export const RUN_SECONDS = 60;
export const RUN_STEPS = RUN_SECONDS * STEPS_PER_SECOND;
export const MAX_MISSES = 4;

/** Points for each passenger put ashore, and the bonus for a full boat. */
export const POINTS_PER_RESCUE = 10;
export const FULL_BOAT_BONUS = 20;

/**
 * Steps a boat takes to move one dock.
 *
 * The single strongest difficulty lever in the game, because it is the price
 * of the ferry and the ferry is the game. Across the sweep it moved runs
 * ending on misses further than the spawn rate did: at the original spawn
 * cadence, 11 steps a dock gives 30%, 12 gives 40%, 13 gives 65%.
 *
 * Left alone when the rest of the game was slowed down, and that is the
 * point of leaving it alone. 13 puts a full round trip from the innermost
 * lane at 130 steps, a little over two seconds, against a fall that now takes
 * about 1.8 seconds at full pressure. The boat did not get faster; the
 * player got more time to decide where to send it. A boat that leaves for the
 * shore has still given up the next jumper on that side, which is the trade
 * the whole run is made of -- and the ferry still accounts for about half of
 * all losses at the slower pace, which is how we know the trade survived.
 */
const BOAT_MOVE_INTERVAL = 13;

/**
 * PACE
 * ----
 * Three constants set how fast the run feels, and playtesting said all three
 * were too fast. They are not interchangeable, which the harness had to be
 * asked about separately before any of them moved -- swept together they look
 * like one dial, and they are not:
 *
 *   fall speed   slower is a pure win. It buys reaction time, and because a
 *                slower arc is a longer catch window it RAISES the score
 *                (597 -> 683 over 120 seeds for a slow hand) while leaving
 *                the ferry's share of losses flat at about half.
 *   jump rate    slower is the expensive one. Rarer jumpers means a boat can
 *                finish a round trip between them, so the ferry stops costing
 *                anything: at x1.8 the ferry's share of losses goes to 0% and
 *                every remaining loss is simply arriving late. That is the
 *                game's one decision being switched off.
 *   ramp target  slower is mild and cheap; it just delays the top end.
 *
 * So the slowdown is weighted: a big cut to the fall, a small one to the jump
 * rate, a moderate one to the ramp. Sharks are deliberately NOT slowed -- with
 * everything else stretched they arrive relatively more often, which puts back
 * a little of the pressure the fall gave up.
 */

/** Difficulty is a 0..RAMP_SCALE pressure value, not a raw step count. */
const RAMP_SCALE = 1000;
/** Rescues that alone would take difficulty to maximum. Was 26. */
const RESCUE_RAMP_TARGET = 30;
const SCORE_RAMP_WEIGHT = 2;
const TIME_RAMP_WEIGHT = 1;

/** Steps between one arc stop and the next. Was 38 -> 13, which put a jumper
 *  in the water faster than a thumb on a phone could answer them. */
const FALL_INTERVAL_START = 50;
const FALL_INTERVAL_END = 18;

/** Steps between jumps. Both sides draw from this one cadence. Eased by 15%,
 *  which is as far as it goes before the ferry stops mattering. */
const SPAWN_INTERVAL_START = 112;
const SPAWN_INTERVAL_END = 40;
const SPAWN_INTERVAL_MIN = 35;
const SPAWN_JITTER = 8;
const FIRST_SPAWN_STEP = 46;

/** Sharks. */
const SHARK_INTERVAL_START = 900;
const SHARK_INTERVAL_END = 480;
const SHARK_INTERVAL_MIN = 380;
const FIRST_SHARK_STEP = 380;
const SHARK_MOVE_INTERVAL = 17;
/**
 * A shark takes the cargo and not a life -- carried over from the old game,
 * where charging a life measured three times worse: it became the thing that
 * ended runs and buried the rescue loop it exists to complicate. Taking the
 * cargo keeps it a tax on greed, which is the decision the game is about.
 */
const SHARK_COSTS_LIFE = 0;
const MAX_SHARKS_PER_SIDE = 1;
/**
 * The stretch of water a shark patrols: the lanes, and one dock outside them.
 *
 * Docks 0 and 1 are shark-free, so the last leg of the run home is the safest
 * water on the board -- the same shape the old game had, where the crossing
 * was where you could finally stop worrying.
 *
 * Turning them back at dock 2 rather than dock 1 also clears the outer water
 * for the shore art, which needs somewhere to put a jetty that is not a cell
 * a shark can occupy. It is free: over 120 seeds it moves runs ending on
 * misses from 60% to 58% and the average score not at all.
 */
const SHARK_INNER_DOCK = INNER_DOCK;
const SHARK_OUTER_DOCK = 2;

/**
 * Every dock a shark can be standing on, low to high.
 *
 * Exported because the renderer has to ghost exactly this set and no other:
 * a ghosted shark at a dock no shark can reach is a segment the player learns
 * to watch for nothing, and a lit shark at a dock that was never ghosted
 * appears out of blank glass.
 */
export const SHARK_DOCKS = Array.from(
  { length: SHARK_INNER_DOCK - SHARK_OUTER_DOCK + 1 },
  (_, i) => SHARK_OUTER_DOCK + i
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

  /** One boat per side. `target` is the dock it is driving toward. */
  function createBoat() {
    return {
      dock: INNER_DOCK,
      target: INNER_DOCK,
      aboard: 0,
      /** Passengers still on this side's deck. Drawn as the crowd. */
      waiting: CROWD_PER_SIDE,
      nextMoveStep: 0,
    };
  }

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
    /** Indexed by side. Arrays, not a Map: iteration order is load-bearing. */
    boats: [createBoat(), createBoat()],
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
    // Draw order is part of the seed: side, then lane, and jumpers are always
    // drawn before sharks. Never reorder without accepting that every seeded
    // run changes.
    const side = rng.nextIntExclusive(0, SIDES);
    const lane = rng.nextIntExclusive(0, LANES_PER_SIDE);
    const boat = state.boats[side];
    if (boat.waiting <= 0) return;
    boat.waiting -= 1;

    state.jumpers.push({
      id: nextId++,
      side,
      lane,
      stop: 0,
      nextMoveStep: state.step + ramp(FALL_INTERVAL_START, FALL_INTERVAL_END, pressure(state)),
    });
  }

  function spawnShark(side) {
    const fromInner = rng.nextIntExclusive(0, 2) === 0;
    state.sharks.push({
      id: nextSharkId++,
      side,
      pos: fromInner ? SHARK_INNER_DOCK : SHARK_OUTER_DOCK,
      dir: fromInner ? -1 : 1,
      nextMoveStep: state.step + SHARK_MOVE_INTERVAL,
    });
  }

  function deliver(boat) {
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
  function missCause(boat, wantedDock) {
    if (boat.aboard >= CAPACITY) return 'full';
    // Out past the lanes, or ordered there: this jumper was lost to the
    // ferry, which is the cost the design is trying to charge.
    if (boat.dock < MIN_LANE_DOCK || boat.target < MIN_LANE_DOCK) return 'errand';
    if (boat.target === wantedDock) return 'late';
    return 'idle';
  }

  /**
   * Advance one fixed logic step.
   *
   * @param {{left: number|null, right: number|null}} orders Target dock for
   *   each boat, or null to leave that boat's standing order alone.
   */
  function update(orders) {
    if (state.phase !== 'playing') return;

    const level = pressure(state);

    // 1. Orders. A null leaves the standing order in place, so a boat keeps
    //    running its last errand while the thumb is busy on the other side --
    //    which is the entire reason two boats are playable with one thumb.
    if (orders) {
      const wanted = [orders.left, orders.right];
      for (let side = 0; side < SIDES; side++) {
        const order = wanted[side];
        if (order === null || order === undefined) continue;
        state.boats[side].target = clamp(Math.trunc(order), SHORE_DOCK, INNER_DOCK);
      }
    }

    // 2. Boats. Moving before catches resolve keeps the last-instant save.
    for (let side = 0; side < SIDES; side++) {
      const boat = state.boats[side];
      if (boat.dock !== boat.target && state.step >= boat.nextMoveStep) {
        boat.dock += boat.target > boat.dock ? 1 : -1;
        boat.nextMoveStep = state.step + BOAT_MOVE_INTERVAL;
      }
      // 3. Touching the shore delivers everyone aboard in the same step. The
      //    boat is never held there, so the player is never not playing.
      if (boat.dock === SHORE_DOCK && boat.aboard > 0) deliver(boat);
    }

    // 4. Spawning: jumpers, then sharks. Fixed order.
    if (state.step >= nextSpawnStep) {
      spawnJumper();
      const base = ramp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, level);
      const jitter = rng.nextIntExclusive(-SPAWN_JITTER, SPAWN_JITTER + 1);
      nextSpawnStep = state.step + Math.max(SPAWN_INTERVAL_MIN, base + jitter);
    }

    if (state.step >= nextSharkStep) {
      // Side first, so the draw is consumed whether or not that side has room
      // for another shark -- a draw taken inside a conditional is a draw that
      // reorders the whole stream when the condition changes.
      const side = rng.nextIntExclusive(0, SIDES);
      let count = 0;
      for (const shark of state.sharks) if (shark.side === side) count += 1;
      if (count < MAX_SHARKS_PER_SIDE) spawnShark(side);
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
        if (shark.pos < SHARK_OUTER_DOCK || shark.pos > SHARK_INNER_DOCK) continue; // swum off

        const boat = state.boats[shark.side];
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
      const boat = state.boats[j.side];
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
        state.missCauses[missCause(boat, dock)] += 1;
        state.missFlash = MISS_FLASH_STEPS;
        state.splashes.push({ side: j.side, lane: j.lane, age: 0 });
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
