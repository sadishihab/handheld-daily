/**
 * Determinism test -- plain Node, no framework, no dependencies.
 *
 *   node test/determinism.test.js
 *
 * Guards the property the whole game rests on: the same seed produces the
 * same run, everywhere, forever. If this file fails, the daily puzzle is not
 * shareable and scores are not comparable.
 */

import { createHash } from 'node:crypto';

import { createRng } from '../src/rng.js';
import { createLoop, FIXED_STEP_MS } from '../src/loop.js';
import {
  createRescueGame,
  RUN_STEPS,
  MAX_MISSES,
  SIDES,
  DOCKS_PER_SIDE,
  SHORE_DOCK,
  INNER_DOCK,
  LANE_DOCK,
  LANES_PER_SIDE,
  MIN_LANE_DOCK,
  ARC_STOPS,
  SPLASH_STOP,
  CAPACITY,
  CROWD_PER_SIDE,
  SHARK_DOCKS,
  SPLASH_STEPS,
  SPLASH_FRAME_COUNT,
  MISS_CAUSES,
  splashFrame,
} from '../src/games/rescue.js';
import {
  dailySeed,
  puzzleNumber,
  msUntilNextPuzzle,
  utcDateString,
  LAUNCH_DATE_UTC,
} from '../src/daily.js';

const STEPS = 1000;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

/**
 * A stand-in for real game logic: no rendering, no input, but it exercises
 * the things that break determinism -- integer accumulation, float
 * accumulation, and branching on RNG output.
 */
function createDummySim(seed) {
  const rng = createRng(seed);
  const state = { x: 0, drift: 0, bag: [] };
  const trace = [];

  return {
    trace,
    update(stepIndex) {
      state.x += rng.nextIntExclusive(-3, 4);
      state.drift = state.drift * 0.99 + rng.nextFloat();
      if (stepIndex % 100 === 0) state.bag.push(rng.nextIntExclusive(0, 1000));
      // Full precision on purpose: Number#toString round-trips exactly, so a
      // one-bit difference in the float path shows up as a byte difference.
      trace.push(`${stepIndex}|${state.x}|${state.drift}|${state.bag.length}`);
    },
  };
}

/** Run the dummy sim for `steps` fixed steps, driven by frames of `frameMs`. */
function run(seed, steps, frameMs = FIXED_STEP_MS) {
  const sim = createDummySim(seed);
  const loop = createLoop({ update: sim.update });
  while (loop.stepCount < steps) loop.advance(frameMs);
  return sim.trace.slice(0, steps).join('\n');
}

console.log('determinism\n');

// 1. Same seed, same run -- byte for byte.
const runA = run(12345, STEPS);
const runB = run(12345, STEPS);
const bytesA = Buffer.from(runA, 'utf8');
const bytesB = Buffer.from(runB, 'utf8');

check(
  `same seed produces byte-identical output over ${STEPS} steps`,
  bytesA.length === bytesB.length && Buffer.compare(bytesA, bytesB) === 0,
  `lengths ${bytesA.length} vs ${bytesB.length}`
);

// 2. Different seeds must actually diverge.
const runC = run(12346, STEPS);
check(
  'different seeds produce different output',
  runC !== runA,
  'seeds 12345 and 12346 produced the same trace'
);

// 3. Frame rate must not change the simulation.
const at120 = run(12345, STEPS, 1000 / 120);
const at30 = run(12345, STEPS, 1000 / 30);
check('120Hz frames match 60Hz frames', at120 === runA);
check('30Hz frames match 60Hz frames', at30 === runA);

// 4. Ragged, jittery frame times must not change it either.
const jitterSim = createDummySim(12345);
const jitterLoop = createLoop({ update: jitterSim.update });
const jitterRng = createRng(999); // drives the frame pacing, not the sim
while (jitterLoop.stepCount < STEPS) {
  jitterLoop.advance(jitterRng.nextIntExclusive(0, 40));
}
check('jittery frame times match steady 60Hz', jitterSim.trace.slice(0, STEPS).join('\n') === runA);

// 5. The RNG itself.
const rng1 = createRng(7);
const rng2 = createRng(7);
check(
  'rng streams from the same seed agree',
  Array.from({ length: 100 }, () => rng1.nextUint32()).join() ===
    Array.from({ length: 100 }, () => rng2.nextUint32()).join()
);

