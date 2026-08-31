/**
 * Renderer test -- plain Node, no framework, no dependencies.
 *
 *   node test/render.test.js
 *
 * Drives the real renderer against a recording 2D context and asserts what it
 * puts on the glass. This is the only coverage of the segment layout, and it
 * exists because layout faults are invisible to every other suite: the game
 * logic is correct whether or not two segments occupy the same cell.
 */

import { createParachuteRenderer, GRID_WIDTH, GRID_HEIGHT } from '../src/render/parachute.js';
import { createParachuteGame, LANES, STOPS, DOCKS, DECK_STOP } from '../src/games/parachute.js';

const INK = '#14170d';
const GROUND = '#a9b77c';
const GHOST = 'rgba(20, 23, 13, 0.13)';
const DIM = 'rgba(20, 23, 13, 0.4)';

/** Layout the renderer uses. Duplicated on purpose: if the renderer moves a
 *  segment, this test should fail rather than silently follow it. */
const LANE_COL = [1, 5, 9, 13, 17, 21];
const STOP_ROW = [13, 16, 19, 22, 25, 28, 31];
const SPLASH_ROW = 34;
const CREW_ROW = 30;
const DECK_ROW = 31;

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

const SCALE = 16;

function createHarness() {
  let rects = [];
  let texts = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, style: this.fillStyle });
    },
    fillText(text, x, y) {
      texts.push({ text, x, y });
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: GRID_WIDTH * SCALE, height: GRID_HEIGHT * SCALE }),
  };
  global.window = { devicePixelRatio: 1 };
  global.getComputedStyle = () => ({
    getPropertyValue: (name) =>
      ({ '--lcd-on': INK, '--lcd-bg': GROUND, '--lcd-ghost': GHOST, '--lcd-dim': DIM })[name] ?? '',
  });

  const renderer = createParachuteRenderer(canvas);
  renderer.resize();

  return {
    renderer,
    canvas,
    draw(state, view = {}) {
      rects = [];
      texts = [];
      renderer.draw(state, view);
      return { rects, texts };
    },
  };
}

/** Cells painted in a given style, as a Set of "col,row". */
function cellsOf(rects, style) {
  const out = new Set();
  for (const r of rects) {
    if (r.style !== style) continue;
    for (let c = r.x / SCALE; c < (r.x + r.w) / SCALE; c++) {
      for (let rw = r.y / SCALE; rw < (r.y + r.h) / SCALE; rw++) out.add(`${c},${rw}`);
    }
  }
  return out;
}

function parachutistCells(lane, stop) {
  const c = LANE_COL[lane];
  const r = STOP_ROW[stop];
  return [`${c - 1},${r - 1}`, `${c},${r - 1}`, `${c + 1},${r - 1}`, `${c},${r}`];
}

function boatCells(dock) {
  const c = LANE_COL[dock];
  return [`${c},${CREW_ROW}`, `${c - 1},${DECK_ROW}`, `${c},${DECK_ROW}`, `${c + 1},${DECK_ROW}`];
}

function splashCells(lane) {
  const c = LANE_COL[lane];
  return [`${c - 1},${SPLASH_ROW}`, `${c + 1},${SPLASH_ROW}`, `${c},${SPLASH_ROW - 1}`];
}

console.log('renderer\n');

const harness = createHarness();

check(
  'the backing store matches the grid',
  harness.canvas.width === GRID_WIDTH * SCALE && harness.canvas.height === GRID_HEIGHT * SCALE,
  `${harness.canvas.width}x${harness.canvas.height}`
);

// --- everything snaps to the cell grid
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 400; i++) game.update({ left: false, right: true });
  const { rects } = harness.draw(game.state, { clock: '14:32', colonOn: true });

  const fractional = rects.filter(
    (r) => ![r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n))
  );
  check(
    'every drawn rectangle lands on whole pixels',
    fractional.length === 0,
    JSON.stringify(fractional.slice(0, 3))
  );

  const offGrid = rects.filter(
    (r) => r.x % SCALE !== 0 || r.y % SCALE !== 0 || r.w % SCALE !== 0 || r.h % SCALE !== 0
  );
  // The full-panel clear and flood are allowed to span the canvas exactly.
  const strays = offGrid.filter((r) => !(r.x === 0 && r.y === 0));
  check('every segment snaps to a whole cell', strays.length === 0, JSON.stringify(strays.slice(0, 3)));
}

