/**
 * Parachute renderer -- Game & Watch style LCD segments.
 *
 * Every position an entity can occupy is a fixed segment on the panel, and
 * all of them are drawn every frame: the inactive ones faintly, the active
 * ones solid. That is what an LCD actually looks like, and it means the
 * player can read the whole board -- every lane, every stop, every dock --
 * at a glance.
 *
 * Nothing here is interpolated. Segments are either on or off, and they snap
 * between positions on logic ticks, so the loop's interpolation alpha is
 * ignored: there is no such thing as half a lit segment.
 *
 * The renderer reads game state and mutates nothing.
 */

import { createLcdSurface } from './lcd.js';
import { drawDigits, measure, DIGIT_HEIGHT } from './segments.js';
import {
  LANES,
  STOPS,
  DOCKS,
  DECK_STOP,
  MAX_MISSES,
  RUN_STEPS,
} from '../games/parachute.js';

/* -- Panel layout. Purely visual: the simulation knows only lane and stop
      indices, and this is where those become places on the glass. -------- */

export const GRID_WIDTH = 28;
export const GRID_HEIGHT = 37;

/** Centre column of each lane. Spaced 4 apart so the 3-wide canopies of
 *  neighbouring lanes never touch, which matters once every one is ghosted. */
const LANE_COL = [1, 5, 9, 13, 17, 21];

/** Row of each stop. Spaced 3 apart, leaving a clear row between sprites. */
const STOP_ROW = [13, 16, 19, 22, 25, 28, 31];

const BOAT_CREW_ROW = 30;
const BOAT_DECK_ROW = 31;
const SHORELINE_ROW = 32;
const WATER_TOP_ROW = 33;
const SPLASH_ROW = 34;

const CLOCK_COL = 0;
const CLOCK_ROW = 0;
const SCORE_ROW = 0;
const MISS_ROW = 5;
const BAR_ROW = 6;

const SHORE_COL = 24;

