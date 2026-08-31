# Handheld Daily

A daily mobile game styled as a retro LCD handheld: monochrome green on a
dark screen, everything snapped to a coarse cell grid. Everyone gets the same
puzzle each UTC day.

**Parachute rescue** -- parachutists drift down toward the water and a boat
runs along the bottom. Catch one to score, let one hit the water for a miss.
Three misses or sixty seconds ends the run; spawn rate and fall speed climb
throughout. Tap or hold either half of the screen to steer, or use the arrow
keys on desktop.

Vanilla HTML, CSS, and ES modules -- no framework, no build step, no runtime
dependencies.

## Structure

```
index.html                 the page
src/main.js                shell: wires seed, loop, input and renderer together
src/registry.js            minigame registry -- the one place logic meets rendering
src/rng.js                 seeded PRNG (mulberry32) -- the only source of randomness
src/daily.js               UTC daily seed, puzzle number, countdown to next puzzle
src/loop.js                fixed-timestep loop, 60 logic steps/sec, decoupled from rAF
src/input.js               touch and keyboard -> a {left, right} held state
src/games/parachute.js     parachute rescue -- pure simulation, no DOM
src/render/lcd.js          dot-matrix LCD surface shared by every game renderer
src/render/parachute.js    draws parachute state; reads state, never mutates it
styles/main.css            LCD panel styling
test/determinism.test.js   determinism suite (plain Node, no framework)
docs/DETERMINISM.md        rules simulation code must follow
```

Game logic, rendering and input are separate on purpose: `src/games/` never
touches the DOM, and `src/render/` never writes to game state. Adding a second
minigame means adding a module to each folder plus one entry in
`src/registry.js` -- the shell does not change.

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
