# Handheld Daily

A daily mobile game drawn as a Game & Watch LCD panel: dark segments on pale
green glass, hard on/off, no smooth motion. Everyone gets the same puzzle each
UTC day.

Entities occupy fixed segment positions rather than continuous coordinates. A
jumper is always at exactly one (side, lane, stop); a boat sits at exactly one
(side, dock); a passenger waiting to jump is one of ninety-two numbered places
on the ship's decks. Every position the board can hold is drawn faintly at all
times, the way an unlit LCD segment stays visible in the glass, so the player
reads the whole board at a glance -- and so the panel looks populated even
when little is happening.

**Ship rescue** -- a liner burns amidships across the middle of the panel,
with land at both outer edges. Passengers crowd its two decks and go over the
side into the water, arcing down through six jump lanes. A boat on each side
catches them, carries up to four, and ferries them out to the shore at its own
end of the board. Sharks patrol the water and take whoever is aboard, but
never a life. Only passengers put ashore score, with a bonus for landing a
full boat of four. Four misses or sixty seconds ends the run, and the
difficulty ramps with rescues rather than the clock alone.

The run to the shore is the entire cost of a delivery. Touching land unloads
the whole boat instantly -- there is no pause to wait out -- so what a run
costs you is the time both boats spend out of position, with the ship filling
the air behind them. Measured over 120 seeds, 53% of everything lost is lost
to that errand.

## Two boats, one thumb

This is the design problem the game is built around, and it is worth stating
plainly because the obvious answer is the wrong one.

**Touch a side of the panel to command that side's boat, and it heads for the
dock you touched.** The half you touch picks the boat -- no mode, no selected
boat to keep track of, nothing to switch -- and the column picks the
destination. Lift your thumb and the boat carries on running that errand while
you deal with the other side. Holding and sliding still steers, because a held
finger re-issues its order every step.

The point is that an order is *discrete and persistent*. A held rudder needs a
continuous stream of input per boat, and a thumb can only produce one stream;
that forces a mode, and the boat you are not holding sits parked. So the game
asks you to schedule two ferries rather than to steer two boats, which is a
thing one thumb can actually do.

### The mirrored alternative

A second scheme ships alongside it, chosen with the `CONTROL` button on the
start screen or with `?control=mirror`:

**Mirrored** -- one input, both boats. The column you touch picks a dock index
and *both* boats take it, each measured from its own shore, so the pair is
always a mirror image of itself. Nothing to select and nothing to cross to.
The price is that there is no way to send one boat home while the other waits
at the ship.

Both schemes are shipped rather than one being chosen, because the argument
between them is about feel and the harness can only settle the arithmetic
half. The arithmetic half is not close, and it is below.

### What the harness says

Measured against bots that model a hand -- one touch at a time, a delay before
a new jumper is noticed, a larger delay to carry the thumb across the panel.
120 seeds each, at the pace the game currently runs, with the middling of the
three hands (~370ms to notice a jumper, ~430ms to cross):

| control | score | run | ended on misses | biggest cause of loss |
| --- | --- | --- | --- | --- |
| side-addressed, one thumb | 532 | 60.0s | 0% | the ferry, 53% |
| side-addressed, two thumbs | 534 | 60.0s | 0% | the ferry, 50% |
| mirrored, one input | 459 | 59.6s | 10% | a full boat, 51% |
| select a boat, then steer it | 432 | 56.8s | 68% | the ferry, 54% |

Two results matter here. The first is that **one thumb scores 532 against two
thumbs' 534** -- the control costs essentially nothing, so a phone player is
not playing a degraded version of the game.

The second is what mirrored loses, which is not points but the decision.
Half of its losses are a boat that was already full and could not be sent
home, and the ferry -- the thing the whole design exists to charge for --
falls from 53% of losses to 7%. A mirrored player is not solving a cheaper
version of the problem; they are solving a different one.

### Controls on a desktop

Side-addressed: `A`/`D` work the left boat and the arrow keys the right one,
on each side outward-key-to-its-own-shore; `W` and the up arrow send a boat
straight home.

Mirrored: there is no left boat and no right boat, only a distance from the
shores, so every key means out or in. `A` and the left arrow pull the pair out
toward the land, `D` and the right arrow push it back in toward the ship, and
`W`/up sends both straight home.

## Pace

The run was slowed down after playtesting, and the three constants that set
the pace turned out not to be interchangeable:

- **Fall speed** was stretched by about a third (`FALL_INTERVAL_START` 38 to
  50). This is free and then some -- a slower arc is a longer catch window, so
  it buys reaction time *and* raises the score, and the ferry's share of
  losses does not move.
