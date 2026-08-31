# Handheld Daily

A daily mobile game styled as a retro LCD handheld: monochrome green pixel
text on a dark screen. Everyone gets the same puzzle each UTC day.

Vanilla HTML, CSS, and ES modules -- no framework, no build step, no runtime
dependencies.

## Structure

```
index.html              the page
src/main.js             input behavior (no pinch/double-tap zoom, no long-press menu)
src/rng.js              seeded PRNG (mulberry32) -- the only source of randomness
src/daily.js            UTC daily seed, puzzle number, countdown to next puzzle
src/loop.js             fixed-timestep loop, 60 logic steps/sec, decoupled from rAF
styles/main.css         LCD screen styling
test/determinism.test.js  determinism suite (plain Node, no framework)
docs/DETERMINISM.md     rules simulation code must follow
```

There is no rendering or game logic yet -- `src/rng.js`, `src/daily.js` and
`src/loop.js` are the simulation foundation.

## Running it

Open `index.html` in a browser, or serve the folder to test on a phone:

```sh
python3 -m http.server 8000
```

Then visit `http://<your-machine-ip>:8000` from the device.

## Tests

```sh
npm test
```

Runs `test/determinism.test.js` with Node -- no framework, no `npm install`
needed. It asserts that a fixed seed produces byte-identical output across
repeat runs and across 30/60/120Hz frame pacing, that different seeds diverge,
and that daily seeds depend on the UTC date alone.

Read [docs/DETERMINISM.md](docs/DETERMINISM.md) before adding simulation code.
