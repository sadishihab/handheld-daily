/**
 * Renderer test -- plain Node, no framework, no dependencies.
 *
 *   node test/render.test.js
 *
 * Drives the real renderer against a recording 2D context and asserts what it
 * puts on the glass. Layout faults are invisible to every other suite: the
 * simulation is correct whether or not two segments occupy the same cell.
 */

import { createParachuteRenderer, GRID_WIDTH, GRID_HEIGHT, LAYOUT } from '../src/render/parachute.js';
import {
  createParachuteGame,
  LANES,
  STOPS,
  SHORE_DOCK,
  CAPACITY,
  RUN_STEPS,
} from '../src/games/parachute.js';
import {
  patternSize,
  PARACHUTIST,
  SURVIVOR,
  HULL,
  SHARK,
  SPLASH,
} from '../src/render/sprites.js';

const INK = '#14170d';
const GROUND = '#a9b77c';
const GHOST = 'rgba(20, 23, 13, 0.07)';
const DIM = 'rgba(20, 23, 13, 0.4)';
const SCALE = 4;

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

function createHarness() {
  let rects = [];
  let texts = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); },
    fillText(text, x, y) { texts.push({ text, x, y }); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: GRID_WIDTH * SCALE, height: GRID_HEIGHT * SCALE }),
  };
  global.window = { devicePixelRatio: 1 };
  global.getComputedStyle = () => ({
    getPropertyValue: (n) => ({ '--lcd-on': INK, '--lcd-bg': GROUND, '--lcd-ghost': GHOST, '--lcd-dim': DIM })[n] ?? '',
  });
  const renderer = createParachuteRenderer(canvas);
  renderer.resize();
  return {
    renderer, canvas,
    draw(state, view = {}) {
      rects = []; texts = [];
      renderer.draw(state, view);
      return { rects, texts };
    },
  };
}

function cellsOf(rects, ...styles) {
  const want = new Set(styles);
  const out = new Set();
  for (const r of rects) {
    if (!want.has(r.style)) continue;
    for (let c = r.x / SCALE; c < (r.x + r.w) / SCALE; c++) {
      for (let rw = r.y / SCALE; rw < (r.y + r.h) / SCALE; rw++) out.add(`${c},${rw}`);
    }
  }
  return out;
}

/** Cells a pattern lights when drawn at (col, row). */
function patternCells(pattern, col, row) {
  const out = [];
  for (let y = 0; y < pattern.length; y++) {
    for (let x = 0; x < pattern[y].length; x++) {
      if (pattern[y][x] === '#') out.push(`${col + x},${row + y}`);
    }
  }
  return out;
}

const half = (n) => Math.floor(n / 2);
const W = {
  para: patternSize(PARACHUTIST).width,
  hull: patternSize(HULL).width,
  shark: patternSize(SHARK).width,
  splash: patternSize(SPLASH).width,
};

const parachutistCells = (lane, stop) =>
  patternCells(PARACHUTIST, LAYOUT.LANE_COL[lane] - half(W.para), LAYOUT.STOP_ROW[stop]);
const splashCells = (lane) =>
  patternCells(SPLASH, LAYOUT.LANE_COL[lane] - half(W.splash), LAYOUT.SPLASH_ROW);
const sharkCells = (lane) =>
  patternCells(SHARK, LAYOUT.LANE_COL[lane] - half(W.shark), LAYOUT.SHARK_ROW);
function boatCells(dock) {
  const left = LAYOUT.DOCK_COL[dock] - half(W.hull);
  const cells = patternCells(HULL, left, LAYOUT.HULL_ROW);
  for (let slot = 0; slot < CAPACITY; slot++) {
    cells.push(...patternCells(SURVIVOR, left + 2 + slot * 4, LAYOUT.SLOT_ROW));
  }
  return cells;
}

console.log('renderer\n');

const harness = createHarness();

check('the backing store matches the grid',
  harness.canvas.width === GRID_WIDTH * SCALE && harness.canvas.height === GRID_HEIGHT * SCALE,
  `${harness.canvas.width}x${harness.canvas.height}`);

// --- everything snaps to the cell grid
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 600; i++) game.update({ left: false, right: true });
  const { rects } = harness.draw(game.state, {});
  const fractional = rects.filter((r) => ![r.x, r.y, r.w, r.h].every(Number.isInteger));
  check('every drawn rectangle lands on whole pixels', fractional.length === 0, JSON.stringify(fractional.slice(0, 3)));
  const offGrid = rects.filter((r) => (r.x % SCALE || r.y % SCALE || r.w % SCALE || r.h % SCALE) && !(r.x === 0 && r.y === 0));
  check('every segment snaps to a whole cell', offGrid.length === 0, JSON.stringify(offGrid.slice(0, 3)));
}