const sample = createRng(4242);
let inRange = true;
let seenBelowHalf = false;
let seenAboveHalf = false;
for (let i = 0; i < 10000; i++) {
  const f = sample.nextFloat();
  if (f < 0 || f >= 1) inRange = false;
  if (f < 0.5) seenBelowHalf = true;
  else seenAboveHalf = true;
}
check('nextFloat stays in [0, 1) and spans it', inRange && seenBelowHalf && seenAboveHalf);

const ints = createRng(31337);
let intsInRange = true;
const histogram = new Array(6).fill(0);
for (let i = 0; i < 60000; i++) {
  const v = ints.nextIntExclusive(0, 6);
  if (!Number.isInteger(v) || v < 0 || v >= 6) intsInRange = false;
  histogram[v] += 1;
}
check('nextIntExclusive stays in [min, max)', intsInRange, `histogram ${histogram.join()}`);
// 10000 expected per bucket; a badly biased generator misses by far more.
check(
  'nextIntExclusive is roughly uniform',
  histogram.every((count) => Math.abs(count - 10000) < 500),
  `histogram ${histogram.join()}`
);

// 6. Daily seeds depend on the UTC day and nothing else.
const morningUtc = Date.parse('2026-08-31T00:00:01Z');
const eveningUtc = Date.parse('2026-08-31T23:59:59Z');
check('same UTC day yields the same seed', dailySeed(morningUtc) === dailySeed(eveningUtc));

// Same instant, expressed in three timezones. All are UTC 2026-08-31 12:00.
const asUtc = Date.parse('2026-08-31T12:00:00Z');
const asTokyo = Date.parse('2026-08-31T21:00:00+09:00');
const asLosAngeles = Date.parse('2026-08-31T05:00:00-07:00');
check(
  'timezone offsets do not change the seed',
  dailySeed(asUtc) === dailySeed(asTokyo) && dailySeed(asUtc) === dailySeed(asLosAngeles),
  `${dailySeed(asUtc)} / ${dailySeed(asTokyo)} / ${dailySeed(asLosAngeles)}`
);

// Local midnight in Tokyo is still the previous UTC day -- that is intended.
const tokyoMidnight = Date.parse('2026-08-31T00:00:00+09:00');
check(
  'rollover follows UTC midnight, not local midnight',
  utcDateString(tokyoMidnight) === '2026-08-30' &&
    dailySeed(tokyoMidnight) === dailySeed(Date.parse('2026-08-30T12:00:00Z'))
);

check(
  'consecutive days get unrelated seeds',
  dailySeed(Date.parse('2026-08-31T12:00:00Z')) !== dailySeed(Date.parse('2026-09-01T12:00:00Z'))
);

check('seed is a uint32', Number.isInteger(dailySeed(asUtc)) && dailySeed(asUtc) >>> 0 === dailySeed(asUtc));

// 7. Puzzle numbering and countdown.
// Derived from LAUNCH_DATE_UTC rather than hardcoded, so moving the
// placeholder launch date does not require editing these assertions.
const launchDay = Date.parse(`${LAUNCH_DATE_UTC}T00:00:00Z`);
check('launch day is puzzle #1', puzzleNumber(launchDay) === 1);
check('the day after launch is puzzle #2', puzzleNumber(launchDay + 86400000) === 2);
check('the day before launch is puzzle #0', puzzleNumber(launchDay - 86400000) === 0);
check(
  'puzzle number advances one per UTC day across a month boundary',
  puzzleNumber(Date.parse('2026-09-01T00:00:00Z')) -
    puzzleNumber(Date.parse('2026-08-31T00:00:00Z')) === 1
);
check(
  'countdown is a full day at UTC midnight',
  msUntilNextPuzzle(Date.parse('2026-08-31T00:00:00Z')) === 86400000
);
check(
  'countdown is one second before the next UTC midnight',
  msUntilNextPuzzle(Date.parse('2026-08-31T23:59:59Z')) === 1000
);

// 8. The backgrounded-tab clamp.
let spiralSteps = 0;
const spiralLoop = createLoop({ update: () => { spiralSteps += 1; } });
spiralLoop.advance(10 * 60 * 1000); // ten minutes in one frame
check(
  'a ten-minute frame gap does not queue ten minutes of logic',
  spiralSteps > 0 && spiralSteps <= 15,
  `ran ${spiralSteps} steps`
);




// -----------------------------------------------------------------------
// Ship rescue
// -----------------------------------------------------------------------