// --- the ghost board: every position visible at all times
{
  const game = createParachuteGame({ seed: 12345 });
  const { rects } = harness.draw(game.state, { clock: '14:32' });
  const ghost = cellsOf(rects, GHOST);

  let everyStop = true;
  const missing = [];
  for (let lane = 0; lane < LANES; lane++) {
    for (let stop = 0; stop < STOPS; stop++) {
      for (const cell of parachutistCells(lane, stop)) {
        if (!ghost.has(cell)) {
          everyStop = false;
          missing.push(`lane${lane} stop${stop} ${cell}`);
        }
      }
    }
  }
  check(
    `all ${LANES * STOPS} parachutist positions are ghosted`,
    everyStop,
    missing.slice(0, 4).join(', ')
  );

  let everyDock = true;
  for (let dock = 0; dock < DOCKS; dock++) {
    // The lit boat covers its own dock, so check the others.
    if (dock === game.state.boatDock) continue;
    for (const cell of boatCells(dock)) if (!ghost.has(cell)) everyDock = false;
  }
  check(`all ${DOCKS} dock positions are ghosted`, everyDock);

  let everySplash = true;
  for (let lane = 0; lane < LANES; lane++) {
    for (const cell of splashCells(lane)) if (!ghost.has(cell)) everySplash = false;
  }
  check('all splash positions are ghosted', everySplash);
}

// --- lit entities land exactly on their segments
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 600 && game.state.parachutists.length === 0; i++) {
    game.update({ left: false, right: false });
  }
  const { rects } = harness.draw(game.state, { clock: '14:32' });
  const ink = cellsOf(rects, INK);

  check('the boat is lit at its dock', boatCells(game.state.boatDock).every((c) => ink.has(c)));

  let placed = true;
  const wrong = [];
  for (const p of game.state.parachutists) {
    const expected = p.doomed && p.stop >= DECK_STOP ? splashCells(p.lane) : parachutistCells(p.lane, p.stop);
    for (const cell of expected) {
      if (!ink.has(cell)) {
        placed = false;
        wrong.push(`lane${p.lane} stop${p.stop} ${cell}`);
      }
    }
  }
  check('every parachutist is lit at its (lane, stop)', placed, wrong.slice(0, 4).join(', '));
  check('there is at least one parachutist to check', game.state.parachutists.length > 0);
}

// --- static art must never sit on a segment an entity can use
{
  const game = createParachuteGame({ seed: 1 });
  const entityCells = new Set();
  for (let lane = 0; lane < LANES; lane++) {
    for (let stop = 0; stop < STOPS; stop++) parachutistCells(lane, stop).forEach((c) => entityCells.add(c));
    splashCells(lane).forEach((c) => entityCells.add(c));
    boatCells(lane).forEach((c) => entityCells.add(c));
  }

  const collisions = new Set();
  // Sweep water phases: the wave shifts with the step count, so a single
  // frame proves nothing. This caught the wave lighting splash cells.
  for (const step of [0, 20, 40, 60, 80, 100]) {
    game.state.step = step;
    const { rects } = harness.draw(game.state, { clock: '14:32' });
    const painted = new Set([...cellsOf(rects, INK), ...cellsOf(rects, DIM)]);
    const lit = new Set(boatCells(game.state.boatDock));
    for (const cell of painted) {
      if (entityCells.has(cell) && !lit.has(cell)) collisions.add(`${cell} @${step}`);
    }
  }
  check(
    'painted background never collides with an entity segment',
    collisions.size === 0,
    [...collisions].slice(0, 6).join(', ')
  );
}

// --- the clock
{
  const game = createParachuteGame({ seed: 1 });
  const withClock = harness.draw(game.state, { clock: '18:45', colonOn: true });
  const withoutClock = harness.draw(game.state, {});
  check(
    'the clock draws as segments, not text',
    withClock.rects.length > withoutClock.rects.length && withClock.texts.length === 0,
    `${withClock.rects.length} vs ${withoutClock.rects.length} rects, ${withClock.texts.length} texts`
  );

  const on = harness.draw(game.state, { clock: '18:45', colonOn: true });
  const off = harness.draw(game.state, { clock: '18:45', colonOn: false });
  const onInk = cellsOf(on.rects, INK).size;
  const offInk = cellsOf(off.rects, INK).size;
  check('the colon blinks', onInk > offInk, `${onInk} vs ${offInk} lit cells`);

  const eight = cellsOf(harness.draw(game.state, { clock: '88:88' }).rects, INK).size;
  const ones = cellsOf(harness.draw(game.state, { clock: '11:11' }).rects, INK).size;
  check('digits light different segment counts', eight > ones, `88:88 ${eight}, 11:11 ${ones}`);
}

// --- the renderer must not write to game state
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 300; i++) game.update({ left: true, right: false });
  const before = JSON.stringify(game.state);
  harness.draw(game.state, { clock: '14:32', badge: 'PRACTICE' });
  check('draw does not mutate game state', JSON.stringify(game.state) === before);
}

// --- degenerate viewport
{
  const tiny = createHarness();
  tiny.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1, height: 1 });
  let survived = true;
  let message = '';
  try {
    tiny.renderer.resize();
    tiny.draw(createParachuteGame({ seed: 1 }).state, { clock: '00:00' });
  } catch (error) {
    survived = false;
    message = error.message;
  }
  check('survives a 1x1 viewport', survived, message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
