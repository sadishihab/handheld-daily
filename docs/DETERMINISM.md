# Determinism rules

Handheld Daily gives every player the same puzzle each UTC day. Scores are
only comparable, and results only shareable, if the same seed produces the
same run on every device. That is a property the code has to actively
maintain -- it breaks silently and it breaks permanently, because a puzzle
that played differently yesterday cannot be un-played.

These are the rules any code under `src/` that participates in the simulation
must follow.

## 1. Seeded RNG only

All randomness comes from `createRng(seed)` in `src/rng.js`.

```js
import { createRng } from './rng.js';
const rng = createRng(seed);
const roll = rng.nextIntExclusive(0, 6);   // 0..5 -- max is EXCLUSIVE
const t    = rng.nextFloat();     // [0, 1)
```

Never call `Math.random()` in simulation code. Not for a tiebreak, not for a
"cosmetic" wobble, not in a debug branch. There is no such thing as a
cosmetic random number in a shared daily puzzle: anything that consumes a
draw shifts every subsequent draw.

`nextIntExclusive` is half-open (`min` inclusive, `max` exclusive) so that
`nextIntExclusive(0, arr.length)` is always a valid index.

**Draw order is part of the seed.** Two calls in a different order give a
different run. Reordering draws, adding a draw inside a conditional, or
consuming a draw you end up discarding all change the puzzle. Treat the
sequence of RNG calls as load-bearing.

Purely visual randomness -- particle jitter, screen shake -- is fine with
`Math.random()`, but only in render code that never writes back into
simulation state.

## 2. No clock reads inside the simulation

`src/daily.js` is the only module allowed to look at wall-clock time. It
converts the current UTC date into an integer seed, and that integer is the
only thing that crosses into the simulation.

Inside simulation code: no `Date.now()`, no `new Date()`, no
`performance.now()`. If logic needs to know how much time has passed, it
counts steps -- the loop hands `update()` a monotonic integer step index, and
60 steps is one simulated second.

```js
// wrong -- real time leaks in, and the run stops being reproducible
if (Date.now() - startedAt > 5000) expire();

// right -- simulated time, identical on every device
if (stepIndex - startedAtStep > 5 * STEPS_PER_SECOND) expire();
```

## 3. Fixed timestep, never a variable delta

`src/loop.js` runs logic at exactly 60 steps per simulated second and
decouples that from `requestAnimationFrame`. A 60Hz phone and a 120Hz phone
run the same number of `update()` calls for the same elapsed time; only the
number of `render()` calls differs.

`update()` receives the integer step index and **no delta**, deliberately. A
delta parameter is how variable-timestep bugs come back: someone writes
`x += v * dt` and the simulation quietly starts depending on frame rate. Code
that needs a duration multiplies by the exported `FIXED_DELTA_SECONDS`
constant.

`render(alpha)` is the escape hatch. It runs once per frame, gets the
interpolation fraction left in the accumulator, and may use floats, wall-clock
time and `Math.random()` freely -- because nothing it does is allowed to feed
back into simulation state.

The accumulator is clamped to `MAX_FRAME_MS` (250ms). When a tab is
backgrounded `requestAnimationFrame` stops firing and the next timestamp can
be minutes later; without the clamp that queues thousands of updates, which
take longer than a frame to run, which makes the next gap larger still. Time
beyond the clamp is discarded -- one frame of slow motion beats a locked-up
phone.

## 4. Prefer integers where integers work

Floating-point addition is not associative, and accumulated float error is
the classic way two devices drift apart over a long run.

Keep anything that must match exactly in integers: positions on a grid,
scores, counters, timers measured in steps, RNG state. Use fixed-point
(store hundredths as an integer) before reaching for a float accumulator.

Floats are fine for values that are computed fresh each step rather than
accumulated, and fine anywhere in render code.

Also avoid, in simulation state:

- `Math.sin`/`cos`/`pow`/`sqrt` where results are accumulated -- results are
  not bit-identical across every JS engine. Precompute a lookup table from
  the seed instead.
- Iteration over `Object.keys`/`Set`/`Map` where insertion order could vary
  between code paths. Sort explicitly, or use arrays.
- `Array.prototype.sort` with a comparator that returns 0 for distinct items;
  ties are not resolved identically across engines. Always break ties on a
  stable field.

## 5. No physics engine

No third-party physics or tweening library. They are tuned for
plausible-looking motion, not reproducible motion: variable timesteps,
internal `Math.random()`, iterative solvers with early-exit tolerances, and
float accumulation everywhere.

Movement is grid- or step-based and written by hand. This is also why the
project has no build step and no runtime dependencies -- every line that
touches the simulation is in this repo and reviewable against these rules.

## Checking your work

```sh
npm test
```

`test/determinism.test.js` runs a dummy simulation 1000 steps from a fixed
seed and asserts the output is byte-identical across repeat runs, across
60/120/30Hz frame pacing, and across deliberately jittery frame times. It also
asserts different seeds diverge, that daily seeds depend on the UTC day and
nothing else, and that the backgrounded-tab clamp holds.

Add a case to it whenever you add a system that could drift.