// --- the ghost board: every position visible at all times
{
  const game = createParachuteGame({ seed: 12345 });
  const { rects } = harness.draw(game.state, {});
  const ghost = cellsOf(rects, GHOST);
  const lit = new Set(boatCells(game.state.boatDock));

  const missing = [];
  for (let lane = 0; lane < LANES; lane++) {
    for (let stop = 0; stop < STOPS; stop++) {
      for (const cell of parachutistCells(lane, stop)) if (!ghost.has(cell)) missing.push(`para ${lane}/${stop} ${cell}`);
    }
    for (const cell of splashCells(lane)) if (!ghost.has(cell)) missing.push(`splash ${lane} ${cell}`);
    for (const cell of sharkCells(lane)) if (!ghost.has(cell)) missing.push(`shark ${lane} ${cell}`);
  }
  check(`all ${LANES * STOPS} parachutist, ${LANES} splash and ${LANES} shark positions are ghosted`,
    missing.length === 0, `${missing.length} missing, e.g. ${missing.slice(0, 3).join(', ')}`);

  const dockMissing = [];
  for (let dock = 0; dock <= SHORE_DOCK; dock++) {
    if (dock === game.state.boatDock) continue;
    for (const cell of boatCells(dock)) if (!ghost.has(cell) && !lit.has(cell)) dockMissing.push(`dock ${dock} ${cell}`);
  }
  check(`all ${SHORE_DOCK + 1} dock positions are ghosted, including the shore`,
    dockMissing.length === 0, `${dockMissing.length} missing, e.g. ${dockMissing.slice(0, 3).join(', ')}`);
}

// --- lit entities land exactly on their segments
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 2000 && game.state.aboard === 0; i++) {
    const t = game.state.parachutists.find((p) => !p.doomed);
    game.update(t ? { left: t.lane < game.state.boatDock, right: t.lane > game.state.boatDock } : {});
  }
  const { rects } = harness.draw(game.state, {});
  const ink = cellsOf(rects, INK);

  const left = LAYOUT.DOCK_COL[game.state.boatDock] - half(W.hull);
  const hull = patternCells(HULL, left, LAYOUT.HULL_ROW);
  check('the hull is lit at its dock', hull.every((c) => ink.has(c)));
  check('survivors aboard are lit in their slots', game.state.aboard > 0, `aboard ${game.state.aboard}`);

  const filled = patternCells(SURVIVOR, left + 2, LAYOUT.SLOT_ROW);
  check('the first survivor slot is lit when carrying', filled.every((c) => ink.has(c)));
  const emptySlot = patternCells(SURVIVOR, left + 2 + (CAPACITY - 1) * 4, LAYOUT.SLOT_ROW);
  check('an unused slot stays ghosted',
    game.state.aboard === CAPACITY || !emptySlot.every((c) => ink.has(c)));

  let placed = true;
  for (const p of game.state.parachutists) {
    const expected = p.doomed && p.stop >= STOPS - 1 ? splashCells(p.lane) : parachutistCells(p.lane, p.stop);
    if (!expected.every((c) => ink.has(c))) placed = false;
  }
  check('every parachutist is lit at its (lane, stop)', placed);
}

// --- painted art must never sit on a segment an entity can use
{
  const entityCells = new Set();
  for (let lane = 0; lane < LANES; lane++) {
    for (let stop = 0; stop < STOPS; stop++) parachutistCells(lane, stop).forEach((c) => entityCells.add(c));
    splashCells(lane).forEach((c) => entityCells.add(c));
    sharkCells(lane).forEach((c) => entityCells.add(c));
  }
  for (let dock = 0; dock <= SHORE_DOCK; dock++) boatCells(dock).forEach((c) => entityCells.add(c));

  // Sweep water phases AND every dock, since the lit boat moves.
  const collisions = new Set();
  for (const step of [0, 24, 48, 72]) {
    for (let dock = 0; dock <= SHORE_DOCK; dock++) {
      const game = createParachuteGame({ seed: 3 });
      game.state.step = step;
      game.state.boatDock = dock;
      const { rects } = harness.draw(game.state, {});
      const painted = cellsOf(rects, INK, DIM);
      const lit = new Set(boatCells(dock));
      for (const cell of painted) {
        if (entityCells.has(cell) && !lit.has(cell)) collisions.add(`${cell} dock${dock}@${step}`);
      }
    }
  }
  check('painted background never collides with an entity segment',
    collisions.size === 0, `${collisions.size} cells, e.g. ${[...collisions].slice(0, 6).join(', ')}`);
}

