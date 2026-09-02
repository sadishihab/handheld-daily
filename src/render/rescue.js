/**
 * Ship rescue renderer -- Game & Watch style LCD segments.
 *
 * Every position an entity can occupy is a fixed segment on the panel, and
 * all of them are drawn every frame: inactive ones faintly, active ones
 * solid. That is what an LCD looks like, and it lets the player read the
 * whole board -- every dock, every lane, every place on the deck someone
 * might still be standing -- at a glance.
 *
 * Nothing is interpolated. Segments are on or off and snap between positions
 * on logic ticks, so the loop's interpolation alpha is ignored.
 *
 * The renderer reads game state and mutates nothing.
 */

import { createLcdSurface } from './lcd.js';
import { drawDigits } from './segments.js';
import {
  drawPattern,
  patternSize,
  flip,
  PASSENGER,
  DECK_PASSENGER,
  HULL,
  JUMPER_SPREAD,
  JUMPER_TUCK,
  SPLASH_FRAMES,
  SHARK,
  BRIDGE,
  FUNNEL,
  COWL,
  LIFEBOAT,
  FLAME_FRAMES,
  SMOKE_SMALL,
  SMOKE_MEDIUM,
  SMOKE_LARGE,
  JETTY,
  BOATHOUSE,
  PALM,
  CLOUD_SMALL,
  CLOUD_LARGE,
} from './sprites.js';
import {
  SIDES,
  DOCKS_PER_SIDE,
  LANE_DOCK,
  LANES_PER_SIDE,
  ARC_STOPS,
  CROWD_PER_SIDE,
  CAPACITY,
  MAX_MISSES,
  RUN_STEPS,
  SHARK_DOCKS,
  splashFrame,
} from '../games/rescue.js';

/* -- Panel layout ------------------------------------------------------- */

/**
 * A 252-cell grid, up from 168.
 *
 * The panel is width-limited on a phone, so the grid width alone decides how
 * much detail any figure can carry. At 168 a passenger standing in the boat
 * was two cells wide and four of them read as one bar -- the thing the player
 * looks at for the whole run was the least legible thing on the glass.
 *
 * 168x6 and 252x4 are both 1008, so on a 3x phone the panel comes out the
 * same physical width either way: the boat is the same size in millimetres
 * and is simply cut into more cells. The cost is grain -- a cell drops from
 * about 2 CSS pixels to about 1.33 -- and on a 2x screen the integer-cell
 * rule bites harder, since 252 divides the available pixels less kindly than
 * 168 did. grid-test.html renders both and prints the numbers, which is how
 * that trade was checked on real glass rather than argued about.
 */
export const GRID_WIDTH = 252;
export const GRID_HEIGHT = 330;

const PASSENGER_W = patternSize(PASSENGER).width;
const DECK_PASSENGER_W = patternSize(DECK_PASSENGER).width;
const HULL_W = patternSize(HULL).width;
const JUMPER_W = patternSize(JUMPER_SPREAD).width;
const SPLASH_W = patternSize(SPLASH_FRAMES[0]).width;
const SHARK_W = patternSize(SHARK).width;

const half = (n) => Math.floor(n / 2);

/**
 * Mirror a sprite's left cell to the other half of the board.
 *
 * The whole panel is symmetrical about the ship, so the right-hand side is
 * never laid out by hand -- it is the left-hand side reflected. That is the
 * only way two halves this detailed stay identical as the art is edited.
 */
const mirrorCol = (col, width) => GRID_WIDTH - width - col;
/** The same reflection for a centre line rather than a sprite's left edge. */
const mirrorCentre = (col) => GRID_WIDTH - 1 - col;

/* --- the readout band -------------------------------------------------- */

const EDGE_COL = 6;
const READOUT_ROW = 3;
const DIGIT_UNIT = 4;
const DIGIT_LEN = 9;
/** Four digits, not three: two boats roughly double a run's score, and the
 *  best measured runs land in the 800s where three digits had no headroom. */
