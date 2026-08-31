/**
 * Determinism test -- plain Node, no framework, no dependencies.
 *
 *   node test/determinism.test.js
 *
 * Guards the property the whole game rests on: the same seed produces the
 * same run, everywhere, forever. If this file fails, the daily puzzle is not
 * shareable and scores are not comparable.
 */

import { createRng } from '../src/rng.js';
import { createLoop, FIXED_STEP_MS } from '../src/loop.js';
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
