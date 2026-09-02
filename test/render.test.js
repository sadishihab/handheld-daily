/**
 * Renderer test -- plain Node, no framework, no dependencies.
 *
 *   node test/render.test.js
 *
 * Drives the real renderer against a recording 2D context and asserts what it
 * puts on the glass. Layout faults are invisible to every other suite: the
 * simulation is correct whether or not two segments occupy the same cell.
 */

import { createRescueRenderer, GRID_WIDTH, GRID_HEIGHT, LAYOUT } from '../src/render/rescue.js';
import {
  createRescueGame,
  SIDES,
  DOCKS_PER_SIDE,
  LANES_PER_SIDE,
  ARC_STOPS,
  CROWD_PER_SIDE,
  CAPACITY,
  RUN_STEPS,
  SHARK_DOCKS,
  SPLASH_FRAME_STEPS,
} from '../src/games/rescue.js';
import {
  patternSize,
  flip,
  PASSENGER,
  DECK_PASSENGER,
  HULL,
  SHARK,
  SPLASH_FRAMES,
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
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: GRID_WIDTH * SCALE, height: GRID_HEIGHT * SCALE,
    }),
  };
  global.window = { devicePixelRatio: 1 };
  global.getComputedStyle = () => ({
    getPropertyValue: (n) => ({
      '--lcd-on': INK, '--lcd-bg': GROUND, '--lcd-ghost': GHOST, '--lcd-dim': DIM,
    })[n] ?? '',
  });
  const renderer = createRescueRenderer(canvas);
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

/* -- every cell each kind of entity can ever light ---------------------- */

const crowdCells = (side, slot) => {
  const { col, row } = LAYOUT.crowdSlot(side, slot);
  return patternCells(DECK_PASSENGER, col, row);
};
const jumperCells = (side, lane, stop) =>
  patternCells(LAYOUT.jumperPose(stop), LAYOUT.jumperCol(side, lane, stop), LAYOUT.STOP_ROW[stop]);
const splashCells = (side, lane, frame) =>
  patternCells(SPLASH_FRAMES[frame], LAYOUT.splashCol(side, lane), LAYOUT.SPLASH_ROW);
const sharkCells = (side, dock, facingLeft) =>
  patternCells(facingLeft ? SHARK : flip(SHARK), LAYOUT.sharkCol(side, dock), LAYOUT.SHARK_ROW);

function boatCells(side, dock, slots = CAPACITY) {
  const left = LAYOUT.hullCol(side, dock);
  const cells = patternCells(HULL, left, LAYOUT.HULL_ROW);
  for (let slot = 0; slot < slots; slot++) {
    cells.push(
      ...patternCells(PASSENGER, left + LAYOUT.SLOT_INSET + slot * LAYOUT.SLOT_PITCH, LAYOUT.SLOT_ROW)
    );
  }
  return cells;
}

/** Every cell any entity could ever occupy, anywhere on the board. */
function allEntityCells() {
  const cells = new Set();
  const add = (list) => list.forEach((c) => cells.add(c));
  for (let side = 0; side < SIDES; side++) {
    for (let slot = 0; slot < CROWD_PER_SIDE; slot++) add(crowdCells(side, slot));
    for (let lane = 0; lane < LANES_PER_SIDE; lane++) {
      for (let stop = 0; stop < ARC_STOPS; stop++) add(jumperCells(side, lane, stop));
      for (let frame = 0; frame < SPLASH_FRAMES.length; frame++) add(splashCells(side, lane, frame));
    }
    for (const dock of SHARK_DOCKS) {
      add(sharkCells(side, dock, true));
      add(sharkCells(side, dock, false));
    }
    for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) add(boatCells(side, dock));
  }
  return cells;
}

/** The cells the entities actually present in `state` are lighting. */
function litCells(state) {
  const cells = new Set();
  const add = (list) => list.forEach((c) => cells.add(c));
  for (let side = 0; side < SIDES; side++) {
    const boat = state.boats[side];
    add(boatCells(side, boat.dock));
    for (let slot = CROWD_PER_SIDE - boat.waiting; slot < CROWD_PER_SIDE; slot++) {
      add(crowdCells(side, slot));
    }
  }
  for (const j of state.jumpers) if (j.stop < ARC_STOPS) add(jumperCells(j.side, j.lane, j.stop));
  for (const s of state.sharks) {
    add(sharkCells(s.side, s.pos, true));
    add(sharkCells(s.side, s.pos, false));
  }
  for (const s of state.splashes) {
    for (let f = 0; f < SPLASH_FRAMES.length; f++) add(splashCells(s.side, s.lane, f));
  }
  return cells;
}

