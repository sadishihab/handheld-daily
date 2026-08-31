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
src/main.js                shell: screen flow, daily lockout, streaks, sharing
src/registry.js            minigame registry -- the one place logic meets rendering
src/rng.js                 seeded PRNG (mulberry32) -- the only source of randomness
src/daily.js               UTC daily seed, puzzle number, countdown to next puzzle
src/loop.js                fixed-timestep loop, 60 logic steps/sec, decoupled from rAF
src/input.js               touch and keyboard -> a {left, right} held state
src/progress.js            streaks, one-run-per-day, score history
src/storage.js             localStorage adapter with an in-memory fallback
src/share.js               share text formatting + Web Share / clipboard delivery
src/devtime.js             dev-only clock override for testing the rollover
src/countdown.js           hh:mm:ss formatting
src/games/parachute.js     parachute rescue -- pure simulation, no DOM
src/render/lcd.js          dot-matrix LCD surface shared by every game renderer
src/render/parachute.js    draws parachute state; reads state, never mutates it
src/ui/panel.js            start / result / practice overlay
styles/main.css            LCD panel styling
test/determinism.test.js   determinism suite
test/progress.test.js      streaks, daily lockout, share text, dev clock
test/styles.test.js        cascade rules the UI depends on
test/flow.test.js          end-to-end ritual against a mini-DOM
test/minidom.js            the mini-DOM the flow test boots the app in
docs/DETERMINISM.md        rules simulation code must follow
```

Game logic, rendering and input are separate on purpose: `src/games/` never
touches the DOM, and `src/render/` never writes to game state. Adding a second
minigame means adding a module to each folder plus one entry in
`src/registry.js` -- the shell does not change.

## The daily ritual

One run per UTC day. When it ends you get your score, misses and streak, plus
a Share button that copies a short plain-text card -- no URL, formatted to
paste cleanly into WhatsApp and Messenger:

```
HANDHELD DAILY #1  🪂
47 rescued  ▓▓▓▓▓▓▓░░░
🔥 6 day streak
```

The bar is how far into the sixty seconds the run got. Streaks live in
`localStorage`; a skipped UTC day resets them.

**Practice mode** gives unlimited runs on random seeds. It is marked on screen,
earns no streak credit and has no share.

## Running it

Open `index.html` in a browser, or serve the folder to test on a phone:

```sh
python3 -m http.server 8000
```

Then visit `http://<your-machine-ip>:8000` from the device.

### Testing the rollover

Waiting until UTC midnight is a poor debug loop, so on localhost and private
LAN addresses these query params are honoured:

| Param | Effect |
| --- | --- |
| `?date=2026-11-05` | Pretend it is that UTC date |
| `?days=3` | Shift the clock three days forward (negative works) |
| `?reset=1` | Clear stored progress on boot |

The override is an offset, not a frozen timestamp, so the clock still ticks and
a real rollover can be watched by aiming just before midnight. There is no
build step to strip this, so it is gated on the host instead: a public deploy
ignores all three and serves the real clock.

## Tests

```sh
npm test
```

Runs three suites with Node -- no framework, no `npm install` needed.

- `determinism.test.js` -- a fixed seed produces byte-identical output across
  repeat runs and across 30/60/120Hz frame pacing, different seeds diverge,
  daily seeds depend on the UTC date alone, and a seeded run still matches its
  recorded golden fingerprint.
- `progress.test.js` -- streaks increment on consecutive days and reset after a
  gap, a day cannot be played twice, share text is exactly the intended shape,
  and the dev clock is refused off a dev host.
- `styles.test.js` -- asserts the cascade rules the UI depends on, chiefly that
  `[hidden]` beats the author `display` rules that would otherwise defeat it.
- `flow.test.js` -- boots the real `src/main.js` against a mini-DOM and walks
  the whole ritual: play, lock out, roll over to the next day, share, practice.

The split matters: `flow.test.js` drives a DOM stub with no CSS cascade, so a
rule that visually defeats `element.hidden` is invisible to it. Anything that
depends on the cascade belongs in `styles.test.js`.

Read [docs/DETERMINISM.md](docs/DETERMINISM.md) before adding simulation code.