/**
 * A blind order script, derived from its own seeded RNG so it is a fixed
 * sequence rather than a live reaction.
 *
 * Shaped like a thumb rather than like a controller: one side is addressed at
 * a time, and the order stands for a while before the next one. That is what
 * the real input produces, so it is what a replay has to be able to reproduce.
 */
function recordOrderScript(seed, steps) {
  const rng = createRng(seed);
  const script = new Array(steps);
  let held = { left: null, right: null };
  let holdUntil = 0;

  for (let step = 0; step < steps; step++) {
    if (step >= holdUntil) {
      const side = rng.nextIntExclusive(0, SIDES);
      const dock = rng.nextIntExclusive(0, DOCKS_PER_SIDE);
      held = { left: side === 0 ? dock : null, right: side === 1 ? dock : null };
      holdUntil = step + rng.nextIntExclusive(6, 40);
    }
    script[step] = held;
  }
  return script;
}

/**
 * A reactive policy: send each boat to whichever jumper on its side is
 * furthest down, and run for the shore once it is full. Reading state makes
 * input a function of the simulation, which is still fully deterministic --
 * and unlike the blind script it reliably scores, so the test would catch a
 * game that silently stopped registering catches.
 */
function chasePolicy(state) {
  const order = { left: null, right: null };
  for (let side = 0; side < SIDES; side++) {
    const boat = state.boats[side];
    const key = side === 0 ? 'left' : 'right';
    if (boat.aboard >= CAPACITY) {
      order[key] = SHORE_DOCK;
      continue;
    }
    let target = null;
    for (const j of state.jumpers) {
      if (j.side !== side) continue;
      if (target === null || j.stop > target.stop) target = j;
    }
    if (target !== null) order[key] = LANE_DOCK[target.lane];
    else if (boat.aboard > 0) order[key] = SHORE_DOCK;
  }
  return order;
}

/** Play a full run and return a trace plus the final outcome. */
function playScripted(seed, script) {
  const game = createRescueGame({ seed });
  const trace = [];
  for (let step = 0; step < script.length && !game.isOver; step++) {
    game.update(script[step]);
    const s = game.state;
    trace.push(
      `${s.step}|${s.score}|${s.rescued}|${s.misses}|` +
      `${s.boats.map((b) => `${b.dock}:${b.target}:${b.aboard}:${b.waiting}`).join(',')}|` +
      `${s.jumpers.map((j) => `${j.id}:${j.side}:${j.lane}:${j.stop}`).join(';')}|` +
      `${s.sharks.map((k) => `${k.id}:${k.side}:${k.pos}:${k.dir}`).join(';')}|` +
      `${s.splashes.map((x) => `${x.side}:${x.lane}:${x.age}`).join(';')}`
    );
  }
  return { game, trace: trace.join('\n'), state: game.state };
}

function playReactive(seed) {
  const game = createRescueGame({ seed });
  const trace = [];
  while (!game.isOver) {
    game.update(chasePolicy(game.state));
    const s = game.state;
    trace.push(`${s.step}|${s.score}|${s.rescued}|${s.misses}|${s.boats.map((b) => `${b.dock}:${b.aboard}`).join(',')}`);
  }
  return { game, trace: trace.join('\n'), state: game.state };
}

// Seed 10 gives a script that actually delivers passengers; a script that
// scored zero would let the final-score assertion below pass on 0 === 0.
//
// Blind input scores far more readily than it did in the old game -- 165 of
// the first 200 script seeds deliver someone, against 40 of the first 400
// before the rebuild. That is the order-based control showing up in the
// numbers: a random order still parks a boat somewhere useful and leaves it
// there, where a random held direction mostly drove into a wall.
const script = recordOrderScript(10, RUN_STEPS);

const scriptedA = playScripted(12345, script);
const scriptedB = playScripted(12345, script);
const gameBytesA = Buffer.from(scriptedA.trace, 'utf8');
const gameBytesB = Buffer.from(scriptedB.trace, 'utf8');

check(
  'same seed + same order script produces an identical final score',
  scriptedA.state.score === scriptedB.state.score,
  `${scriptedA.state.score} vs ${scriptedB.state.score}`
);
check(
  'same seed + same order script produces a byte-identical run',
  gameBytesA.length === gameBytesB.length && Buffer.compare(gameBytesA, gameBytesB) === 0
);
check(
  'same seed + same order script ends the same way',
  scriptedA.state.step === scriptedB.state.step &&
    scriptedA.state.endReason === scriptedB.state.endReason,
  `${scriptedA.state.step}/${scriptedA.state.endReason} vs ${scriptedB.state.step}/${scriptedB.state.endReason}`
);

