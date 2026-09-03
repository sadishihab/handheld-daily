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
  BUOY,
  ISLAND,
  CLOUD_SMALL,
  CLOUD_LARGE,
} from './sprites.js';
import {
  DOCKS,
  LANE_DOCK,
  LANES,
  ARC_STOPS,
  CROWD,
  CAPACITY,
  MAX_MISSES,
  RUN_STEPS,
  SHARK_DOCKS,
  splashFrame,
} from '../games/rescue.js';

/* -- Panel layout ------------------------------------------------------- */

/**
 * A 252-cell grid.
 *
 * The panel is width-limited on a phone, so the grid width alone decides how
 * much detail any figure can carry. 168x6 and 252x4 are both 1008, so on a 3x
 * phone the panel comes out the same physical width either way: the boat is
 * the same size in millimetres and is simply cut into more cells. The cost is
 * grain, and on a 2x screen the integer-cell rule bites harder, since 252
 * divides the available pixels less kindly than 168 did. grid-test.html
 * renders both and prints the numbers, which is how that trade was checked on
 * real glass rather than argued about.
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
 * The BOARD is no longer symmetrical -- there is one shore, at the near end.
 * The SHIP still is: it lies across the top of the panel with the fire
 * amidships, and its two ends are drawn once and reflected so they cannot
 * drift apart as the art is edited. Nothing below the waterline uses this.
 */
const mirrorCol = (col, width) => GRID_WIDTH - width - col;

/* --- the readout band -------------------------------------------------- */

const EDGE_COL = 6;
const READOUT_ROW = 3;
const DIGIT_UNIT = 4;
const DIGIT_LEN = 9;
/** Four digits: a good run lands near 700 and the best measured ones pass
 *  900, where three digits would have no headroom left. */
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
 * Two deck rows, two halves of the ship, 23 columns in each: 92 places, which
 * is exactly CROWD. The deck is not a decoration sized to taste, it is the
 * manifest drawn out.
 */
const CROWD_ROWS = CROWD_ROW.length;
const CROWD_HALVES = 2;
const CROWD_COLUMNS = CROWD / (CROWD_ROWS * CROWD_HALVES);
const CROWD_PITCH = 5;
const CROWD_LEFT = 8;

/* --- the water --------------------------------------------------------- */

/**
 * Docks, laid out from the shore seaward.
 *
 * Dock 0 is the shore, at the near end of the panel; dock 4 is the far water
 * under the ship's stern. Five moorings across a 252-cell panel is a 46-cell
 * pitch against a 33-cell hull, so there are thirteen clear cells of water
 * between neighbouring berths. The old two-boat board had to fit twelve
 * moorings into the same width at a 21-cell pitch; this is what that cost,
 * paid back.
 */
const DOCK_PITCH = 46;
const SHORE_CENTRE = 34;
const DOCK_CENTRE = Array.from({ length: DOCKS }, (_, dock) => SHORE_CENTRE + dock * DOCK_PITCH);

/** The centre line of each jump lane: the dock it comes down over. */
const LANE_CENTRE = LANE_DOCK.map((dock) => DOCK_CENTRE[dock]);

const SLOT_ROW = 242;
const HULL_ROW = 249;
/** Five-cell figures at a seven-cell pitch: two clear columns between each. */
const SLOT_PITCH = PASSENGER_W + 2;
const SLOT_INSET = Math.floor((HULL_W - (CAPACITY * SLOT_PITCH - 1)) / 2);

const WATERLINE_ROW = 256;
const SPLASH_ROW = 259;
const SHARK_ROW = 276;

/* --- the jump arc ------------------------------------------------------ */

/** Top row of a jumper sprite at each stop. */
const STOP_ROW = [166, 182, 198, 213, 228, 243];

/**
 * How far shorewards of the landing column each stop sits.
 *
 * A long arc, and deliberately so. Two lanes is what makes the ferry cost
 * anything (see LANE_DOCK in games/rescue.js) and the price of two lanes is
 * that only two columns of the panel would ever have anyone falling down
 * them. Swinging the jump out by most of a dock pitch means the pair of arcs
 * sweeps a wide band on the way down -- the jumper leaves the rail near the
 * fire amidships and is carried seaward as they fall.
 *
 * The last two entries are zero because those are the stops a catch can
 * resolve on: the jumper has to be over the boat's own column by then, or the
 * segment the player is reading is not the segment the rules are using.
 */
const ARC_OFFSET = [38, 31, 22, 11, 0, 0];

/** Which pose a jumper is in at a given stop. */
const jumperPose = (stop) => (stop < 3 ? JUMPER_SPREAD : JUMPER_TUCK);

/* --- the shore --------------------------------------------------------- */

const PALM_COL = 1;
const PALM_ROW = 190;
const BOATHOUSE_COL = 22;
const BOATHOUSE_ROW = 200;
const JETTY_COL = 4;
const JETTY_ROW = 258;
const BEACH_ROW = JETTY_ROW + patternSize(JETTY).height;
const BEACH_W = 45;
/** The headland outboard of the shore dock. */
const CLIFF_W = 12;
const CLIFF_ROW = 200;