console.log('renderer\n');

const harness = createHarness();

check('the backing store matches the grid',
  harness.canvas.width === GRID_WIDTH * SCALE && harness.canvas.height === GRID_HEIGHT * SCALE,
  `${harness.canvas.width}x${harness.canvas.height}`);

/* -- the readability the finer grid was bought for ---------------------- */
//
// This is the constraint that decided GRID_WIDTH, so it is asserted rather
// than left to the eye. Four passengers in a hull have to read as four
// people; at the old grid they shared edges and read as one bar.
{
  const passW = patternSize(PASSENGER).width;
  const hullW = patternSize(HULL).width;
  const gap = LAYOUT.SLOT_PITCH - passW;
  const rightmost = LAYOUT.SLOT_INSET + (CAPACITY - 1) * LAYOUT.SLOT_PITCH + passW;
  check('a passenger is at least three cells wide', passW >= 3, `${passW} cells`);
  check('passenger slots leave a clear column between them', gap >= 1, `gap ${gap}`);
  check('every passenger slot sits on the hull',
    LAYOUT.SLOT_INSET >= 0 && rightmost <= hullW, `slots span 0..${rightmost} of ${hullW}`);

  // And the docks have to stay apart, or the ghost row is one long bar
  // rather than a line of moorings.
  const pitch = LAYOUT.DOCK_CENTRE[0][1] - LAYOUT.DOCK_CENTRE[0][0];
  check('neighbouring docks are separated by clear water', pitch - hullW >= 3,
    `${pitch - hullW} clear cells between hulls`);

  // The two innermost hulls, one per side, must not run into each other.
  const innerLeft = LAYOUT.hullCol(0, DOCKS_PER_SIDE - 1) + hullW - 1;
  const innerRight = LAYOUT.hullCol(1, DOCKS_PER_SIDE - 1);
  check('the two innermost docks do not overlap at the centre line',
    innerLeft < innerRight, `left ends at ${innerLeft}, right starts at ${innerRight}`);

  // The same rule the hull lives under applies to anything else that stands
  // on a dock. A shark wider than the pitch made the ghost row read as one
  // continuous bar rather than as separate fish -- and because the ghost
  // board draws both facings at every dock, it was twice as bad as it looked.
  const sharkW = patternSize(SHARK).width;
  check('nothing that stands on a dock is wider than the boat',
    sharkW <= hullW, `shark ${sharkW}, hull ${hullW}`);

  const merged = [];
  for (let side = 0; side < SIDES; side++) {
    for (let i = 1; i < SHARK_DOCKS.length; i++) {
      const near = new Set([
        ...sharkCells(side, SHARK_DOCKS[i - 1], true),
        ...sharkCells(side, SHARK_DOCKS[i - 1], false),
      ]);
      const far = [
        ...sharkCells(side, SHARK_DOCKS[i], true),
        ...sharkCells(side, SHARK_DOCKS[i], false),
      ];
      if (far.some((cell) => near.has(cell))) merged.push(`${side}:${SHARK_DOCKS[i - 1]}-${SHARK_DOCKS[i]}`);
    }
  }
  check('neighbouring shark positions stay separate fish', merged.length === 0, merged.join(', '));
}

/* -- the board is symmetrical about the ship ---------------------------- */
{
  const mismatches = [];
  for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) {
    const mirrored = LAYOUT.mirrorCentre(LAYOUT.DOCK_CENTRE[0][dock]);
    if (mirrored !== LAYOUT.DOCK_CENTRE[1][dock]) mismatches.push(`dock ${dock}`);
  }
  for (let slot = 0; slot < CROWD_PER_SIDE; slot++) {
    const left = LAYOUT.crowdSlot(0, slot);
    const right = LAYOUT.crowdSlot(1, slot);
    const width = patternSize(DECK_PASSENGER).width;
    if (LAYOUT.mirrorCol(left.col, width) !== right.col || left.row !== right.row) {
      mismatches.push(`crowd ${slot}`);
    }
  }
  check('the right-hand half is the left-hand half reflected',
    mismatches.length === 0, mismatches.slice(0, 4).join(', '));
}

