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

The panel clock is the exception that proves the rule. It shows real local
time, but the renderer never reads a clock: the shell formats it and passes it
into `draw()` as a string, alongside the practice badge, in a `view` argument
that is explicitly chrome. Nothing in `view` can reach game state, so the
clock cannot influence a run.

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

Parachute takes this as far as it goes: an entity's position is not a
coordinate at all but an index into a fixed set of LCD segments -- a lane and
a stop, a dock. There is no fixed-point left to round and nothing to
accumulate, and the renderer cannot draw an entity anywhere the simulation
cannot put one. A new minigame should reach for the same shape before it
reaches for coordinates.

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
nothing else, and that the backgrounded-tab clamp holds. It then plays full
parachute runs from a fixed seed and a recorded input script and asserts the
same seed plus the same inputs gives the same score, the same trace and the
same ending.

Add a case to it whenever you add a system that could drift.

### The golden fingerprint

Most of the suite compares two runs of the *same* build to each other. That
catches nondeterminism, but it cannot catch a change that is perfectly
deterministic and still hands every player a different puzzle -- reordering
two RNG draws, retuning a spawn interval, reordering the update phases. Both
runs simply change together and agree.

So one assertion pins the actual outcome of a known seed against recorded
numbers:

```js
const GOLDEN = { seed: 12345, scriptSeed: 9, score: 3, misses: 3, step: 661, endReason: 'misses' };
```

Before launch, a failure here just means updating the numbers. After launch it
means today's puzzle no longer matches the one players already played and
shared, so treat it as a decision to make deliberately rather than a stale
value to re-baseline.
