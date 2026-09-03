# Handheld Daily

A daily mobile game drawn as a Game & Watch LCD panel: dark segments on pale
green glass, hard on/off, no smooth motion. Everyone gets the same puzzle each
UTC day.

Entities occupy fixed segment positions rather than continuous coordinates. A
jumper is always at exactly one (lane, stop); the boat sits at exactly one of
five docks; a passenger waiting to jump is one of ninety-two numbered places
on the ship's decks. Every position the board can hold is drawn faintly at all
times, the way an unlit LCD segment stays visible in the glass, so the player
reads the whole board at a glance -- and so the panel looks populated even
when little is happening.

**Ship rescue** -- a liner burns amidships across the top of the panel. Its
passengers go over the side into the water below, arcing down through two jump
lanes. One boat works the water: it catches them, carries up to four, and runs
them to the single shore at the near end of the board. Sharks patrol the water
and take whoever is aboard, but never a life. Only passengers put ashore
score, with a bonus for landing a full boat of four. Four misses or sixty
seconds ends the run, and the difficulty ramps with rescues rather than the
clock alone.

The run to the shore is the entire cost of a delivery. Touching land unloads
the whole boat instantly -- there is no pause to wait out -- so what a run
costs you is the time the boat spends out of position, with the ship filling
the air behind it. Measured over 120 seeds, 59% of everything lost is lost to
that errand, which is the largest single cause and the number the whole board
is shaped around.

## One boat, one thumb

**Touch a column and the boat heads for that dock.** The column picks the
destination, so a tap is a whole instruction rather than the start of a hold,
and the order stands after you lift -- the boat runs the errand while you go
back to watching the deck. Holding and sliding steers, because a held finger
re-issues its order every step.

The point is that an order is *discrete and persistent*. A held rudder needs a
continuous stream of input, which is what a thumb on glass is worst at: no
edge to feel, no detent to stop at, and the player's attention on the boat
instead of on the ship they are meant to be reading.

On a desktop, left/right or `A`/`D` nudge a dock at a time; up sends the boat
straight home and down sends it out to the far water.

## Five positions, and why not four

The board is five docks: four of open water and a fifth that is the shore.
That number was asked for, and it very nearly did not work.

An earlier note on this game warned that at four positions the run to the
shore stopped being a decision -- it was three moves long, so the errand cost
nothing and every loss became a lane the boat simply failed to reach. Re-swept
for a single boat at the slower pace, that warning is not only still true, it
is worse: a slower fall gives the boat *more* time to get home and back.
120 seeds each, one cadence, lanes over the three docks furthest from shore:

| positions | ferry's share of losses | verdict |
| --- | --- | --- |
| 4 | 0% | unloseable; every loss is arriving late |
| 5 | 22% | not a decision |
| 6 | 52% | works |
| 7 | 63% | works |

On dock count alone, five fails. What rescues it is the *lane placement*,
which turns out to be the stronger lever of the two:

| lanes over docks | ferry's share of losses | average score |
| --- | --- | --- |
| 1-2-3-4 | 5% | 808 |
| 2-3-4 | 22% | 806 |
| 2-4 | 31% | 798 |
| **3-4** | **55%** | **734** |
| 4 alone | 99% | 615 |

So the shipped board is five positions with **two** lanes, over the two docks
furthest from the shore. A lane one move from the landing is a free rescue,
and once free rescues exist a player takes them and the ferry stops mattering.

Slowing the boat was tried instead of dropping a lane, because keeping three
lanes is worth something. It does not work: at 17 steps a dock the ferry only
reaches 39%, and the losses it adds are jumpers the boat set off for and did
not reach. That is a harder catch, not a dearer errand.

**Stated plainly: five positions and three lanes cannot both be had.** If
three lanes matter more than the dock count, six positions is the minimum --
that is where three lanes reach 52% and the boat speed can stay where it is.

The cost of two lanes is composition: two columns of falling figures where the
old board had six. It is paid back in the arc, which swings each jump most of
a dock pitch sideways on the way down, so the pair of lanes sweeps a wide band
of the panel instead of dropping down two narrow chimneys. `render.test.js`
asserts that swing rather than trusting it.

## What the harness says

120 seeds, against bots that model a thumb -- one touch at a time, a delay
before a new jumper is noticed, a delay to move:

| | value |
| --- | --- |
| average score | 689 |
| passengers rescued | 45.9 of 92 |
| full boats landed | 11.5 |
| misses spent (of four) | 3.21 |
| average run length | 58.9s |
| ends on misses / on the clock | 42% / 58% |
| **losses to the ferry** | **59%** |
| losses to arriving late | 41% |
| losses to a full boat, or to doing nothing | 0% |
| runs that empty the deck | 0% |

A run is close to a coin flip between running out of lives and running out of
clock, and the largest single thing that kills one is being away at the shore.

Fill-to-4 versus ferry-one, same bot with only its unload threshold changed:

| runs home with | score | ends on misses | losses to the ferry |
| --- | --- | --- | --- |
| 1 aboard | 255 | 100% | 77% |
| 2 aboard | 382 | 100% | 62% |
| 3 aboard | 443 | 93% | 58% |
| 4 aboard | 689 | 42% | 59% |

Holding out for a full boat is worth 170% more than banking every catch, which
is what makes "one more before I go" the question the run is made of -- and
the impatient version loses *more* to the ferry, not less, because it makes
the trip three times as often.

One honest caveat. Three hands were modelled -- roughly 200ms, 370ms and 570ms
to notice a new jumper -- and they score 689, 689 and 687. Reaction time has
stopped mattering almost entirely. With one boat and two neighbouring lanes,
covering the lanes is never the hard part; deciding when to leave them is.
This board plays a planning game, and the numbers say so.

## Where the fiction bends

Passengers go over the side amidships, beside the fire, rather than off the
ship's two ends. The literal version does not survive the geometry: the ship
lies across the top of the panel and the shore is at one end of the water
below it, so a jumper leaving the near end lands within a move of the landing,
the ferry is over before it starts, and the run to land -- the whole game --
costs nothing. That is the four-dock failure again, arrived at from a
different direction. Coming down out in the water and being carried in is what
makes the trip worth anything, so the fire is amidships and the crowd thins
from the middle of the deck outward as people reach the rail.

The jump also drifts sideways as it falls, which no falling body does. It
earns its keep: two lanes is what makes the ferry expensive, and the swing is
what stops two lanes looking like two chimneys.

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
src/input.js               touch and keyboard -> one order per fixed step
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
test/flow.test.js          end-to-end ritual, and the control wiring, against a mini-DOM
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

Runs five suites with Node -- no framework, no `npm install` needed.

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
  painted background art never occupies a cell an entity can use, four
  passengers in the hull are five cells wide with two clear columns between
  them, neighbouring moorings and sharks stay separate objects, the jump arc
  really does swing most of a dock pitch sideways, and every column on the
  glass orders the dock it looks like it orders.
- `flow.test.js` -- boots the real `src/main.js` against a mini-DOM and walks
  the whole ritual: play, lock out, roll over to the next day, share, practice,
  and the same walk on a date before launch, where every screen and the share
  card must still read #1. It also drives a real touch through the canvas and
  checks the boat goes where the column says and stays there once the thumb
  lifts.

The split matters: `flow.test.js` drives a DOM stub with no CSS cascade, so a
rule that visually defeats `element.hidden` is invisible to it. Anything that
depends on the cascade belongs in `styles.test.js`.

Read [docs/DETERMINISM.md](docs/DETERMINISM.md) before adding simulation code.