/* -- everything snaps to the cell grid ---------------------------------- */
{
  const game = createRescueGame({ seed: 12345 });
  for (let i = 0; i < 900; i++) game.update({ left: 0, right: 5 });
  const { rects } = harness.draw(game.state, {});
  const fractional = rects.filter((r) => ![r.x, r.y, r.w, r.h].every(Number.isInteger));
  check('every drawn rectangle lands on whole pixels', fractional.length === 0,
    JSON.stringify(fractional.slice(0, 3)));
  const offGrid = rects.filter(
    (r) => (r.x % SCALE || r.y % SCALE || r.w % SCALE || r.h % SCALE) && !(r.x === 0 && r.y === 0)
  );
  check('every segment snaps to a whole cell', offGrid.length === 0, JSON.stringify(offGrid.slice(0, 3)));
}

/* -- the ghost board: every position visible at all times ---------------- */
{
  const game = createRescueGame({ seed: 12345 });
  const { rects } = harness.draw(game.state, {});
  const ghost = cellsOf(rects, GHOST);
  const lit = litCells(game.state);
  const missing = [];
  const want = (label, cells) => {
    for (const cell of cells) if (!ghost.has(cell) && !lit.has(cell)) missing.push(`${label} ${cell}`);
  };

  for (let side = 0; side < SIDES; side++) {
    for (let lane = 0; lane < LANES_PER_SIDE; lane++) {
      for (let stop = 0; stop < ARC_STOPS; stop++) want(`jumper ${side}/${lane}/${stop}`, jumperCells(side, lane, stop));
      for (let f = 0; f < SPLASH_FRAMES.length; f++) want(`splash ${side}/${lane}/${f}`, splashCells(side, lane, f));
    }
    for (const dock of SHARK_DOCKS) {
      want(`shark ${side}/${dock}/L`, sharkCells(side, dock, true));
      want(`shark ${side}/${dock}/R`, sharkCells(side, dock, false));
    }
    for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) want(`dock ${side}/${dock}`, boatCells(side, dock));
  }
  check(
    `all ${SIDES * LANES_PER_SIDE * ARC_STOPS} jumper, ` +
      `${SIDES * LANES_PER_SIDE * SPLASH_FRAMES.length} splash, ` +
      `${SIDES * SHARK_DOCKS.length * 2} shark and ${SIDES * DOCKS_PER_SIDE} dock positions are ghosted`,
    missing.length === 0,
    `${missing.length} missing, e.g. ${missing.slice(0, 3).join(', ')}`
  );
}

/* -- the crowd: ghosted when empty, lit when waiting, extinguishing as
      passengers jump. The deck is the densest thing on the panel and the
      whole reason it reads as populated, so all three states are asserted. */
{
  const empty = createRescueGame({ seed: 7 });
  for (const boat of empty.state.boats) boat.waiting = 0;
  const ghosted = cellsOf(harness.draw(empty.state, {}).rects, GHOST);

  const unghosted = [];
  for (let side = 0; side < SIDES; side++) {
    for (let slot = 0; slot < CROWD_PER_SIDE; slot++) {
      for (const cell of crowdCells(side, slot)) if (!ghosted.has(cell)) unghosted.push(`${side}/${slot}`);
    }
  }
  check(`all ${SIDES * CROWD_PER_SIDE} deck positions stay ghosted once empty`,
    unghosted.length === 0, `${unghosted.length} cells, e.g. ${unghosted.slice(0, 3).join(', ')}`);

  const full = createRescueGame({ seed: 7 });
  const fullInk = cellsOf(harness.draw(full.state, {}).rects, INK);
  const unlit = [];
  for (let side = 0; side < SIDES; side++) {
    for (let slot = 0; slot < CROWD_PER_SIDE; slot++) {
      for (const cell of crowdCells(side, slot)) if (!fullInk.has(cell)) unlit.push(`${side}/${slot}`);
    }
  }
  check('a full deck lights every one of them', unlit.length === 0,
    `${unlit.length} cells, e.g. ${unlit.slice(0, 3).join(', ')}`);

  // Extinguishing: each passenger who jumps puts out exactly one figure, and
  // it is the innermost one still standing -- the crowd thins from the fire
  // outward, which is the direction jumpers come from.
  const counts = [];
  let orderHolds = true;
  for (const gone of [0, 1, 2, 10, CROWD_PER_SIDE]) {
    const s = createRescueGame({ seed: 7 });
    for (const boat of s.state.boats) boat.waiting = CROWD_PER_SIDE - gone;
    const ink = cellsOf(harness.draw(s.state, {}).rects, INK);
    let litSlots = 0;
    for (let slot = 0; slot < CROWD_PER_SIDE; slot++) {
      const isLit = crowdCells(0, slot).every((c) => ink.has(c));
      if (isLit) litSlots += 1;
      // Slots below `gone` have jumped; every slot at or above it is still there.
      if (isLit !== slot >= gone) orderHolds = false;
    }
    counts.push(litSlots);
  }
  check('the crowd extinguishes one figure per passenger who jumps',
    counts.join(',') === [CROWD_PER_SIDE, CROWD_PER_SIDE - 1, CROWD_PER_SIDE - 2, CROWD_PER_SIDE - 10, 0].join(','),
    `lit counts ${counts.join(', ')}`);
  check('it extinguishes from the middle of the ship outward', orderHolds);
}