const SCORE_DIGITS = 4;
const MISS_ROW = 16;
const MISS_W = 12;
const MISS_H = 8;
const MISS_PITCH = 17;
const BAR_ROW = 42;
const BAR_H = 5;

/* --- the ship ---------------------------------------------------------- */

const SHIP_LEFT = 6;
const SHIP_W = GRID_WIDTH - SHIP_LEFT * 2;

/** Rows of passengers on the decks, and the deck each row stands on. */
const CROWD_ROW = [96, 118];
const DECK_ROW = [100, 122];
const DECK_H = 4;
/** The band of ship side between the two decks. */
const SIDE_ROW = DECK_ROW[0] + DECK_H;
const SIDE_H = CROWD_ROW[1] - SIDE_ROW;
/** The hull below the lower deck. */
const SHIP_HULL_ROW = DECK_ROW[1] + DECK_H;
const SHIP_HULL_H = 37;

/**
 * Where each waiting passenger stands.
 *
 * Two rows of 23 a side, 46 in all, which is exactly CROWD_PER_SIDE -- the
 * deck is not a decoration sized to taste, it is the manifest drawn out.
 */
const CROWD_ROWS = CROWD_ROW.length;
const CROWD_COLUMNS = Math.ceil(CROWD_PER_SIDE / CROWD_ROWS);
const CROWD_PITCH = 5;
const CROWD_LEFT = 8;

/* --- the water --------------------------------------------------------- */

/**
 * Docks, laid out from the outer edge inward.
 *
 * Dock 0 is the shore. The pitch is the widest that fits all six docks in
 * half a panel without the two innermost hulls -- one per side -- running
 * into each other at the centre line, which is why it is 21 against a
 * 17-cell hull: four clear cells of water between neighbouring moorings, so
 * the ghost row reads as a line of separate berths.
 */
const DOCK_PITCH = 21;
const OUTER_DOCK_CENTRE = 12;
const DOCK_CENTRE = Array.from({ length: SIDES }, (_, side) =>
  Array.from({ length: DOCKS_PER_SIDE }, (_, dock) => {
    const left = OUTER_DOCK_CENTRE + dock * DOCK_PITCH;
    return side === 0 ? left : mirrorCentre(left);
  })
);

/** The centre line of each jump lane: the dock it comes down over. */
const LANE_CENTRE = DOCK_CENTRE.map((docks) => LANE_DOCK.map((dock) => docks[dock]));

const SLOT_ROW = 244;
const HULL_ROW = 249;
const SLOT_PITCH = PASSENGER_W + 1;
const SLOT_INSET = Math.floor((HULL_W - (CAPACITY * SLOT_PITCH - 1)) / 2);

const WATERLINE_ROW = 256;
const SPLASH_ROW = 259;
const SHARK_ROW = 276;

/* --- the jump arc ------------------------------------------------------ */

/** Top row of a jumper sprite at each stop. */
const STOP_ROW = [166, 182, 198, 213, 228, 243];

/**
 * How far inboard of the landing column each stop sits.
 *
 * A short arc, exactly as far as it can be: at the innermost lane the two
 * sides' arcs are only a few cells apart at the top of the drop, and a wider
 * swing would have left- and right-hand jumpers overlapping across the centre
 * line. The last two entries are zero because those are the stops a catch can
 * resolve on -- the jumper has to be over the boat's own column by then, or
 * the segment the player is reading is not the segment the rules are using.
 */
const ARC_OFFSET = [5, 4, 3, 1, 0, 0];

/** Which pose a jumper is in at a given stop. */
const jumperPose = (stop) => (stop < 3 ? JUMPER_SPREAD : JUMPER_TUCK);

/* --- the shore --------------------------------------------------------- */

const PALM_ROW = 213;
const BOATHOUSE_ROW = 219;
const JETTY_ROW = 258;
const BEACH_ROW = JETTY_ROW + patternSize(JETTY).height;
const BEACH_W = 26;
/** The cliff edge outboard of the outermost dock. */
const CLIFF_W = 4;

/* --- the sky ----------------------------------------------------------- */

const SKY_ROW = 54;
const FLAME_ROW = 68;
const SUPER_ROW = 73;