check('a different seed changes the run', playScripted(12346, script).trace !== scriptedA.trace);
check(
  'a different order script changes the run',
  playScripted(12345, recordOrderScript(15, RUN_STEPS)).trace !== scriptedA.trace
);

// An order to one boat must not disturb the other. With two boats sharing one
// update() this is the mistake that would be easiest to make and hardest to
// see: the run would still be deterministic, just wrong.
check(
  'an order to one boat leaves the other one under its own standing order',
  (() => {
    const game = createRescueGame({ seed: 5 });
    game.update({ left: SHORE_DOCK, right: null });
    const rightTarget = game.state.boats[1].target;
    for (let i = 0; i < 60; i++) game.update({ left: INNER_DOCK, right: null });
    return game.state.boats[1].target === rightTarget;
  })()
);

// A null order is not the same as an order to stay put: the boat has to keep
// running the errand it was already given, which is the whole reason one
// thumb can drive two boats.
check(
  'a boat keeps running its last order while the thumb is elsewhere',
  (() => {
    const game = createRescueGame({ seed: 5 });
    game.update({ left: SHORE_DOCK, right: null });
    const startedAt = game.state.boats[0].dock;
    for (let i = 0; i < 200; i++) game.update({ left: null, right: null });
    return game.state.boats[0].dock === SHORE_DOCK && startedAt !== SHORE_DOCK;
  })()
);


// A golden fingerprint. Unlike the assertions above, which only compare runs
// to each other, this pins the actual content of a seeded run. It fails if
// the RNG draw order, the tuning constants or the update order change --
// each of which silently hands every player a different puzzle. Before
// launch that is fine: update the numbers. After launch it invalidates
// results players have already shared, so treat a failure here as a
// deliberate decision rather than a number to re-baseline.
//
// It pins a digest of the whole trace, not just the closing summary. The
// summary alone is far too coarse: in the old game, widening the run to the
// shore moved the boat onto docks that had not existed before from step 22 of
// a seed, and the run still ended on the same score, rescues, misses and
// step. A fingerprint that reads "unchanged" through a change like that is
// worse than none, because it is trusted. The summary is kept alongside so a
// failure says something human before it says a hash mismatched.
//
// Re-baselined five times for the parachute game, all before release, and
// then once more here:
//   6. the rebuild. The parachute descent became a dual-panel ship rescue:
//      two boats under independent orders rather than one under a held
//      direction, six jump lanes rather than four descent lanes, a crowd on
//      the ship that the spawner draws from, and every tuning constant reset
//      against a harness that models a thumb. Nothing about the old seed
//      survives, and nothing was meant to.
//   7. the slowdown. Playtesting said the run was too fast to read, so the
//      fall was stretched by about a third, the jump cadence by 15%, and the
//      difficulty ramp given four more rescues to climb. Three constants, but
//      every seeded run changes: a different fall interval moves every jumper
//      and therefore every catch. The control schemes are NOT in this
//      fingerprint and cannot be -- a scheme only decides which order pair
//      reaches update(), and the fingerprint is taken over a fixed script of
//      order pairs precisely so that it measures the simulation and not the
//      hand.
const GOLDEN = {
  seed: 12345,
  scriptSeed: 10,
  score: 20,
  rescued: 2,
  misses: 4,
  step: 854,
  endReason: 'misses',
  trace: '784d08392e710d11',
};
const golden = playScripted(GOLDEN.seed, recordOrderScript(GOLDEN.scriptSeed, RUN_STEPS));
const goldenRun = golden.state;
const goldenTrace = createHash('sha256').update(golden.trace).digest('hex').slice(0, 16);
check(
  'seeded run still produces its recorded outcome (golden fingerprint)',
  goldenRun.score === GOLDEN.score &&
    goldenRun.rescued === GOLDEN.rescued &&
    goldenRun.misses === GOLDEN.misses &&
    goldenRun.step === GOLDEN.step &&
    goldenRun.endReason === GOLDEN.endReason &&
    goldenTrace === GOLDEN.trace,
  `got score ${goldenRun.score}, rescued ${goldenRun.rescued}, misses ${goldenRun.misses}, ` +
    `step ${goldenRun.step}, ${goldenRun.endReason}, trace ${goldenTrace}`
);