/* -- lit entities land exactly on their segments ------------------------ */
{
  const game = createRescueGame({ seed: 12345 });
  // Chase whatever is falling, on both sides, until someone is aboard.
  for (let i = 0; i < 3000 && game.state.boats.every((b) => b.aboard === 0); i++) {
    const order = { left: null, right: null };
    for (const j of game.state.jumpers) {
      order[j.side === 0 ? 'left' : 'right'] = [3, 4, 5][j.lane];
    }
    game.update(order);
  }
  const { rects } = harness.draw(game.state, {});
  const ink = cellsOf(rects, INK);

  const side = game.state.boats[0].aboard > 0 ? 0 : 1;
  const boat = game.state.boats[side];
  check('a boat is carrying someone', boat.aboard > 0, `aboard ${game.state.boats.map((b) => b.aboard)}`);

  const left = LAYOUT.hullCol(side, boat.dock);
  check('the hull is lit at its dock',
    patternCells(HULL, left, LAYOUT.HULL_ROW).every((c) => ink.has(c)));

  const slotCol = (slot) => left + LAYOUT.SLOT_INSET + slot * LAYOUT.SLOT_PITCH;
  check('a passenger aboard is lit in the first slot',
    patternCells(PASSENGER, slotCol(0), LAYOUT.SLOT_ROW).every((c) => ink.has(c)));
  check('an unused slot stays ghosted',
    boat.aboard === CAPACITY ||
      !patternCells(PASSENGER, slotCol(CAPACITY - 1), LAYOUT.SLOT_ROW).every((c) => ink.has(c)));

  check('every jumper is lit at its (side, lane, stop)',
    game.state.jumpers.every((j) => jumperCells(j.side, j.lane, j.stop).every((c) => ink.has(c))));
}

/* -- the flail and splash actually advances through its frames ---------- */
{
  const game = createRescueGame({ seed: 3 });
  const seen = new Set();
  for (let frame = 0; frame < SPLASH_FRAMES.length; frame++) {
    const s = createRescueGame({ seed: 3 });
    s.state.splashes = [{ side: 0, lane: 1, age: frame * SPLASH_FRAME_STEPS }];
    const ink = cellsOf(harness.draw(s.state, {}).rects, INK);
    const shown = SPLASH_FRAMES.findIndex((_, i) =>
      splashCells(0, 1, i).every((c) => ink.has(c)) &&
      splashCells(0, 1, i).length > 0);
    seen.add(shown);
  }
  check(`the splash steps through all ${SPLASH_FRAMES.length} frames as it ages`,
    seen.size === SPLASH_FRAMES.length && !seen.has(-1),
    `frames shown: ${[...seen].join(', ')}`);

  // A miss has to be visible as an event, not just as a lamp lighting.
  const quiet = cellsOf(harness.draw(game.state, {}).rects, INK).size;
  const splashing = createRescueGame({ seed: 3 });
  splashing.state.splashes = [{ side: 0, lane: 1, age: 2 * SPLASH_FRAME_STEPS }];
  const loud = cellsOf(harness.draw(splashing.state, {}).rects, INK).size;
  check('a splash lights cells that nothing else was lighting', loud > quiet, `${quiet} -> ${loud}`);
}

