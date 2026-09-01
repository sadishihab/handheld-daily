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
  createParachuteGame,
  RUN_STEPS,
  MAX_MISSES,
  LANES,
  STOPS,
  SHORE_DOCK,
  CAPACITY,
  SPLASH_STOP,
  SHORE_GAP,
} from '../src/games/parachute.js';
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
// Parachute rescue
// -----------------------------------------------------------------------

/**
 * A blind input script: a fixed pattern of held directions, derived from its
 * own seeded RNG so it is a fixed sequence rather than a live reaction.
 * Two runs given the same script must agree exactly.
 */
function recordInputScript(seed, steps) {
  const rng = createRng(seed);
  const script = new Array(steps);
  let held = { left: false, right: false };
  let holdUntil = 0;

  for (let step = 0; step < steps; step++) {
    if (step >= holdUntil) {
      const choice = rng.nextIntExclusive(0, 3);
      held = { left: choice === 0, right: choice === 1 };
      holdUntil = step + rng.nextIntExclusive(6, 40);
    }
    script[step] = held;
  }
  return script;
}

/**
 * A reactive policy: steer toward the lowest unresolved parachutist. Reading
 * state makes input a function of the simulation, which is still fully
 * deterministic -- and unlike the blind script it reliably scores, so the
 * test would catch a game that silently stopped registering catches.
 */
function chasePolicy(state) {
  // Full boat: the only legal move is the shore.
  if (state.aboard >= CAPACITY) {
    return { left: state.boatDock > SHORE_DOCK, right: state.boatDock < SHORE_DOCK };
  }
  let target = null;
  for (const p of state.parachutists) {
    if (p.doomed) continue;
    if (target === null || p.stop > target.stop) target = p;
  }
  if (target === null) return { left: false, right: false };
  return { left: target.lane < state.boatDock, right: target.lane > state.boatDock };
}

/** Play a full run and return a trace plus the final outcome. */
function playScripted(seed, script) {
  const game = createParachuteGame({ seed });
  const trace = [];
  for (let step = 0; step < script.length && !game.isOver; step++) {
    game.update(script[step]);
    const s = game.state;
    trace.push(
      `${s.step}|${s.score}|${s.rescued}|${s.aboard}|${s.misses}|${s.boatDock}|` +
      `${s.parachutists.map((p) => `${p.id}:${p.lane}:${p.stop}:${p.doomed ? 1 : 0}`).join(';')}|` +
      `${s.sharks.map((k) => `${k.id}:${k.pos}:${k.dir}`).join(';')}`
    );
  }
  return { game, trace: trace.join('\n'), state: game.state };
}

function playReactive(seed) {
  const game = createParachuteGame({ seed });
  const trace = [];
  while (!game.isOver) {
    game.update(chasePolicy(game.state));
    const s = game.state;
    trace.push(`${s.step}|${s.score}|${s.rescued}|${s.aboard}|${s.misses}|${s.boatDock}`);
  }
  return { game, trace: trace.join('\n'), state: game.state };
}

// Seed 31 gives a script that actually delivers survivors; a script that
// scores zero would let the final-score assertion below pass on 0 === 0.
const script = recordInputScript(31, RUN_STEPS);

const scriptedA = playScripted(12345, script);
const scriptedB = playScripted(12345, script);
const gameBytesA = Buffer.from(scriptedA.trace, 'utf8');
const gameBytesB = Buffer.from(scriptedB.trace, 'utf8');

check(
  'same seed + same input script produces an identical final score',
  scriptedA.state.score === scriptedB.state.score,
  `${scriptedA.state.score} vs ${scriptedB.state.score}`
);
check(
  'same seed + same input script produces a byte-identical run',
  gameBytesA.length === gameBytesB.length && Buffer.compare(gameBytesA, gameBytesB) === 0
);
check(
  'same seed + same input script ends the same way',
  scriptedA.state.step === scriptedB.state.step &&
    scriptedA.state.endReason === scriptedB.state.endReason,
  `${scriptedA.state.step}/${scriptedA.state.endReason} vs ${scriptedB.state.step}/${scriptedB.state.endReason}`
);

const scriptedOtherSeed = playScripted(12346, script);
check(
  'a different seed changes the run',
  scriptedOtherSeed.trace !== scriptedA.trace
);