// --- the readout, now that the wall clock is gone
//
// The clock was dropped and the score took the top-left corner it held, with
// the miss lamps opposite. These assert the band actually reads that way --
// a renderer that quietly drew nothing there would still pass every layout
// check above, since the readout occupies no cell an entity can use.
{
  const game = createParachuteGame({ seed: 1 });
  const plain = harness.draw(game.state, {});

  check('the readout draws as segments, not text', plain.texts.length === 0);

  // The clock was the only caller-supplied string the panel ever drew, and
  // the only reason segments.js knew how to render a ':'. Nothing may bring
  // it back by accident.
  const withClock = harness.draw(game.state, { clock: '18:45', colonOn: true });
  check('a leftover clock in the view draws nothing',
    JSON.stringify(withClock.rects) === JSON.stringify(plain.rects));

  /** Lit cells inside a row band, optionally restricted to one half. */
  function bandCells(state, top, bottom, half = null) {
    const cells = cellsOf(harness.draw(state, {}).rects, INK);
    const out = [];
    for (const cell of cells) {
      const [col, row] = cell.split(',').map(Number);
      if (row < top || row > bottom) continue;
      if (half === 'left' && col >= GRID_WIDTH / 2) continue;
      if (half === 'right' && col < GRID_WIDTH / 2) continue;
      out.push([col, row]);
    }
    return out;
  }

  const scored = createParachuteGame({ seed: 1 });
  scored.state.score = 888;
  const dim = createParachuteGame({ seed: 1 });
  dim.state.score = 0;

  const bright = bandCells(scored.state, 0, 25, 'left');
  const faint = bandCells(dim.state, 0, 25, 'left');
  check('the score lights more segments as it climbs',
    bright.length > faint.length, `888 lights ${bright.length}, 000 lights ${faint.length}`);
  check('the score sits in the corner the clock used to hold',
    faint.length > 0 && Math.min(...faint.map(([col]) => col)) < 8,
    `leftmost lit column ${faint.length ? Math.min(...faint.map(([col]) => col)) : 'none'}`);
  // The band the clock's removal freed: the bar moved up into it and the
  // plane moved up behind the bar, so the rows between them are now clear.
  // This is the reclaim, and it is the only assertion that would catch the
  // readout quietly sprawling back down over the play area.
  check('the rows freed below the readout are clear',
    bandCells(dim.state, 31, 37).length === 0,
    `${bandCells(dim.state, 31, 37).length} cells still lit between the bar and the plane`);

  // Miss lamps: one more lights for each life spent, all of them in the half
  // of the band the score does not occupy.
  const lampCounts = [];
  for (let misses = 0; misses <= 4; misses++) {
    const s = createParachuteGame({ seed: 1 });
    s.state.score = 0;
    s.state.misses = misses;
    lampCounts.push(bandCells(s.state, 8, 18, 'right').length);
  }
  const perLamp = lampCounts[1] - lampCounts[0];
  check('a miss lamp lights for each life spent',
    perLamp > 0 && lampCounts.every((n, i) => n === lampCounts[0] + perLamp * i),
    lampCounts.join(', '));

  const spentAll = createParachuteGame({ seed: 1 });
  spentAll.state.score = 0;
  spentAll.state.misses = 4;
  const before = new Set(bandCells(dim.state, 0, 25).map(String));
  const added = bandCells(spentAll.state, 0, 25).filter((cell) => !before.has(String(cell)));
  check('the miss lamps sit opposite the score',
    added.length > 0 && added.every(([col]) => col >= GRID_WIDTH / 2),
    `${added.filter(([col]) => col < GRID_WIDTH / 2).length} of ${added.length} lamp cells on the score's side`);

  // Time bar: full at the start, empty at the end.
  const fresh = createParachuteGame({ seed: 1 });
  const spent = createParachuteGame({ seed: 1 });
  spent.state.step = RUN_STEPS;
  const barFull = bandCells(fresh.state, 26, 32).length;
  const barGone = bandCells(spent.state, 26, 32).length;
  check('the time bar empties as the run runs out',
    barFull > 0 && barGone === 0, `${barFull} lit at the start, ${barGone} at the end`);
}

// --- ghost opacity stays in the intended band
{
  check('ghost opacity is subtle', (() => {
    const m = GHOST.match(/([\d.]+)\)$/);
    const alpha = m ? Number(m[1]) : 1;
    return alpha >= 0.05 && alpha <= 0.09;
  })(), GHOST);
}

// --- the renderer must not write to game state
{
  const game = createParachuteGame({ seed: 12345 });
  for (let i = 0; i < 400; i++) game.update({ left: true, right: false });
  const before = JSON.stringify(game.state);
  harness.draw(game.state, { badge: 'PRACTICE' });
  check('draw does not mutate game state', JSON.stringify(game.state) === before);
}

// --- degenerate viewport
{
  const tiny = createHarness();
  tiny.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1, height: 1 });
  let survived = true; let message = '';
  try { tiny.renderer.resize(); tiny.draw(createParachuteGame({ seed: 1 }).state, {}); }
  catch (error) { survived = false; message = error.message; }
  check('survives a 1x1 viewport', survived, message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