/* -- painted art must never sit on a segment an entity can use ----------- */
//
// The strongest layout assertion in the suite. Every deck plank, funnel,
// jetty, wave and flame is swept against every cell any entity could ever
// stand on. A passenger drawn on the same cells as the deck under them is
// invisible, and no other test can see it.
{
  const entityCells = allEntityCells();
  const collisions = new Set();

  // Sweep the water phase, the flame frame, and every dock the boats can be
  // at -- all three change which cells the painted layers touch.
  for (const step of [0, 9, 18, 24, 48, 72]) {
    for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) {
      const game = createRescueGame({ seed: 3 });
      game.state.step = step;
      game.state.boats[0].dock = dock;
      game.state.boats[1].dock = DOCKS_PER_SIDE - 1 - dock;
      const { rects } = harness.draw(game.state, {});
      const painted = cellsOf(rects, INK, DIM);
      const lit = litCells(game.state);
      for (const cell of painted) {
        if (entityCells.has(cell) && !lit.has(cell)) collisions.add(`${cell} dock${dock}@${step}`);
      }
    }
  }
  check('painted background never collides with an entity segment',
    collisions.size === 0, `${collisions.size} cells, e.g. ${[...collisions].slice(0, 6).join(', ')}`);
}

/* -- the readout band --------------------------------------------------- */
{
  const game = createRescueGame({ seed: 1 });
  const plain = harness.draw(game.state, {});
  check('the readout draws as segments, not text', plain.texts.length === 0);

  /** Lit cells inside a row band, optionally restricted to one half. */
  function bandCells(state, top, bottom, side = null) {
    const cells = cellsOf(harness.draw(state, {}).rects, INK);
    const out = [];
    for (const cell of cells) {
      const [col, row] = cell.split(',').map(Number);
      if (row < top || row > bottom) continue;
      if (side === 'left' && col >= GRID_WIDTH / 2) continue;
      if (side === 'right' && col < GRID_WIDTH / 2) continue;
      out.push([col, row]);
    }
    return out;
  }

  const scored = createRescueGame({ seed: 1 });
  scored.state.score = 8888;
  const dim = createRescueGame({ seed: 1 });
  dim.state.score = 0;

  const bright = bandCells(scored.state, 0, 40, 'left');
  const faint = bandCells(dim.state, 0, 40, 'left');
  check('the score lights more segments as it climbs',
    bright.length > faint.length, `8888 lights ${bright.length}, 0000 lights ${faint.length}`);
  check('the score sits in the top-left corner',
    faint.length > 0 && Math.min(...faint.map(([col]) => col)) < 12,
    `leftmost lit column ${faint.length ? Math.min(...faint.map(([col]) => col)) : 'none'}`);

  // Two boats roughly double a run's score -- the best measured runs land in
  // the 800s and a strong player will pass a thousand. The readout has to
  // hold what the game can actually produce, or the number silently stops
  // counting partway through the best run someone ever has.
  const thousand = createRescueGame({ seed: 1 });
  thousand.state.score = 1000;
  const nines = createRescueGame({ seed: 1 });
  nines.state.score = 999;
  const key = (state) => bandCells(state, 0, 40, 'left').map(String).sort().join('|');
  check('a score past 999 still changes the readout', key(thousand.state) !== key(nines.state));

  // Four glyphs wide, not three: the fourth has to be drawn, not merely
  // survivable. Anything narrower means the thousands digit fell off.
  const spanned = Math.max(...bright.map(([col]) => col)) - Math.min(...bright.map(([col]) => col)) + 1;
  const glyph = Math.floor(spanned / 4);
  check('the score readout is four digits wide', spanned >= 4 * glyph && glyph >= 13,
    `score band spans ${spanned} cells, about ${glyph} per digit`);

  const lampCounts = [];
  for (let misses = 0; misses <= 4; misses++) {
    const s = createRescueGame({ seed: 1 });
    s.state.score = 0;
    s.state.misses = misses;
    lampCounts.push(bandCells(s.state, 14, 26, 'right').length);
  }
  const perLamp = lampCounts[1] - lampCounts[0];
  check('a miss lamp lights for each life spent',
    perLamp > 0 && lampCounts.every((n, i) => n === lampCounts[0] + perLamp * i),
    lampCounts.join(', '));

  const spentAll = createRescueGame({ seed: 1 });
  spentAll.state.score = 0;
  spentAll.state.misses = 4;
  const before = new Set(bandCells(dim.state, 0, 40).map(String));
  const added = bandCells(spentAll.state, 0, 40).filter((cell) => !before.has(String(cell)));
  check('the miss lamps sit opposite the score',
    added.length > 0 && added.every(([col]) => col >= GRID_WIDTH / 2),
    `${added.filter(([col]) => col < GRID_WIDTH / 2).length} of ${added.length} lamp cells on the score's side`);

  const fresh = createRescueGame({ seed: 1 });
  const spent = createRescueGame({ seed: 1 });
  spent.state.step = RUN_STEPS;
  const barFull = bandCells(fresh.state, 41, 48).length;
  const barGone = bandCells(spent.state, 41, 48).length;
  check('the time bar empties as the run runs out',
    barFull > 0 && barGone === 0, `${barFull} lit at the start, ${barGone} at the end`);

  // Nothing from the play area may creep up into the band the readout owns.
  check('the readout band is clear below the time bar',
    bandCells(dim.state, 49, 53).length === 0,
    `${bandCells(dim.state, 49, 53).length} cells lit between the bar and the ship`);
}