/**
 * The panel layout, exported so tests can derive exactly which cells an
 * entity can ever occupy and assert that no painted art lands on one.
 */
export const LAYOUT = {
  GRID_WIDTH,
  GRID_HEIGHT,
  DOCK_CENTRE,
  LANE_CENTRE,
  STOP_ROW,
  ARC_OFFSET,
  jumperPose,
  SLOT_ROW,
  SLOT_INSET,
  SLOT_PITCH,
  HULL_ROW,
  SPLASH_ROW,
  SHARK_ROW,
  WATERLINE_ROW,
  CROWD_ROW,
  CROWD_ROWS,
  CROWD_COLUMNS,
  CROWD_PITCH,
  CROWD_LEFT,
  mirrorCol,
  mirrorCentre,

  /** Left cell of a jumper sprite at (side, lane, stop). */
  jumperCol(side, lane, stop) {
    const centre = LANE_CENTRE[side][lane];
    const offset = ARC_OFFSET[stop];
    return (side === 0 ? centre + offset : centre - offset) - half(JUMPER_W);
  },
  /** Left cell of the hull at (side, dock). */
  hullCol(side, dock) {
    return DOCK_CENTRE[side][dock] - half(HULL_W);
  },
  /** Left cell of a splash at (side, lane). */
  splashCol(side, lane) {
    return LANE_CENTRE[side][lane] - half(SPLASH_W);
  },
  /** Left cell of a shark at (side, dock). */
  sharkCol(side, dock) {
    return DOCK_CENTRE[side][dock] - half(SHARK_W);
  },
  /** Where waiting passenger `slot` stands on `side`'s decks. */
  crowdSlot(side, slot) {
    // Counted inward-first: the passengers nearest the fire go over the side
    // first, so the crowd thins from the middle of the ship outward.
    const column = CROWD_COLUMNS - 1 - Math.floor(slot / CROWD_ROWS);
    const left = CROWD_LEFT + column * CROWD_PITCH;
    return {
      col: side === 0 ? left : mirrorCol(left, DECK_PASSENGER_W),
      row: CROWD_ROW[slot % CROWD_ROWS],
    };
  },
};

