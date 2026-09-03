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

The panel used to show a wall clock, which was the exception that proved the
rule: the renderer never read a clock itself, the shell formatted it and
passed it into `draw()` as a string in a `view` argument that is explicitly
chrome. The clock is gone -- it earned none of the space it took -- but the
`view` argument stays, and so does the rule about it. Nothing in `view` can
reach game state, so nothing drawn from the wall clock can influence a run.

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

Ship rescue takes this as far as it goes: an entity's position is not a
coordinate at all but an index into a fixed set of LCD segments -- a side, a
lane and a stop for someone in the air; a side and a dock for a boat or a
shark; a numbered place on a deck for someone waiting to jump. Cargo is a
count and so is the crowd. There is no fixed-point left to round and nothing
to accumulate, and the renderer cannot draw an entity anywhere the simulation
cannot put one. A new minigame should reach for the same shape before it
reaches for coordinates.

Input is held to the same rule. The simulation is not handed a held direction
but an *order* -- a dock index, or null for "no new order this step" -- so the
thing crossing from the input layer into the run is a single small integer,
and a recorded run is a list of them. Turning a touch position into a dock
index happens in `src/render/`, outside the simulation, where a float
coordinate is allowed to exist.

The simulation therefore never learns anything about the device, the thumb, or
where on the glass the touch landed -- only which dock came out the other end.
That is what makes a recorded run replayable anywhere, and anything that made
update() branch on how an order was produced would break it immediately.

Difficulty ramps on an integer 0..1000 "pressure" value blended from rescues
and elapsed steps, rather than on a float fraction, for the same reason.

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
rescue runs from a fixed seed and a recorded order script and asserts the
same seed plus the same orders gives the same score, the same trace and the
same ending -- including that an order to one boat never disturbs the other,
and that a boat with no new order keeps running the last one it was given.

Add a case to it whenever you add a system that could drift.

### The golden fingerprint

Most of the suite compares two runs of the *same* build to each other. That
catches nondeterminism, but it cannot catch a change that is perfectly
deterministic and still hands every player a different puzzle -- reordering
two RNG draws, retuning a spawn interval, reordering the update phases. Both
runs simply change together and agree.

So one assertion pins the actual content of a known seed against recorded
values -- a digest of the whole trace, plus the closing summary for legibility:

```js
const GOLDEN = {
  seed: 12345, scriptSeed: 10, score: 60, rescued: 6, misses: 4,
  step: 1293, endReason: 'misses', trace: '4c6d4fb36d04047a',
};
```

The digest is the assertion; the summary is there so a failure says something
human before it says a hash mismatched. Pinning the summary alone is not
enough, and this is not hypothetical. In the game this one replaced,
shortening the unload and widening the run to the shore moved the boat onto
docks that had not existed before, from step 22 of the pinned seed, and the
run still ended on the same score, rescues, misses and step. The summary-only
fingerprint reported "unchanged" through a change that altered every player's
puzzle. A fingerprint trusted that far has to pin the whole run.

Before launch, a failure here just means updating the values. After launch it
means today's puzzle no longer matches the one players already played and
shared, so treat it as a decision to make deliberately rather than a stale
value to re-baseline.