/* -- the control surface ------------------------------------------------ */
//
// orderAt is the entire control scheme, so what a touch means is asserted
// rather than trusted: the half you touch has to pick the boat, and the
// column has to pick the nearest dock.
{
  const cellPx = SCALE;
  const at = (col) => harness.renderer.orderAt(col * cellPx + cellPx / 2);

  const wrongSide = [];
  for (let col = 0; col < GRID_WIDTH; col++) {
    const expected = col < GRID_WIDTH / 2 ? 0 : 1;
    if (at(col).side !== expected) wrongSide.push(col);
  }
  check('the half of the panel you touch picks the boat', wrongSide.length === 0,
    `${wrongSide.length} columns addressed the wrong boat`);

  const wrongDock = [];
  for (let side = 0; side < SIDES; side++) {
    for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) {
      const got = at(LAYOUT.DOCK_CENTRE[side][dock]);
      if (got.side !== side || got.dock !== dock) wrongDock.push(`${side}/${dock} -> ${got.side}/${got.dock}`);
    }
  }
  check('touching a dock orders that dock', wrongDock.length === 0, wrongDock.slice(0, 3).join(', '));

  // A thumb at the very edge of the glass, outside the letterboxed board,
  // still has to reach the outermost dock -- that is where the shore is, and
  // it is exactly where a thumb sits when the panel is narrower than the
  // phone.
  const farLeft = harness.renderer.orderAt(-40);
  const farRight = harness.renderer.orderAt(GRID_WIDTH * cellPx + 40);
  check('a touch past the edge of the board still orders the shore',
    farLeft.side === 0 && farLeft.dock === 0 && farRight.side === 1 && farRight.dock === 0,
    `${JSON.stringify(farLeft)} / ${JSON.stringify(farRight)}`);
}

/* -- ghost opacity stays in the intended band --------------------------- */
{
  check('ghost opacity is subtle', (() => {
    const m = GHOST.match(/([\d.]+)\)$/);
    const alpha = m ? Number(m[1]) : 1;
    return alpha >= 0.05 && alpha <= 0.09;
  })(), GHOST);
}

/* -- the renderer must not write to game state -------------------------- */
{
  const game = createRescueGame({ seed: 12345 });
  for (let i = 0; i < 600; i++) game.update({ left: 0, right: 2 });
  const before = JSON.stringify(game.state);
  harness.draw(game.state, { badge: 'PRACTICE' });
  check('draw does not mutate game state', JSON.stringify(game.state) === before);
}

/* -- degenerate viewport ------------------------------------------------ */
{
  const tiny = createHarness();
  tiny.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1, height: 1 });
  let survived = true; let message = '';
  try {
    tiny.renderer.resize();
    tiny.draw(createRescueGame({ seed: 1 }).state, {});
    tiny.renderer.orderAt(0);
  } catch (error) { survived = false; message = error.message; }
  check('survives a 1x1 viewport', survived, message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