export function createRescueRenderer(canvas) {
  const lcd = createLcdSurface(canvas, { gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });
  const paint = (pattern, col, row, style) => drawPattern(lcd, pattern, col, row, style);
  /** Paint a pattern on the left, or its reflection on the right. */
  const paintSide = (side, pattern, col, row, style) => {
    const art = side === 0 ? pattern : flip(pattern);
    const at = side === 0 ? col : mirrorCol(col, patternSize(pattern).width);
    paint(art, at, row, style);
  };

  /* -- entity segments -------------------------------------------------- */

  function jumperAt(side, lane, stop, style) {
    paint(jumperPose(stop), LAYOUT.jumperCol(side, lane, stop), STOP_ROW[stop], style);
  }

  function splashAt(side, lane, frame, style) {
    paint(SPLASH_FRAMES[frame], LAYOUT.splashCol(side, lane), SPLASH_ROW, style);
  }

  /**
   * A shark, facing the way it is swimming.
   *
   * The ghost board draws both facings at every dock, overlapping. That is
   * not a compromise: a real panel has a separate segment for each pose and
   * all of them sit visible in the glass at once, so a doubled shark ghost is
   * exactly what the display it is imitating would show.
   */
  function sharkAt(side, dock, facingLeft, style) {
    const art = facingLeft ? SHARK : flip(SHARK);
    paint(art, LAYOUT.sharkCol(side, dock), SHARK_ROW, style);
  }

  /** The boat on `side`, with `aboard` of its four slots occupied. */
  function boatAt(side, dock, aboard, style, slotStyle) {
    const left = LAYOUT.hullCol(side, dock);
    paint(HULL, left, HULL_ROW, style);
    for (let slot = 0; slot < CAPACITY; slot++) {
      paint(
        PASSENGER,
        left + SLOT_INSET + slot * SLOT_PITCH,
        SLOT_ROW,
        slot < aboard ? style : slotStyle
      );
    }
  }

  function crowdAt(side, slot, style) {
    const { col, row } = LAYOUT.crowdSlot(side, slot);
    paint(DECK_PASSENGER, col, row, style);
  }

  /**
   * Every position the board can hold, drawn faintly.
   *
   * An unlit LCD segment is still visible in the glass, and seeing the empty
   * board is what lets a player plan a dock ahead. It is also what makes the
   * panel read as populated when very little is happening: ninety-two deck
   * positions, twelve docks and thirty-six places in the air are all faintly
   * there whether or not anyone is standing in them.
   */
  function drawGhostBoard() {
    const ghost = lcd.colors.ghost;
    for (let side = 0; side < SIDES; side++) {
      for (let slot = 0; slot < CROWD_PER_SIDE; slot++) crowdAt(side, slot, ghost);
      for (let lane = 0; lane < LANES_PER_SIDE; lane++) {
        for (let stop = 0; stop < ARC_STOPS; stop++) jumperAt(side, lane, stop, ghost);
        for (let frame = 0; frame < SPLASH_FRAMES.length; frame++) {
          splashAt(side, lane, frame, ghost);
        }
      }
      for (const dock of SHARK_DOCKS) {
        sharkAt(side, dock, true, ghost);
        sharkAt(side, dock, false, ghost);
      }
      for (let dock = 0; dock < DOCKS_PER_SIDE; dock++) boatAt(side, dock, 0, ghost, ghost);
    }
  }

  /* -- painted background ------------------------------------------------ */

  /**
   * The ship: two decks the crowd stands on, a superstructure above them and
   * a hull below, burning through the middle.
   *
   * Every painted row here is chosen to fall between the two crowd rows
   * rather than through them -- the deck a passenger stands on is drawn under
   * their feet, never behind them. render.test.js asserts it, because the
   * failure is a passenger who is invisible against the plank they are on.
   */
  function drawShip(state) {
    const ink = lcd.colors.ink;
    const dim = lcd.colors.dim;

    // Smoke and cloud, in the strip of sky the readout leaves.
    paint(CLOUD_SMALL, 12, SKY_ROW + 2, dim);
    paint(CLOUD_LARGE, GRID_WIDTH - 34, SKY_ROW, dim);
    paint(SMOKE_LARGE, half(GRID_WIDTH) - 6, SKY_ROW, dim);
    paint(SMOKE_MEDIUM, half(GRID_WIDTH) - 26, SKY_ROW + 4, dim);
    paint(SMOKE_MEDIUM, half(GRID_WIDTH) + 16, SKY_ROW + 3, dim);
    paint(SMOKE_SMALL, half(GRID_WIDTH) - 40, SKY_ROW + 8, dim);
    paint(SMOKE_SMALL, half(GRID_WIDTH) + 34, SKY_ROW + 7, dim);

    // Superstructure, mirrored so the ship reads the same from either side.
    for (let side = 0; side < SIDES; side++) {
      paintSide(side, BRIDGE, 24, SUPER_ROW, ink);
      paintSide(side, FUNNEL, 84, SUPER_ROW + 1, ink);
      paintSide(side, COWL, 66, SUPER_ROW + 10, ink);
      paintSide(side, LIFEBOAT, 102, SUPER_ROW + 13, ink);
    }

    // The fire amidships. Two frames cut hard on a simulated-step counter --
    // a replay of a seed shows identical flame, which is the same rule the
    // water follows.
    const flame = FLAME_FRAMES[Math.floor(state.step / 9) % FLAME_FRAMES.length];
    paint(flame, half(GRID_WIDTH) - half(patternSize(flame).width), FLAME_ROW, ink);

    // Decks. The crowd stands on the row above each of these.
    for (const row of DECK_ROW) lcd.fillArea(SHIP_LEFT, row, SHIP_W, DECK_H, ink);

    // The ship's side between the decks, with a row of windows punched out.
    lcd.fillArea(SHIP_LEFT, SIDE_ROW, SHIP_W, SIDE_H, ink);
    for (let col = SHIP_LEFT + 4; col < SHIP_LEFT + SHIP_W - 5; col += 9) {
      lcd.fillArea(col, SIDE_ROW + 3, 4, SIDE_H - 7, lcd.colors.ground);
    }

    // The hull, tapering to a point at each end.
    for (let i = 0; i < SHIP_HULL_H; i++) {
      const taper = i < 24 ? 0 : (i - 23) * 5;
      const width = SHIP_W - taper * 2;
      if (width <= 0) break;
      lcd.fillArea(SHIP_LEFT + taper, SHIP_HULL_ROW + i, width, 1, ink);
    }
    // Portholes and a boot-topping stripe, cut back out of it. Thirty-seven
    // unbroken rows of ink is the widest solid mass the panel can hold, and
    // without something punched through it the ship reads as a wall rather
    // than as a ship -- the LCD has no shading to fall back on, so relief has
    // to be holes.
    for (const row of [SHIP_HULL_ROW + 8, SHIP_HULL_ROW + 20]) {
      for (let col = SHIP_LEFT + 10; col < SHIP_LEFT + SHIP_W - 10; col += 14) {
        lcd.fillArea(col, row, 5, 5, lcd.colors.ground);
      }
    }
    lcd.fillArea(SHIP_LEFT + 2, SHIP_HULL_ROW + 15, SHIP_W - 4, 2, lcd.colors.ground);
  }

  /** The landing at each outer edge: cliff, palm, boathouse, jetty, sand. */
  function drawShore() {
    const ink = lcd.colors.ink;
    const dim = lcd.colors.dim;
    for (let side = 0; side < SIDES; side++) {
      paintSide(side, PALM, 2, PALM_ROW, ink);
      paintSide(side, BOATHOUSE, 22, BOATHOUSE_ROW, ink);
      paintSide(side, JETTY, 0, JETTY_ROW, ink);
      // The land itself: a strip outboard of the outermost dock, and the
      // sand the jetty stands on. Both are kept clear of every cell a boat,
      // a shark or a splash can use -- which is what SHARK_OUTER_DOCK bought.
      const cliff = side === 0 ? 0 : GRID_WIDTH - CLIFF_W;
      lcd.fillArea(cliff, PALM_ROW + 24, CLIFF_W, GRID_HEIGHT - PALM_ROW - 24, ink);
      const beach = side === 0 ? 0 : GRID_WIDTH - BEACH_W;
      lcd.fillArea(beach, BEACH_ROW, BEACH_W, 3, ink);
      for (let row = BEACH_ROW + 5; row < GRID_HEIGHT; row += 6) {
        lcd.fillArea(beach + (side === 0 ? 0 : 6), row, BEACH_W - 6, 2, dim);
      }
    }
  }

  /** Is this cell inside a band an entity can occupy? */
  function reservedRow(row) {
    if (row >= SPLASH_ROW && row < SPLASH_ROW + patternSize(SPLASH_FRAMES[0]).height) return true;
    if (row >= SHARK_ROW && row < SHARK_ROW + patternSize(SHARK).height) return true;
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
    const left = BEACH_W;
    const right = GRID_WIDTH - BEACH_W;
    for (let row = WATERLINE_ROW + 4; row < GRID_HEIGHT; row += 8) {
      if (reservedRow(row) || reservedRow(row + 1)) continue;
      for (let col = left + ((phase + half(row)) % 16); col < right; col += 16) {
        lcd.fillArea(col, row, 8, 2, row % 16 === 0 ? lcd.colors.ink : lcd.colors.dim);
      }
    }
    lcd.fillArea(left, WATERLINE_ROW, right - left, 2, lcd.colors.ink);
  }

  /* -- readout ----------------------------------------------------------- */

  function drawReadout(state) {
    const on = lcd.colors.ink;
    const off = lcd.colors.ghost;

    const score = String(Math.min(9999, state.score)).padStart(SCORE_DIGITS, '0');
    drawDigits(lcd, score, EDGE_COL, READOUT_ROW, {
      on, off, unit: DIGIT_UNIT, len: DIGIT_LEN,
    });

    // Miss lamps: fixed segments, lit as they are spent.
    for (let i = 0; i < MAX_MISSES; i++) {
      const col = GRID_WIDTH - EDGE_COL - (MAX_MISSES - i) * MISS_PITCH;
      lcd.fillArea(col, MISS_ROW, MISS_W, MISS_H, i < state.misses ? on : off);
    }

    // Time bar: every cell drawn, lit ones showing time left.
    const remaining = Math.max(0, RUN_STEPS - state.step);
    const width = GRID_WIDTH - EDGE_COL * 2;
    const lit = Math.ceil((remaining * width) / RUN_STEPS);
    lcd.fillArea(EDGE_COL, BAR_ROW, width, BAR_H, off);
    if (lit > 0) lcd.fillArea(EDGE_COL, BAR_ROW, lit, BAR_H, on);
  }

  function drawEndOverlay(state) {
    const label = state.endReason === 'time' ? 'TIME UP' : 'GAME OVER';
    lcd.drawText(label, GRID_WIDTH / 2, half(GRID_HEIGHT) - 12, {
      align: 'center',
      scale: 20,
      style: lcd.colors.ink,
    });
  }

  return {
    resize: lcd.resize,

    /**
     * Turn a touch into an order: which boat, and which dock to send it to.
     *
     * This is the whole control scheme in one function. The half of the panel
     * you touch picks the boat -- no mode, no selection, nothing to remember
     * -- and the column you touch picks the dock, so a tap is a complete
     * instruction rather than the start of a hold. Holding and sliding still
     * works, because a held pointer re-issues the order every step.
     *
     * Nearest dock rather than a band, so there is no dead space between
     * berths: every point on the panel means something.
     *
     * @param {number} clientX Viewport X from a pointer event.
     * @returns {{side: number, dock: number}}
     */
    orderAt(clientX) {
      const col = lcd.columnAt(clientX);
      const side = col < half(GRID_WIDTH) ? 0 : 1;
      const centres = DOCK_CENTRE[side];
      let best = 0;
      for (let dock = 1; dock < centres.length; dock++) {
        if (Math.abs(centres[dock] - col) < Math.abs(centres[best] - col)) best = dock;
      }
      return { side, dock: best };
    },

    /**
     * @param {object} state Live game state. Read only.
     * @param {{badge?: string|null}} [view]
     */
    draw(state, view = {}) {
      lcd.clear();

      drawGhostBoard();
      drawShip(state);
      drawWater(state);
      drawShore();
      drawReadout(state);

      const ink = lcd.colors.ink;
      const ghost = lcd.colors.ghost;

      // Who is still on deck. Drawn from the crowd's own count rather than
      // from a list of figures: the manifest is a number in the simulation,
      // and the panel is the place it becomes ninety-two people.
      for (let side = 0; side < SIDES; side++) {
        const waiting = state.boats[side].waiting;
        const gone = CROWD_PER_SIDE - waiting;
        for (let slot = gone; slot < CROWD_PER_SIDE; slot++) crowdAt(side, slot, ink);
      }

      for (const shark of state.sharks) {
        // On the left, a rising dock index runs inboard, so dir +1 is a shark
        // swimming to the right; on the right it is reflected.
        const facingLeft = shark.side === 0 ? shark.dir < 0 : shark.dir > 0;
        sharkAt(shark.side, shark.pos, facingLeft, ink);
      }

      for (let side = 0; side < SIDES; side++) {
        const boat = state.boats[side];
        boatAt(side, boat.dock, boat.aboard, ink, ghost);
      }

      for (const j of state.jumpers) {
        if (j.stop < ARC_STOPS) jumperAt(j.side, j.lane, j.stop, ink);
      }

      for (const splash of state.splashes) {
        splashAt(splash.side, splash.lane, splashFrame(splash), ink);
      }

      if (view.badge) {
        lcd.fillArea(0, GRID_HEIGHT - 12, GRID_WIDTH, 12, lcd.colors.ground);
        lcd.drawText(view.badge, GRID_WIDTH / 2, GRID_HEIGHT - 12, {
          align: 'center',
          scale: 10,
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