/** The channel marker at the seaward end, past the far dock. */
const BUOY_COL = 240;
const BUOY_ROW = 246;

/**
 * An island out in the near water, and the band of it that gets waves.
 *
 * The lanes are bunched at the far end of the board, so everything between
 * the landing and the nearest lane is water the boat crosses and nothing ever
 * happens on. Left bare it read as a quarter of the panel nobody had drawn
 * on. NEAR_WATER_RIGHT stops short of the arcs: a wave lighting the same
 * cells as a falling figure is exactly the confusion the ghost board exists
 * to prevent.
 */
const ISLAND_COL = 58;
const ISLAND_ROW = 206;
const NEAR_WATER_TOP = 172;
const NEAR_WATER_BOTTOM = 236;
const NEAR_WATER_RIGHT = 126;

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
  DOCK_PITCH,
  mirrorCol,

  /** Left cell of a jumper sprite at (lane, stop). */
  jumperCol(lane, stop) {
    return LANE_CENTRE[lane] - ARC_OFFSET[stop] - half(JUMPER_W);
  },
  /** Left cell of the hull at `dock`. */
  hullCol(dock) {
    return DOCK_CENTRE[dock] - half(HULL_W);
  },
  /** Left cell of a splash in `lane`. */
  splashCol(lane) {
    return LANE_CENTRE[lane] - half(SPLASH_W);
  },
  /** Left cell of a shark at `dock`. */
  sharkCol(dock) {
    return DOCK_CENTRE[dock] - half(SHARK_W);
  },
  /**
   * Where waiting passenger `slot` stands.
   *
   * Slots alternate between the two halves of the ship and count inward
   * first, so the crowd empties from the fire amidships outward and stays
   * even across the deck as it thins.
   */
  crowdSlot(slot) {
    const shipHalf = slot % CROWD_HALVES;
    const index = Math.floor(slot / CROWD_HALVES);
    const column = CROWD_COLUMNS - 1 - Math.floor(index / CROWD_ROWS);
    const left = CROWD_LEFT + column * CROWD_PITCH;
    return {
      col: shipHalf === 0 ? left : mirrorCol(left, DECK_PASSENGER_W),
      row: CROWD_ROW[index % CROWD_ROWS],
    };
  },
};