const otherScript = recordInputScript(15, RUN_STEPS);
check(
  'a different input script changes the run',
  playScripted(12345, otherScript).trace !== scriptedA.trace
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
// summary alone is far too coarse: widening the run to the shore moved the
// boat onto docks that had not existed before, from step 22 of this very
// seed, and still ended on the same score, rescues, misses and step. A
// fingerprint that reads "unchanged" through a change like that is worse
// than none, because it is trusted. The summary is kept alongside so a
// failure says something human before it says a hash mismatched.
//
// Re-baselined three times, all before release:
//   1. when positions became discrete LCD segments (lanes and stops rather
//      than columns and fixed-point rows);
//   2. when the rescue loop landed -- boat capacity, the shore run and sharks
//      all draw from the same RNG stream, and the difficulty ramp was retuned
//      around them, so no pre-rescue run could survive unchanged;
//   3. when the unload was shortened and paid for with open water between the
//      last lane and the shore, which changes both the dock range the boat
//      moves over and when deliveries land, and so the spawn ramp with them;
//   4. when the unload became instant and SHORE_GAP grew to 5 to pay for it.
//      The dock range widened again, and delivery now lands on the step the
//      boat touches the shore rather than 50 steps later, so every rescue in
//      a run shifts and the difficulty ramp shifts under it.
const GOLDEN = {
  seed: 12345,
  scriptSeed: 31,
  score: 30,
  rescued: 3,
  misses: 4,
  step: 1075,
  endReason: 'misses',
  trace: '5c5f1174d2aff56c',
};
const golden = playScripted(GOLDEN.seed, recordInputScript(GOLDEN.scriptSeed, RUN_STEPS));
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
  const game = createParachuteGame({ seed: 12345 });
  let allIntegers = true;
  let allInRange = true;
  let boatInRange = true;

  while (!game.isOver) {
    game.update(chasePolicy(game.state));
    const s = game.state;

    if (!Number.isInteger(s.boatDock)) allIntegers = false;
    if (s.boatDock < 0 || s.boatDock > SHORE_DOCK) boatInRange = false;

    for (const p of s.parachutists) {
      if (!Number.isInteger(p.lane) || !Number.isInteger(p.stop)) allIntegers = false;
      if (p.lane < 0 || p.lane >= LANES) allInRange = false;
      if (p.stop < 0 || p.stop > SPLASH_STOP) allInRange = false;
    }

    for (const k of s.sharks) {
      if (!Number.isInteger(k.pos)) allIntegers = false;
      if (k.pos < -1 || k.pos > LANES) allInRange = false;
    }
  }

  check('every position is an integer', allIntegers);
  check('every parachutist sits on a real lane and stop', allInRange);
  check('the boat sits on a real dock', boatInRange);
}

// The shore sits past the last lane with SHORE_GAP docks of open water in
// between -- water the boat can cross but cannot catch or be bitten in, which
// is what makes the trip, rather than the unload, the price of a delivery.
check(
  'the layout is a small fixed set of segments',
  Number.isInteger(LANES) &&
    Number.isInteger(STOPS) &&
    Number.isInteger(SHORE_GAP) &&
    SHORE_GAP >= 0 &&
    SHORE_DOCK === LANES + SHORE_GAP &&
    STOPS > 1,
  `${LANES} lanes, ${STOPS} stops, ${SHORE_GAP} of open water, shore at ${SHORE_DOCK}`
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
  'a competent player actually delivers survivors',
  reactiveA.state.rescued > 4 && reactiveA.state.score > 0,
  `rescued ${reactiveA.state.rescued}, score ${reactiveA.state.score}`
);

check(
  'catching alone never scores -- only delivery does',
  (() => {
    // Never move: the boat can still be landed on at its starting dock, but
    // it never reaches the shore, so nothing may score.
    const stuck = createParachuteGame({ seed: 4242 });
    while (!stuck.isOver) stuck.update({ left: false, right: false });
    return stuck.state.score === 0 && stuck.state.rescued === 0;
  })(),
  'a run that never reached shore still scored'
);

// Both end conditions must be reachable.
check(
  'running out of lives ends the run early',
  (() => {
    const idle = createParachuteGame({ seed: 12345 });
    while (!idle.isOver) idle.update({ left: false, right: false });
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
    // Seed 7 is survivable by the chase policy for the full minute.
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
    for (let i = 0; i < 100; i++) done.update({ left: true, right: false });
    return JSON.stringify(done.state) === before;
  })()
);

// The game must be driveable through the real loop at any frame rate.
function playThroughLoop(seed, script, frameMs) {
  const game = createParachuteGame({ seed });
  const loop = createLoop({
    update() {
      if (game.isOver) return;
      game.update(script[game.state.step] || { left: false, right: false });
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
