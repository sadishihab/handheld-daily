/**
 * Parachute renderer -- Game & Watch style LCD segments.
 *
 * Every position an entity can occupy is a fixed segment on the panel, and
 * all of them are drawn every frame: inactive ones faintly, active ones
 * solid. That is what an LCD looks like, and it lets the player read the
 * whole board -- every lane, every stop, every dock -- at a glance.
 *
 * Nothing is interpolated. Segments are on or off and snap between positions
 * on logic ticks, so the loop's interpolation alpha is ignored.
 *
 * The renderer reads game state and mutates nothing. Wall-clock time arrives
 * as a formatted string in `view`; the renderer never reads a clock itself.
 */

import { createLcdSurface } from './lcd.js';
import { drawDigits, measure } from './segments.js';
import {
  drawPattern,
  patternSize,
  PARACHUTIST,
  SURVIVOR,
  HULL,
  SHARK,
  SPLASH,
  PLANE,
  SMOKE_SMALL,
  SMOKE_MEDIUM,
  SMOKE_LARGE,
  JETTY,
  HUT,
  PALM,
} from './sprites.js';
import {
  LANES,
  STOPS,
  DECK_STOP,
  SHORE_DOCK,
  CAPACITY,
  MAX_MISSES,
  RUN_STEPS,
} from '../games/parachute.js';

/* -- Panel layout ------------------------------------------------------- */

/**
 * A fine grid, so figures are small and detailed rather than chunky blocks.
 * At a 840px-wide backing store this is a 5px cell: a parachutist is 45px
 * across where the previous 3-cell sprite was 90px.
 */
export const GRID_WIDTH = 168;
export const GRID_HEIGHT = 220;

/** Centre column of each lane, and of the shore. */
const LANE_COL = [22, 52, 82, 112];
const SHORE_CENTRE = 145;
/** Every boat position: the lanes, then the shore. */
const DOCK_COL = [...LANE_COL, SHORE_CENTRE];

/** Top row of a parachutist sprite at each stop. */
const STOP_ROW = [66, 84, 102, 120, 138, 156, 174];

const BOAT_TOP = 178;
const SLOT_ROW = BOAT_TOP;
const HULL_ROW = BOAT_TOP + 5;
const WATERLINE_ROW = 192;
const SPLASH_ROW = 196;
const SHARK_ROW = 202;

const CLOCK_ROW = 2;
const CLOCK_COL = 4;
const DIGIT_UNIT = 3;
const DIGIT_LEN = 7;
const MISS_ROW = 28;
const BAR_ROW = 35;
/** The play area starts below the readout. */
const PLANE_ROW = 45;

/**
 * The panel layout, exported so tests can derive exactly which cells an
 * entity can ever occupy and assert that no painted art lands on one.
 */
export const LAYOUT = {
  LANE_COL,
  DOCK_COL,
  STOP_ROW,
  SLOT_ROW,
  HULL_ROW,
  SPLASH_ROW,
  SHARK_ROW,
  WATERLINE_ROW,
};

const PARACHUTIST_W = patternSize(PARACHUTIST).width;
const HULL_W = patternSize(HULL).width;
const SHARK_W = patternSize(SHARK).width;
const SPLASH_W = patternSize(SPLASH).width;

const half = (n) => Math.floor(n / 2);