export function createRescueRenderer(canvas) {
  const lcd = createLcdSurface(canvas, { gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT });
  const paint = (pattern, col, row, style) => drawPattern(lcd, pattern, col, row, style);
  /** Paint a ship sprite on the left, or its reflection on the right. */
  const paintShipSide = (shipHalf, pattern, col, row, style) => {
    const art = shipHalf === 0 ? pattern : flip(pattern);
    const at = shipHalf === 0 ? col : mirrorCol(col, patternSize(pattern).width);
    paint(art, at, row, style);
  };

  /* -- entity segments -------------------------------------------------- */

  function jumperAt(lane, stop, style) {
    paint(jumperPose(stop), LAYOUT.jumperCol(lane, stop), STOP_ROW[stop], style);
  }

  function splashAt(lane, frame, style) {
    paint(SPLASH_FRAMES[frame], LAYOUT.splashCol(lane), SPLASH_ROW, style);
  }

  /**
   * A shark, facing the way it is swimming.
   *
   * The ghost board draws both facings at every dock, overlapping. That is
   * not a compromise: a real panel has a separate segment for each pose and
   * all of them sit visible in the glass at once, so a doubled shark ghost is
   * exactly what the display it is imitating would show.
   */
  function sharkAt(dock, facingShore, style) {
    const art = facingShore ? SHARK : flip(SHARK);
    paint(art, LAYOUT.sharkCol(dock), SHARK_ROW, style);
  }

  /** The boat, with `aboard` of its four slots occupied. */
  function boatAt(dock, aboard, style, slotStyle) {
    const left = LAYOUT.hullCol(dock);
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

  function crowdAt(slot, style) {
    const { col, row } = LAYOUT.crowdSlot(slot);
    paint(DECK_PASSENGER, col, row, style);
  }

  /**
   * Every position the board can hold, drawn faintly.
   *
   * An unlit LCD segment is still visible in the glass, and seeing the empty
   * board is what lets a player plan a dock ahead. It is also what makes the
   * panel read as populated when very little is happening: ninety-two deck
   * positions, five moorings with four seats each and twelve places in the
   * air are all faintly there whether or not anyone is in them.
   */
  function drawGhostBoard() {
    const ghost = lcd.colors.ghost;
    for (let slot = 0; slot < CROWD; slot++) crowdAt(slot, ghost);
    for (let lane = 0; lane < LANES; lane++) {
      for (let stop = 0; stop < ARC_STOPS; stop++) jumperAt(lane, stop, ghost);
      for (let frame = 0; frame < SPLASH_FRAMES.length; frame++) splashAt(lane, frame, ghost);
    }
    for (const dock of SHARK_DOCKS) {
      sharkAt(dock, true, ghost);
      sharkAt(dock, false, ghost);
    }
    for (let dock = 0; dock < DOCKS; dock++) boatAt(dock, 0, ghost, ghost);
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

    // Superstructure, mirrored so the ship reads the same from either end.
    for (let shipHalf = 0; shipHalf < 2; shipHalf++) {
      paintShipSide(shipHalf, BRIDGE, 24, SUPER_ROW, ink);
      paintShipSide(shipHalf, FUNNEL, 84, SUPER_ROW + 1, ink);
      paintShipSide(shipHalf, COWL, 66, SUPER_ROW + 10, ink);
      paintShipSide(shipHalf, LIFEBOAT, 102, SUPER_ROW + 13, ink);
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

  /**
   * The landing: headland, palm, boathouse, jetty, sand -- all at the near
   * end, and all of it above or below the band the boat works in.
   *
   * There is one of these now where there used to be two, and that asymmetry
   * is the game: the water runs out one way and there is land the other.
   */
  function drawShore() {
    const ink = lcd.colors.ink;
    const dim = lcd.colors.dim;

    paint(PALM, PALM_COL, PALM_ROW, ink);
    paint(BOATHOUSE, BOATHOUSE_COL, BOATHOUSE_ROW, ink);
    paint(JETTY, JETTY_COL, JETTY_ROW, ink);

    // The headland itself, and the sand the jetty stands on. Both are kept
    // clear of every cell a boat, a shark or a splash can use.
    lcd.fillArea(0, CLIFF_ROW, CLIFF_W, GRID_HEIGHT - CLIFF_ROW, ink);
    lcd.fillArea(0, BEACH_ROW, BEACH_W, 3, ink);
    for (let row = BEACH_ROW + 5; row < GRID_HEIGHT; row += 6) {
      lcd.fillArea(0, row, BEACH_W - 6, 2, dim);
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
    for (let row = WATERLINE_ROW + 4; row < GRID_HEIGHT; row += 8) {
      if (reservedRow(row) || reservedRow(row + 1)) continue;
      for (let col = BEACH_W + ((phase + half(row)) % 16); col < GRID_WIDTH; col += 16) {
        lcd.fillArea(col, row, 8, 2, row % 16 === 0 ? lcd.colors.ink : lcd.colors.dim);
      }
    }
    lcd.fillArea(BEACH_W, WATERLINE_ROW, GRID_WIDTH - BEACH_W, 2, lcd.colors.ink);

    // The near water, between the landing and the nearest lane. Faint, and
    // kept well clear of the columns the arcs sweep.
    for (let row = NEAR_WATER_TOP; row < NEAR_WATER_BOTTOM; row += 10) {
      for (let col = BEACH_W + ((phase * 8 + row) % 18); col < NEAR_WATER_RIGHT; col += 18) {
        lcd.fillArea(col, row, 9, 2, lcd.colors.dim);
      }
    }
    // Solid, not faint: it is an object out there, not more texture.
    paint(ISLAND, ISLAND_COL, ISLAND_ROW, lcd.colors.ink);

    // The channel marker, past the far dock: the seaward end of the water,
    // and the only thing out there that is not weather.
    paint(BUOY, BUOY_COL, BUOY_ROW, lcd.colors.ink);
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
     * Turn a touch into an order: the dock to send the boat to.
     *
     * This is the whole control scheme in one function. The column you touch
     * picks the dock, so a tap is a complete instruction rather than the
     * start of a hold, and the boat runs the errand after you lift. Holding
     * and sliding still works, because a held pointer re-issues the order
     * every step.
     *
     * Nearest dock rather than a band, so there is no dead space between
     * berths: every point on the panel means something.
     *
     * @param {number} clientX Viewport X from a pointer event.
     * @returns {number} Dock index.
     */
    orderAt(clientX) {
      const col = lcd.columnAt(clientX);
      let best = 0;
      for (let dock = 1; dock < DOCK_CENTRE.length; dock++) {
        if (Math.abs(DOCK_CENTRE[dock] - col) < Math.abs(DOCK_CENTRE[best] - col)) best = dock;
      }
      return best;
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
      for (let slot = CROWD - state.waiting; slot < CROWD; slot++) crowdAt(slot, ink);

      // A rising dock index runs seaward, so dir -1 is a shark swimming
      // toward the shore.
      for (const shark of state.sharks) sharkAt(shark.pos, shark.dir < 0, ink);

      boatAt(state.boat.dock, state.boat.aboard, ink, ghost);

      for (const j of state.jumpers) {
        if (j.stop < ARC_STOPS) jumperAt(j.lane, j.stop, ink);
      }

      for (const splash of state.splashes) {
        splashAt(splash.lane, splashFrame(splash), ink);
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