export function createParachuteRenderer(canvas) {
  const lcd = createLcdSurface(canvas, { gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });

  /** Solid block of cells -- segments are shapes, not dots. */
  const seg = (col, row, w, h, style) => lcd.fillArea(col, row, w, h, style);

  /* -- entity segments ---------------------------------------------------- */

  function parachutistSegment(lane, stop, style) {
    const col = LANE_COL[lane];
    const row = STOP_ROW[stop];
    seg(col - 1, row - 1, 3, 1, style); // canopy
    seg(col, row, 1, 1, style); // body
  }

  function splashSegment(lane, style) {
    const col = LANE_COL[lane];
    seg(col - 1, SPLASH_ROW, 1, 1, style);
    seg(col + 1, SPLASH_ROW, 1, 1, style);
    seg(col, SPLASH_ROW - 1, 1, 1, style);
  }

  function boatSegment(dock, style) {
    const col = LANE_COL[dock];
    seg(col, BOAT_CREW_ROW, 1, 1, style); // crew
    seg(col - 1, BOAT_DECK_ROW, 3, 1, style); // hull
  }

  /**
   * Every position the board can hold, drawn faintly. This is the whole
   * effect: an unlit LCD segment is still visible in the glass.
   */
  function drawGhostBoard() {
    const ghost = lcd.colors.ghost;
    for (let lane = 0; lane < LANES; lane++) {
      for (let stop = 0; stop < STOPS; stop++) parachutistSegment(lane, stop, ghost);
      splashSegment(lane, ghost);
    }
    for (let dock = 0; dock < DOCKS; dock++) boatSegment(dock, ghost);
  }

  /* -- painted background ------------------------------------------------- */

  /** The crashed plane and its smoke. Static line art, always lit. */
  function drawPlane() {
    const ink = lcd.colors.ink;
    // Nose-down fuselage with a wing, roughly cols 3-12, rows 8-11.
    seg(10, 8, 2, 1, ink); // tail fin
    seg(6, 9, 6, 1, ink); // upper fuselage
    seg(4, 10, 7, 1, ink); // lower fuselage
    seg(3, 11, 3, 1, ink); // nose
    seg(8, 11, 2, 1, ink); // wing

    // Smoke: detached puffs rising to the right, drawn dim so they read as
    // background rather than as something the player must track.
    const dim = lcd.colors.dim;
    seg(13, 10, 2, 1, dim);
    seg(15, 9, 2, 1, dim);
    seg(14, 8, 1, 1, dim);
    seg(17, 8, 2, 1, dim);
    seg(16, 7, 1, 1, dim);
    seg(19, 7, 1, 1, dim);
  }

  /** Palm trees and sand along the right-hand shore. */
  function drawShore() {
    const ink = lcd.colors.ink;

    // Tall palm.
    seg(SHORE_COL + 1, 26, 1, 6, ink); // trunk
    seg(SHORE_COL - 1, 25, 2, 1, ink); // left fronds
    seg(SHORE_COL + 2, 25, 2, 1, ink); // right fronds
    seg(SHORE_COL + 1, 24, 1, 1, ink); // crown

    // Short palm behind it.
    seg(SHORE_COL + 3, 28, 1, 4, ink);
    seg(SHORE_COL + 2, 27, 1, 1, ink);
    seg(SHORE_COL + 3, 27, 2, 1, ink);

    // Sand.
    seg(SHORE_COL - 1, SHORELINE_ROW, GRID_WIDTH - SHORE_COL + 1, 1, ink);
    for (let row = WATER_TOP_ROW; row < GRID_HEIGHT; row++) {
      seg(SHORE_COL + (row % 2), row, 2, 1, lcd.colors.dim);
    }
  }

  /** Is this cell part of a lane's splash segment? */
  function isSplashCell(col, row) {
    if (row !== SPLASH_ROW && row !== SPLASH_ROW - 1) return false;
    for (let lane = 0; lane < LANES; lane++) {
      const c = LANE_COL[lane];
      if (row === SPLASH_ROW && (col === c - 1 || col === c + 1)) return true;
      if (row === SPLASH_ROW - 1 && col === c) return true;
    }
    return false;
  }

  /**
   * Water. The two-phase wave is driven by the simulated step count, not the
   * wall clock, so a replay of a seed shows identical water.
   *
   * Cells belonging to a splash segment are left clear. Otherwise the wave
   * would light the same cells a splash uses, and on half the phases an
   * ordinary wave would be indistinguishable from a parachutist hitting the
   * sea -- the one event the player must not misread.
   */
  function drawWater(state) {
    const phase = Math.floor(state.step / 20) % 2;
    for (let row = WATER_TOP_ROW; row < GRID_HEIGHT; row++) {
      const style = row % 2 === 0 ? lcd.colors.ink : lcd.colors.dim;
      for (let col = 0; col < SHORE_COL - 1; col++) {
        const lit = Math.floor((col + (phase + row) * 2) / 2) % 2 === 0;
        if (!lit || isSplashCell(col, row)) continue;
        seg(col, row, 1, 1, style);
      }
    }
  }

  /* -- readout ------------------------------------------------------------ */

  function drawReadout(state, view) {
    const on = lcd.colors.ink;
    const off = lcd.colors.ghost;

    // Clock, top left, the way every handheld of the era did it.
    if (view.clock) {
      drawDigits(lcd, view.clock, CLOCK_COL, CLOCK_ROW, {
        on,
        off,
        colonOn: view.colonOn !== false,
      });
    }

    // Score, top right, right-aligned so it grows leftwards.
    const score = String(Math.min(999, state.score)).padStart(2, '0');
    const scoreWidth = measure(score);
    drawDigits(lcd, score, GRID_WIDTH - scoreWidth, SCORE_ROW, { on, off });

    // Miss markers: three fixed segments, lit as they are spent.
    for (let i = 0; i < MAX_MISSES; i++) {
      const col = GRID_WIDTH - 2 - (MAX_MISSES - 1 - i) * 3;
      seg(col, MISS_ROW, 2, 1, i < state.misses ? on : off);
    }

    // Time bar: every cell drawn, lit ones showing time left.
    const remaining = Math.max(0, RUN_STEPS - state.step);
    const lit = Math.ceil((remaining * GRID_WIDTH) / RUN_STEPS);
    for (let col = 0; col < GRID_WIDTH; col++) {
      seg(col, BAR_ROW, 1, 1, col < lit ? on : off);
    }
  }

  function drawEndOverlay(state) {
    const label = state.endReason === 'time' ? 'TIME UP' : 'GAME OVER';
    lcd.drawText(label, GRID_WIDTH / 2, Math.floor(GRID_HEIGHT / 2) - 2, {
      align: 'center',
      scale: 2.2,
      style: lcd.colors.ink,
    });
  }

  return {
    resize: lcd.resize,
    /**
     * @param {object} state Live game state. Read only.
     * @param {{badge?: string|null, clock?: string, colonOn?: boolean}} [view]
     *   Chrome that is not part of the simulation.
     */
    draw(state, view = {}) {
      lcd.clear();

      drawGhostBoard();
      drawPlane();
      drawShore();
      drawWater(state);
      drawReadout(state, view);

      // Lit entities, over their own ghosts.
      const ink = lcd.colors.ink;
      boatSegment(state.boatDock, ink);
      for (const p of state.parachutists) {
        if (p.doomed && p.stop >= DECK_STOP) splashSegment(p.lane, ink);
        else parachutistSegment(p.lane, p.stop, ink);
      }

      if (view.badge) {
        lcd.fillArea(0, GRID_HEIGHT - 1, GRID_WIDTH, 1, lcd.colors.ground);
        lcd.drawText(view.badge, GRID_WIDTH / 2, GRID_HEIGHT - 1, {
          align: 'center',
          scale: 1,
          style: lcd.colors.dim,
        });
      }

      // A miss blinks the whole panel, the way a segment display signals a
      // fault. Hard on/off -- no fade.
      if (state.missFlash > 0 && state.missFlash % 6 >= 3) {
        lcd.flood(lcd.colors.ghost);
      }

      if (state.phase === 'ended') drawEndOverlay(state);
    },
  };
}