export function createParachuteRenderer(canvas) {
  const lcd = createLcdSurface(canvas, { gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });
  const paint = (pattern, col, row, style) => drawPattern(lcd, pattern, col, row, style);

  /* -- entity segments -------------------------------------------------- */

  function parachutistAt(lane, stop, style) {
    paint(PARACHUTIST, LANE_COL[lane] - half(PARACHUTIST_W), STOP_ROW[stop], style);
  }

  function splashAt(lane, style) {
    paint(SPLASH, LANE_COL[lane] - half(SPLASH_W), SPLASH_ROW, style);
  }

  function sharkAt(lane, style) {
    paint(SHARK, LANE_COL[lane] - half(SHARK_W), SHARK_ROW, style);
  }

  /** The boat, with `aboard` of its four slots occupied. */
  function boatAt(dock, aboard, style, slotStyle) {
    const left = DOCK_COL[dock] - half(HULL_W);
    paint(HULL, left, HULL_ROW, style);
    for (let slot = 0; slot < CAPACITY; slot++) {
      paint(SURVIVOR, left + 2 + slot * 4, SLOT_ROW, slot < aboard ? style : slotStyle);
    }
  }

  /**
   * Every position the board can hold, drawn faintly. An unlit LCD segment is
   * still visible in the glass, and seeing the empty board is what lets a
   * player plan a lane ahead.
   */
  function drawGhostBoard() {
    const ghost = lcd.colors.ghost;
    for (let lane = 0; lane < LANES; lane++) {
      for (let stop = 0; stop < STOPS; stop++) parachutistAt(lane, stop, ghost);
      splashAt(lane, ghost);
      sharkAt(lane, ghost);
    }
    for (let dock = 0; dock <= SHORE_DOCK; dock++) boatAt(dock, 0, ghost, ghost);
  }

  /* -- painted background ------------------------------------------------ */

  function drawPlane() {
    paint(PLANE, 6, PLANE_ROW, lcd.colors.ink);
    // Billows trailing back from the tail, growing as they drift. The column
    // runs sideways rather than straight up: the readout occupies everything
    // above, and smoke crossing the clock digits is unreadable.
    const dim = lcd.colors.dim;
    paint(SMOKE_SMALL, 34, PLANE_ROW - 3, dim);
    paint(SMOKE_MEDIUM, 42, PLANE_ROW - 5, dim);
    paint(SMOKE_LARGE, 54, PLANE_ROW - 7, dim);
    paint(SMOKE_MEDIUM, 70, PLANE_ROW - 5, dim);
    paint(SMOKE_SMALL, 84, PLANE_ROW - 2, dim);
  }

  /** The landing area: jetty, hut and a palm, at the right-hand edge. */
  function drawShore() {
    const ink = lcd.colors.ink;
    // The jetty sits below the hull line and the hut well above it, so the
    // boat can dock without either drawing through it.
    paint(JETTY, SHORE_CENTRE - 14, WATERLINE_ROW + 2, ink);
    paint(HUT, SHORE_CENTRE - 6, WATERLINE_ROW - 28, ink);
    paint(PALM, GRID_WIDTH - 15, WATERLINE_ROW - 46, ink);
    // Sand under the jetty.
    lcd.fillArea(SHORE_CENTRE - 16, WATERLINE_ROW + 9, GRID_WIDTH - SHORE_CENTRE + 16, 2, ink);
  }

  /** Is this cell part of a splash or a shark segment? */
  function reservedForEntity(col, row) {
    if (row >= SPLASH_ROW && row < SPLASH_ROW + 5) return true;
    if (row >= SHARK_ROW && row < SHARK_ROW + 7) return true;
    return false;
  }

  /**
   * Water. The wave phase advances with simulated steps, not the wall clock,
   * so a replay of a seed shows identical water.
   *
   * Rows an entity can occupy are left clear: a wave lighting the same cells
   * as a splash or a shark would let the player misread the two.
   */
  function drawWater(state) {
    const phase = Math.floor(state.step / 24) % 2;
    const right = SHORE_CENTRE - 16;
    for (let row = WATERLINE_ROW + 2; row < GRID_HEIGHT; row += 6) {
      if (reservedForEntity(0, row)) continue;
      for (let col = (phase + half(row)) % 12; col < right; col += 12) {
        lcd.fillArea(col, row, 6, 2, row % 12 === 0 ? lcd.colors.ink : lcd.colors.dim);
      }
    }
    lcd.fillArea(0, WATERLINE_ROW, right, 2, lcd.colors.ink);
  }

  /* -- readout ----------------------------------------------------------- */

  function drawReadout(state, view) {
    const on = lcd.colors.ink;
    const off = lcd.colors.ghost;
    const digit = { on, off, unit: DIGIT_UNIT, len: DIGIT_LEN };

    if (view.clock) {
      drawDigits(lcd, view.clock, CLOCK_COL, CLOCK_ROW, {
        ...digit,
        colonOn: view.colonOn !== false,
      });
    }

    const score = String(Math.min(999, state.score)).padStart(3, '0');
    const width = measure(score, DIGIT_UNIT, DIGIT_LEN);
    drawDigits(lcd, score, GRID_WIDTH - width - CLOCK_COL, CLOCK_ROW, digit);

    // Miss markers: fixed segments, lit as they are spent.
    for (let i = 0; i < MAX_MISSES; i++) {
      const col = GRID_WIDTH - CLOCK_COL - (MAX_MISSES - i) * 9;
      lcd.fillArea(col, MISS_ROW, 6, 4, i < state.misses ? on : off);
    }

    // Time bar: every cell drawn, lit ones showing time left.
    const remaining = Math.max(0, RUN_STEPS - state.step);
    const lit = Math.ceil((remaining * (GRID_WIDTH - CLOCK_COL * 2)) / RUN_STEPS);
    lcd.fillArea(CLOCK_COL, BAR_ROW, GRID_WIDTH - CLOCK_COL * 2, 3, off);
    if (lit > 0) lcd.fillArea(CLOCK_COL, BAR_ROW, lit, 3, on);
  }

  function drawEndOverlay(state) {
    const label = state.endReason === 'time' ? 'TIME UP' : 'GAME OVER';
    lcd.drawText(label, GRID_WIDTH / 2, half(GRID_HEIGHT) - 8, {
      align: 'center',
      scale: 14,
      style: lcd.colors.ink,
    });
  }

  return {
    resize: lcd.resize,
    /**
     * @param {object} state Live game state. Read only.
     * @param {{badge?: string|null, clock?: string, colonOn?: boolean}} [view]
     */
    draw(state, view = {}) {
      lcd.clear();

      drawGhostBoard();
      drawPlane();
      drawWater(state);
      drawShore();
      drawReadout(state, view);

      const ink = lcd.colors.ink;
      const ghost = lcd.colors.ghost;

      for (const shark of state.sharks) {
        if (shark.pos >= 0 && shark.pos < LANES) sharkAt(shark.pos, ink);
      }

      boatAt(state.boatDock, state.aboard, ink, ghost);

      for (const p of state.parachutists) {
        if (p.doomed && p.stop >= DECK_STOP) splashAt(p.lane, ink);
        else parachutistAt(p.lane, p.stop, ink);
      }

      if (view.badge) {
        lcd.fillArea(0, GRID_HEIGHT - 8, GRID_WIDTH, 8, lcd.colors.ground);
        lcd.drawText(view.badge, GRID_WIDTH / 2, GRID_HEIGHT - 8, {
          align: 'center',
          scale: 7,
          style: lcd.colors.dim,
        });
      }

      // A miss or a shark blinks the panel: hard on/off, no fade.
      const flash = Math.max(state.missFlash, state.sharkFlash);
      if (flash > 0 && flash % 6 >= 3) lcd.flood(lcd.colors.ghost);

      if (state.phase === 'ended') drawEndOverlay(state);
    },
  };
}