// Positions are discrete LCD segments: small integers, never between cells.
// This is the strongest form of the "prefer integers" rule -- with no
// fixed-point and no floats anywhere in a position, there is nothing left to
// accumulate rounding error over a long run.
{
  const game = createRescueGame({ seed: 12345 });
  let allIntegers = true;
  let allInRange = true;
  let crowdSane = true;

  while (!game.isOver) {
    game.update(chasePolicy(game.state));
    const s = game.state;

    for (const boat of s.boats) {
      if (!Number.isInteger(boat.dock) || !Number.isInteger(boat.target)) allIntegers = false;
      if (boat.dock < SHORE_DOCK || boat.dock > INNER_DOCK) allInRange = false;
      if (boat.target < SHORE_DOCK || boat.target > INNER_DOCK) allInRange = false;
      if (!Number.isInteger(boat.aboard) || boat.aboard < 0 || boat.aboard > CAPACITY) allInRange = false;
      if (!Number.isInteger(boat.waiting) || boat.waiting < 0 || boat.waiting > CROWD_PER_SIDE) {
        crowdSane = false;
      }
    }

    for (const j of s.jumpers) {
      if (!Number.isInteger(j.side) || !Number.isInteger(j.lane) || !Number.isInteger(j.stop)) {
        allIntegers = false;
      }
      if (j.side < 0 || j.side >= SIDES) allInRange = false;
      if (j.lane < 0 || j.lane >= LANES_PER_SIDE) allInRange = false;
      if (j.stop < 0 || j.stop > SPLASH_STOP) allInRange = false;
    }

    for (const k of s.sharks) {
      if (!Number.isInteger(k.pos)) allIntegers = false;
      // A shark is kept one step past either end of its patrol so the step
      // that carries it off the board is legal.
      if (k.pos < SHARK_DOCKS[0] - 1 || k.pos > SHARK_DOCKS[SHARK_DOCKS.length - 1] + 1) {
        allInRange = false;
      }
    }

    for (const x of s.splashes) {
      if (!Number.isInteger(x.age) || !Number.isInteger(x.side) || !Number.isInteger(x.lane)) {
        allIntegers = false;
      }
      if (x.age < 0 || x.age >= SPLASH_STEPS) allInRange = false;
      const frame = splashFrame(x);
      if (!Number.isInteger(frame) || frame < 0 || frame >= SPLASH_FRAME_COUNT) allInRange = false;
    }
  }

  check('every position is an integer', allIntegers);
  check('every entity sits on a real segment of the board', allInRange);
  check('the crowd on deck never goes negative or grows', crowdSane);
}

// The layout: two mirrored sides, the shore at the outer end of each, and no
// jump lane close enough to it that the ferry could be skipped.
check(
  'the layout is a small fixed set of segments',
  Number.isInteger(SIDES) && SIDES === 2 &&
    Number.isInteger(DOCKS_PER_SIDE) && DOCKS_PER_SIDE > 2 &&
    SHORE_DOCK === 0 &&
    INNER_DOCK === DOCKS_PER_SIDE - 1 &&
    Number.isInteger(ARC_STOPS) && ARC_STOPS > 1 &&
    SPLASH_STOP === ARC_STOPS,
  `${SIDES} sides, ${DOCKS_PER_SIDE} docks, ${ARC_STOPS} arc stops`
);

check(
  'each lane has its own dock, none of them the shore or beside it',
  LANE_DOCK.length === LANES_PER_SIDE &&
    MIN_LANE_DOCK === LANE_DOCK[0] &&
    LANE_DOCK.every((d, i) =>
      Number.isInteger(d) && d > SHORE_DOCK + 1 && d <= INNER_DOCK && (i === 0 || d > LANE_DOCK[i - 1])
    ),
  JSON.stringify(LANE_DOCK)
);

check(
  'the shore is out of reach of every shark',
  SHARK_DOCKS.every((d) => d > SHORE_DOCK) && SHARK_DOCKS.length > 0,
  `sharks patrol ${SHARK_DOCKS.join(', ')}`
);

check(
  'the boat capacity is an integer count',
  Number.isInteger(CAPACITY) && CAPACITY > 1,
  `capacity ${CAPACITY}`
);

const reactiveA = playReactive(12345);
const reactiveB = playReactive(12345);
check(
  'a reactive policy replays identically',
  reactiveA.trace === reactiveB.trace && reactiveA.state.score === reactiveB.state.score
);

// Guards against the game silently scoring nothing, which would make every
// determinism assertion above pass on a broken game.
check(
  'a competent player actually delivers passengers',
  reactiveA.state.rescued > 8 && reactiveA.state.score > 0,
  `rescued ${reactiveA.state.rescued}, score ${reactiveA.state.score}`
);

