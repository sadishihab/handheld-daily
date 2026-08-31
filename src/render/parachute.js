/**
 * Parachute renderer -- reads game state, draws it, mutates nothing.
 *
 * The renderer is deliberately dumb: every value it draws is already in the
 * state object, and it derives nothing that the simulation would need back.
 * That is what lets the same run be replayed, or run headlessly in the
 * determinism test, with no renderer at all.
 *
 * It ignores the loop's interpolation alpha on purpose. Positions snap to
 * whole cells, so there is nothing to interpolate -- an LCD panel does not
 * show a parachutist halfway between two pixels.
 */

import { createLcdSurface } from './lcd.js';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  BOAT_ROW,
  BOAT_WIDTH,
  WATER_ROW,
  MAX_MISSES,
  RUN_STEPS,
} from '../games/parachute.js';

const SUBCELL = 64;

export function createParachuteRenderer(canvas) {
  const lcd = createLcdSurface(canvas, { gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });

  function drawParachutist(p) {
    const row = Math.floor(p.ySub / SUBCELL);
    if (p.doomed) {
      // Canopy collapses once it has gone past the boat.
      lcd.fillCell(p.col, row - 1);
      lcd.fillCell(p.col, row);
      return;
    }
    lcd.fillRow(p.col - 1, row - 2, 3); // canopy
    lcd.fillCell(p.col, row - 1); // lines
    lcd.fillCell(p.col, row); // body
  }

  function drawBoat(state) {
    const col = Math.floor(state.boatXSub / SUBCELL);
    lcd.fillCell(col + 1, BOAT_ROW - 1); // crew
    lcd.fillRow(col, BOAT_ROW, BOAT_WIDTH); // hull
  }

  function drawWater(state) {
    // Wave phase advances with simulated steps, not wall-clock, so the water
    // animates identically in a replay. Still render-only -- nothing reads it.
    const phase = Math.floor(state.step / 12);
    for (let row = WATER_ROW; row < GRID_HEIGHT; row++) {
      for (let col = 0; col < GRID_WIDTH; col++) {
        if ((col + phase + row * 2) % 4 === 0) lcd.fillCell(col, row);
      }
    }
  }

  function drawReadout(state) {
    lcd.drawText(String(state.score).padStart(3, '0'), 0, 0, { scale: 2.2 });

    // Misses as pips, filled for lives spent.
    for (let i = 0; i < MAX_MISSES; i++) {
      const col = GRID_WIDTH - 1 - (MAX_MISSES - 1 - i) * 2;
      if (i < state.misses) {
        lcd.fillCell(col, 0);
        lcd.fillCell(col, 1);
      } else {
        lcd.fillCell(col, 1);
      }
    }

    // Time remaining as a bar on row 2.
    const remaining = Math.max(0, RUN_STEPS - state.step);
    const width = Math.ceil((remaining * GRID_WIDTH) / RUN_STEPS);
    lcd.fillRow(0, 2, width, lcd.colors.ghost);
    for (let col = 0; col < width; col += 2) lcd.fillCell(col, 2);
  }

  function drawEndOverlay(state) {
    const label = state.endReason === 'time' ? 'TIME UP' : 'GAME OVER';
    lcd.drawText(label, GRID_WIDTH / 2, Math.floor(GRID_HEIGHT / 2) - 3, {
      align: 'center',
      scale: 2.4,
    });
    lcd.drawText(`SCORE ${state.score}`, GRID_WIDTH / 2, Math.floor(GRID_HEIGHT / 2) + 1, {
      align: 'center',
      scale: 1.8,
    });
    lcd.drawText('TAP TO RETRY', GRID_WIDTH / 2, Math.floor(GRID_HEIGHT / 2) + 5, {
      align: 'center',
      scale: 1.2,
      style: lcd.colors.ghost,
    });
  }

  return {
    resize: lcd.resize,
    /**
     * @param {object} state Live game state. Read only.
     * @param {{badge?: string|null}} [view] Chrome that is not part of the
     *   simulation -- currently the PRACTICE label.
     */
    draw(state, view = {}) {
      lcd.clear();
      drawReadout(state);
      if (view.badge) {
        lcd.drawText(view.badge, GRID_WIDTH / 2, 0, {
          align: 'center',
          scale: 1.1,
          style: lcd.colors.ghost,
        });
      }
      drawWater(state);
      drawBoat(state);
      for (const p of state.parachutists) drawParachutist(p);

      // Flash on the frames right after a splash. Blinks rather than holds,
      // which is how a real segment display signals a fault.
      if (state.missFlash > 0 && state.missFlash % 6 >= 3) {
        lcd.flood(lcd.colors.ghost);
      }

      if (state.phase === 'ended') drawEndOverlay(state);
    },
  };
}