- **Jump cadence** was eased by 15% (`SPAWN_INTERVAL_START` 98 to 112). This
  one is expensive. With jumpers rarer, a boat can finish a round trip between
  them and the ferry stops costing anything: pushed to +80%, the ferry's share
  of losses reaches 0% and every remaining loss is simply arriving late. 15% is
  as far as it goes before the game's one decision starts switching off.
- **The ramp** was given four more rescues to climb (`RESCUE_RAMP_TARGET` 26
  to 30). Mild and cheap.

Sharks were deliberately left alone. With everything else stretched they
arrive relatively more often, which puts back a little of the pressure the
fall gave up.

One honest caveat about the table above: at this pace the bots almost stop
losing, so "ended on misses" is no longer a useful difficulty signal for
them -- they have perfect anticipation and only a reaction delay, and slowing
the game is exactly the thing that delay was fighting. The number that still
discriminates is which cause the losses come from, which is why the table
reports that rather than a difficulty percentage.

## Where the fiction bends

Passengers go over the side beside the fire amidships, not off the ship's two
ends. The literal version does not survive the geometry: land is at the outer
edges, so a jumper leaving the bow or stern lands on top of a shore, the ferry
is over before it starts, and the run to land -- the whole game -- costs
nothing. Coming down inboard and being carried out is what makes the trip
worth anything, so the fire is amidships and the crowd thins from the middle
outward as people reach the rail.

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
src/input.js               touch and keyboard -> one order per boat, per step
src/controls.js            which control scheme is in force, and where it is remembered
src/progress.js            streaks, one-run-per-day, score history
src/storage.js             localStorage adapter with an in-memory fallback
src/share.js               share text formatting + Web Share / clipboard delivery
src/devtime.js             dev-only clock override for testing the rollover
src/countdown.js           hh:mm:ss formatting
src/games/rescue.js        ship rescue -- pure simulation, no DOM
src/render/lcd.js          LCD surface shared by every game renderer
src/render/segments.js     seven-segment digits drawn on the cell grid
src/render/sprites.js      sprite patterns, authored as text art
src/render/rescue.js       draws rescue state; reads state, never mutates it
src/ui/panel.js            start / result / practice overlay
styles/main.css            LCD panel styling
test/determinism.test.js   determinism suite
test/progress.test.js      streaks, daily lockout, share text, dev clock
test/styles.test.js        cascade rules the UI depends on
test/render.test.js        segment layout, ghost board, crowd, painted-art collisions
test/flow.test.js          end-to-end ritual, and the control-scheme wiring, against a mini-DOM
test/minidom.js            the mini-DOM the flow test boots the app in
grid-test.html             dev-only: the cell grid at true size, for checking on a phone
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
HANDHELD DAILY #1  🚢
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

`grid-test.html` on the same server renders the cell grid at true size with
the real LCD surface and the real stylesheet, and prints the cell size in
device and CSS pixels. Tap to switch between the 252-cell grid the game uses
and the 168-cell one it replaced. It is the only honest way to answer whether
a cell still reads as a discrete segment rather than a smooth pixel, and it is
excluded from deploys.

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

Runs four suites with Node -- no framework, no `npm install` needed.

- `determinism.test.js` -- a fixed seed produces byte-identical output across
  repeat runs and across 30/60/120Hz frame pacing, different seeds diverge,
  daily seeds depend on the UTC date alone, and a seeded run still hashes to
  its recorded golden fingerprint.
- `progress.test.js` -- streaks increment on consecutive days and reset after a
  gap, a day cannot be played twice, share text is exactly the intended shape,
  the dev clock is refused off a dev host, and a pre-launch date clamps to
  puzzle #1 rather than rendering the negative number it counts internally.
- `styles.test.js` -- asserts the cascade rules the UI depends on, chiefly that
  `[hidden]` beats the author `display` rules that would otherwise defeat it.
- `render.test.js` -- drives the renderer against a recording canvas: every
  segment snaps to a whole cell, every position on the board is ghosted, lit
  entities land on their own segments, the crowd on deck lights and
  extinguishes one figure per passenger and does it from the middle of the
  ship outward, the flail-and-splash steps through all five of its frames,
  painted background art never occupies a cell an entity can use, the two
  halves of the board are exact reflections, and a touch anywhere on the glass
  addresses the boat and dock it looks like it addresses.
- `flow.test.js` -- boots the real `src/main.js` against a mini-DOM and walks
  the whole ritual: play, lock out, roll over to the next day, share, practice,
  and the same walk on a date before launch, where every screen and the share
  card must still read #1.

The split matters: `flow.test.js` drives a DOM stub with no CSS cascade, so a
rule that visually defeats `element.hidden` is invisible to it. Anything that
depends on the cascade belongs in `styles.test.js`.

Read [docs/DETERMINISM.md](docs/DETERMINISM.md) before adding simulation code.