// Both boats have to be worth using. A run where one side never scores would
// mean the second panel is decoration, which is the failure this whole design
// is built to avoid.
check(
  'both sides of the board are actually played',
  (() => {
    const game = createRescueGame({ seed: 12345 });
    const jumped = [0, 0];
    let before = game.state.boats.map((b) => b.waiting);
    while (!game.isOver) {
      game.update(chasePolicy(game.state));
      const now = game.state.boats.map((b) => b.waiting);
      for (let side = 0; side < SIDES; side++) jumped[side] += before[side] - now[side];
      before = now;
    }
    return jumped[0] > 4 && jumped[1] > 4;
  })(),
  'one side of the ship never sent anyone over'
);

check(
  'catching alone never scores -- only delivery does',
  (() => {
    // Never order anything: the boats sit at their starting docks, which are
    // lanes, so catches happen but nothing ever reaches a shore.
    const stuck = createRescueGame({ seed: 4242 });
    while (!stuck.isOver) stuck.update({ left: null, right: null });
    return stuck.state.score === 0 && stuck.state.rescued === 0;
  })(),
  'a run that never reached shore still scored'
);

// Every miss is attributed, and the attribution adds up. The harness tunes
// against these counts, so a cause that silently stopped being recorded would
// quietly corrupt every tuning decision made afterwards.
check(
  'every miss is attributed to exactly one cause',
  (() => {
    const game = createRescueGame({ seed: 909 });
    while (!game.isOver) game.update(chasePolicy(game.state));
    const total = MISS_CAUSES.reduce((sum, cause) => sum + game.state.missCauses[cause], 0);
    return total === game.state.misses && game.state.misses > 0;
  })()
);

// A miss has to produce the flail-and-splash, and the splash has to clear
// itself up. A leak here would grow the state object for the whole run.
check(
  'a miss raises a splash that ages out',
  (() => {
    const game = createRescueGame({ seed: 4242 });
    let sawSplash = false;
    let maxLive = 0;
    while (!game.isOver) {
      game.update({ left: null, right: null });
      if (game.state.splashes.length > 0) sawSplash = true;
      maxLive = Math.max(maxLive, game.state.splashes.length);
      for (const x of game.state.splashes) if (x.age >= SPLASH_STEPS) return false;
    }
    return sawSplash && maxLive <= SIDES * LANES_PER_SIDE;
  })()
);

// Both end conditions must be reachable.
check(
  'running out of lives ends the run early',
  (() => {
    const idle = createRescueGame({ seed: 12345 });
    while (!idle.isOver) idle.update({ left: null, right: null });
    return (
      idle.state.endReason === 'misses' &&
      idle.state.misses === MAX_MISSES &&
      idle.state.step < RUN_STEPS
    );
  })()
);

check(
  'a run that keeps its lives ends on the clock',
  (() => {
    const timed = playReactive(7);
    return timed.state.endReason === 'time' && timed.state.step === RUN_STEPS;
  })(),
  'seed 7 no longer reaches 60s under the chase policy -- retune or repick the seed'
);

check(
  'update after the run has ended is a no-op',
  (() => {
    const done = playScripted(12345, script).game;
    const before = JSON.stringify(done.state);
    for (let i = 0; i < 100; i++) done.update({ left: SHORE_DOCK, right: SHORE_DOCK });
    return JSON.stringify(done.state) === before;
  })()
);

// The game must be driveable through the real loop at any frame rate.
function playThroughLoop(seed, orders, frameMs) {
  const game = createRescueGame({ seed });
  const loop = createLoop({
    update() {
      if (game.isOver) return;
      game.update(orders[game.state.step] || { left: null, right: null });
    },
  });
  while (!game.isOver && loop.stepCount < RUN_STEPS + 10) loop.advance(frameMs);
  return `${game.state.step}|${game.state.score}|${game.state.misses}|${game.state.endReason}`;
}

const via60 = playThroughLoop(12345, script, FIXED_STEP_MS);
const via120 = playThroughLoop(12345, script, 1000 / 120);
const via30 = playThroughLoop(12345, script, 1000 / 30);
check('the game plays identically at 120Hz and 60Hz', via120 === via60, `${via120} vs ${via60}`);
check('the game plays identically at 30Hz and 60Hz', via30 === via60, `${via30} vs ${via60}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
