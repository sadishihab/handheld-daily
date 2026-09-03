/**
 * Sprite patterns for the LCD panel.
 *
 * Art is authored as text so it can be read and edited as a picture. Each
 * row is a string; '#' lights a cell and anything else leaves it clear.
 * drawPattern merges horizontal runs into single fills, so a figure costs a
 * handful of rectangles rather than one per cell.
 *
 * Everything here is drawn for the 252-cell grid. The panel used to be 168
 * cells across, which capped a passenger standing in a boat at two cells
 * wide -- four of them read as one bar, and the boat was the thing the player
 * spends the whole run looking at. The finer grid buys the room back; see
 * GRID_WIDTH in render/rescue.js.
 *
 * The figures in the boat then grew again when the board went from two boats
 * of six positions to one boat of five. Twelve moorings had to share the
 * panel; five do not, so the hull went from 17 cells to 33 and the person
 * standing in it from 3 by 5 to 5 by 7. That is the whole reason the dock
 * count fell -- see DOCKS in games/rescue.js.
 */

/**
 * @param {object} lcd LCD surface with fillArea(col, row, w, h, style).
 * @param {string[]} pattern Rows of '#' and '.'.
 * @param {number} col Left cell of the sprite.
 * @param {number} row Top cell of the sprite.
 * @param {string} style Fill style.
 */
export function drawPattern(lcd, pattern, col, row, style) {
  for (let y = 0; y < pattern.length; y++) {
    const line = pattern[y];
    let runStart = -1;
    for (let x = 0; x <= line.length; x++) {
      const lit = line[x] === '#';
      if (lit && runStart === -1) runStart = x;
      else if (!lit && runStart !== -1) {
        lcd.fillArea(col + runStart, row + y, x - runStart, 1, style);
        runStart = -1;
      }
    }
  }
}

/** Width and height of a pattern, in cells. */
export function patternSize(pattern) {
  return { width: Math.max(...pattern.map((r) => r.length)), height: pattern.length };
}

/**
 * Mirror a pattern left-to-right.
 *
 * The ship is symmetrical about the fire amidships, so every sprite that
 * faces a direction is authored once facing left and flipped for the other
 * end. Doing it here rather than by hand keeps the two halves from drifting
 * apart as the art is edited. Sharks use it too, to face the way they swim.
 */
export function flip(pattern) {
  const width = patternSize(pattern).width;
  return pattern.map((row) => row.padEnd(width, '.').split('').reverse().join(''));
}

/* -- passengers --------------------------------------------------------- */

/**
 * One passenger standing in a boat. 5 wide, 7 tall.
 *
 * Head, shoulders with the arms thrown out, waist, hips and two legs. At a
 * 7-cell slot pitch, four of them stand in the hull with two clear columns
 * between each, so a boat carrying three is countable at a glance rather than
 * inferred from how wide the dark patch is. This is the figure the player
 * looks at for the whole run and it has now been given the room to be a
 * person.
 */
export const PASSENGER = [
  '.###.',
  '.###.',
  '#####',
  '..#..',
  '.###.',
  '.#.#.',
  '.#.#.',
];

/**
 * One passenger still on the ship. 3 wide, 4 tall.
 *
 * A cell shorter than the one in the boat, so a packed deck reads as a crowd
 * seen further off rather than as the same figure twice. Ninety-two of these
 * stand on the decks at the start of a run and go out one at a time.
 */
export const DECK_PASSENGER = [
  '.#.',
  '###',
  '.#.',
  '#.#',
];

/* -- the boat ----------------------------------------------------------- */

/**
 * The hull, without passengers. 33 wide, 7 tall; sits under the slot row.
 *
 * Thirty-three is what four 5-cell figures need at a 7-cell pitch, plus three
 * cells of gunwale at each end for the bow and stern to taper into. At a
 * 46-cell dock pitch that still leaves thirteen clear cells of water between
 * neighbouring moorings, so the ghost row reads as five separate berths and
 * not as a bar.
 */
export const HULL = [
  '#################################',
  '#..###########################..#',
  '#################################',
  '.###############################.',
  '..#############################..',
  '....#########################....',
  '........#################........',
];

/* -- jumpers ------------------------------------------------------------ */

/**
 * A passenger in the air, arms up, just off the rail. 7 wide, 10 tall.
 *
 * Two poses rather than one: a figure held in the same shape for six stops
 * reads as a lift descending, not a person falling. The pose changes halfway
 * down the arc, which is enough to sell the drop without animating anything.
 */
export const JUMPER_SPREAD = [
  '...#...',
  '..###..',
  '..###..',
  '#.....#',
  '.#####.',
  '...#...',
  '...#...',
  '..#.#..',
  '.#...#.',
  '#.....#',
];

/** The same passenger, tucked and dropping fast. 7 wide, 10 tall. */
export const JUMPER_TUCK = [
  '...#...',
  '..###..',
  '..###..',
  '.#####.',
  '#.###.#',
  '..###..',
  '..###..',
  '..#.#..',
  '..#.#..',
  '.##.##.',
];

/* -- the flail and splash ----------------------------------------------- */

/**
 * Someone going into the water, in five frames. 15 wide, 12 tall.
 *
 * A miss used to be a state change -- a figure stopped existing and a lamp
 * lit. That reads as a scoring event, not as a person hitting the water, and
 * the run's four misses are the most important thing that can happen in it.
 *
 * So: they flail, they go under, the water throws up a crown, it collapses,
 * and rings spread. Five frames over 35 steps, which is just under six tenths
 * of a second -- long enough to see from across a room, short enough that it
 * is gone before the next jumper needs the space.
 */
export const SPLASH_FLAIL = [
  '...............',
  '.#...........#.',
  '..#....#....#..',
  '...#..###..#...',
  '....#.###.#....',
  '.....#.#.#.....',
  '......###......',
  '.....#####.....',
  '....#######....',
  '...#########...',
  '..###########..',
  '...............',
];

export const SPLASH_UNDER = [
  '...............',
  '..#.........#..',
  '...#...#...#...',
  '....#.###.#....',
  '.....#.#.#.....',
  '......#.#......',
  '.....#####.....',
  '....#######....',
  '...#########...',
  '..###########..',
  '.#############.',
  '...............',
];

export const SPLASH_CROWN = [
  '#.....#.#.....#',
  '.#....#.#....#.',
  '..#...#.#...#..',
  '..#..#...#..#..',
  '...#.#...#.#...',
  '...#.#...#.#...',
  '....##...##....',
  '....#######....',
  '...#########...',
  '..###########..',
  '.#############.',
  '###############',
];

export const SPLASH_FALL = [
  '...............',
  '#.............#',
  '.#....#.#....#.',
  '..#...#.#...#..',
  '...#.......#...',
  '...............',
  '....#.....#....',
  '...###...###...',
  '..#########....',
  '.#############.',
  '###############',
  '...............',
];

export const SPLASH_RINGS = [
  '...............',
  '...............',
  '...............',
  '...............',
  '...............',
  '...............',
  '...............',
  '..###.....###..',
  '.#...#####...#.',
  '#.............#',
  '...............',
  '...............',
];

/** The five frames, in order. Index with splashFrame() from the game. */
export const SPLASH_FRAMES = [
  SPLASH_FLAIL,
  SPLASH_UNDER,
  SPLASH_CROWN,
  SPLASH_FALL,
  SPLASH_RINGS,
];

/* -- the water ---------------------------------------------------------- */

/**
 * A shark, facing left. 17 wide, 9 tall.
 *
 * Authored facing left and flipped for the right-hand half of the board, so a
 * shark always swims into the panel rather than off it.
 *
 * Seventeen wide, the same as the hull, and for the same reason: the ghost
 * board draws a shark at every dock it can reach in both facings, and at 23
 * cells those ghosts overlapped their neighbours and the whole shark row read
 * as one continuous bar instead of separate fish. The dock pitch is what caps
 * it -- no sprite that lives on a dock may be wider than the boat.
 */
export const SHARK = [
  '.......###.......',
  '......#####......',
  '.....#######.....',
  '....#########....',
  '..##############.',
  '#################',
  '.################',
  '#..##############',
  '.....##########..',
];

/* -- the ship ----------------------------------------------------------- */

/**
 * The bridge, above the upper deck. 34 wide, 22 tall.
 *
 * Windows are holes rather than marks: at this grain a lit rectangle with
 * gaps in it reads as glass, where drawn-on mullions read as noise.
 */
export const BRIDGE = [
  '..............####................',
  '..............#..#................',
  '..............#..#................',
  '.......###########################',
  '.......###########################',
  '.......##.#..#..#..#..#..#..#..###',
  '.......##.#..#..#..#..#..#..#..###',
  '.......##.#..#..#..#..#..#..#..###',
  '.......###########################',
  '...###############################',
  '...###############################',
  '...##.#..#..#..#..#..#..#..#..#..#',
  '...##.#..#..#..#..#..#..#..#..#..#',
  '...###############################',
  '##################################',
  '##################################',
  '##.#..#..#..#..#..#..#..#..#..#..#',
  '##.#..#..#..#..#..#..#..#..#..#..#',
  '##.#..#..#..#..#..#..#..#..#..#..#',
  '##################################',
  '##################################',
  '..................................',
];

/** A funnel, raked back. 15 wide, 20 tall. */
export const FUNNEL = [
  '.....########..',
  '....##########.',
  '....##########.',
  '....##.....###.',
  '....##.....###.',
  '...###.....###.',
  '...###.....###.',
  '...###.....###.',
  '..####.....###.',
  '..####.....###.',
  '..####.....###.',
  '.#####.....###.',
  '.#####.....###.',
  '.#####.....###.',
  '#######....###.',
  '##############.',
  '##############.',
  '##############.',
  '###############',
  '###############',
];

/** A ventilator cowl on the deck. 9 wide, 12 tall. */
export const COWL = [
  '..#####..',
  '.#######.',
  '##.....##',
  '##.....##',
  '.##...##.',
  '..#####..',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
  '..#####..',
  '#########',
];

/** A lifeboat swung out on its davits. 16 wide, 9 tall. */
export const LIFEBOAT = [
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
  '################',
  '.##############.',
  '..############..',
  '....########....',
];

/**
 * Flame, in two frames. 21 wide, 26 tall.
 *
 * The ship is broken amidships and burning through the break, which is the
 * one piece of the picture that is allowed to move. Two frames swapped on a
 * simulated-step counter, never a wall clock: a replay of a seed has to show
 * identical fire. Hard cut between them, no fade -- an LCD segment is on or
 * it is off.
 */
export const FLAME_A = [
  '..........#..........',
  '.........###.........',
  '........##.##........',
  '.......##...##.......',
  '......##..#..##......',
  '.....##..###..##.....',
  '....##..##.##..##....',
  '...##..##...##..##...',
  '..##..##.....##..##..',
  '..#..##...#...##..#..',
  '.....#...###...#.....',
  '........##.##........',
  '.......##...##.......',
  '......##..#..##......',
  '.....##..###..##.....',
  '....##..#####..##....',
  '...##..#######..##...',
  '..##..#########..##..',
  '..#..###########..#..',
  '....#############....',
  '...###############...',
  '..#################..',
  '.###################.',
  '#####################',
  '.###################.',
  '..#################..',
];

export const FLAME_B = [
  '.........#...........',
  '........###..........',
  '.......##.##.........',
  '......##...##........',
  '.....##..#..##.......',
  '....##..###..##......',
  '...##..##.##..##.....',
  '..##..##...##..##....',
  '.##..##.....##..##...',
  '.#..##...#...##..#...',
  '....#...###...#......',
  '.......##.##.........',
  '......##...##........',
  '.....##..#..##.......',
  '....##..###..##......',
  '...##..#####..##.....',
  '..##..#######..##....',
  '.##..#########..##...',
  '.#..###########..#...',
  '...#############.....',
  '..###############....',
  '.#################...',
  '###################..',
  '####################.',
  '.###################.',
  '..#################..',
];

export const FLAME_FRAMES = [FLAME_A, FLAME_B];

/** Smoke, as billows of increasing size. */
export const SMOKE_SMALL = ['.###.', '#####', '#####', '.###.'];
export const SMOKE_MEDIUM = [
  '..#####..',
  '.#######.',
  '#########',
  '#########',
  '.#######.',
];
export const SMOKE_LARGE = [
  '...######...',
  '.##########.',
  '############',
  '############',
  '############',
  '.##########.',
  '...######...',
];

/* -- the shore ---------------------------------------------------------- */

/**
 * The jetty the boat unloads onto. 34 wide, 14 tall.
 *
 * Drawn below the waterline and outside the water a shark can reach, so it
 * can be as solid as it likes without ever standing where an entity does.
 * There is only one of these on the board now, and it is the whole reason the
 * run home exists, so it is wide enough to read as a destination.
 */
export const JETTY = [
  '##################################',
  '##################################',
  '##################################',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
  '#..#....#..#....#..#....#..#....#.',
];

/**
 * A channel marker at the seaward end of the water. 9 wide, 17 tall.
 *
 * The board is no longer symmetrical -- land at one end, open sea at the
 * other -- and the open end needed something for the eye to stop on that is
 * not a place anything can happen. A buoy is the honest object: it marks the
 * edge of the water the boat works, and it never moves.
 */
export const BUOY = [
  '....#....',
  '...###...',
  '....#....',
  '....#....',
  '..#####..',
  '.#######.',
  '#########',
  '#..###..#',
  '#.#####.#',
  '#########',
  '.#######.',
  '.#.###.#.',
  '.#######.',
  '..#####..',
  '..#####..',
  '...###...',
  '...###...',
];

/** A boathouse above the landing, marking it as the destination. 18x18. */
export const BOATHOUSE = [
  '........##........',
  '.......####.......',
  '......######......',
  '.....########.....',
  '....##########....',
  '...############...',
  '..##############..',
  '.################.',
  '##################',
  '##################',
  '##..............##',
  '##..####..####..##',
  '##..####..####..##',
  '##..####..####..##',
  '##..............##',
  '##....######....##',
  '##....######....##',
  '##....######....##',
];

/** A palm on the headland. 19 wide, 24 tall. */
export const PALM = [
  '.....##.....##.....',
  '...####...####.....',
  '..###..###..####...',
  '.###...####...###..',
  '##....######....##.',
  '#....########....##',
  '.....###..###......',
  '......##..##.......',
  '.......####........',
  '.......####........',
  '........###........',
  '.......####........',
  '.......###.........',
  '.......####........',
  '........###........',
  '.......####........',
  '.......###.........',
  '.......####........',
  '........###........',
  '.......####........',
  '.......###.........',
  '......#####........',
  '.....######........',
  '....########.......',
];

/**
 * A low island out in the near water, with a single palm. 30 wide, 13 tall.
 *
 * Scenery, not a landing: the boat passes it on the way home. It exists
 * because the two jump lanes are bunched at the far end of the water, which
 * leaves the stretch between them and the shore with nothing on it -- and a
 * quarter of the panel drawn on by nobody reads as a fault rather than as
 * distance.
 */
export const ISLAND = [
  '...........####...............',
  '........###....###............',
  '.......##...##...##...........',
  '............##................',
  '............##................',
  '...........###................',
  '..........####................',
  '......###########.............',
  '...####################.......',
  '.#########################....',
  '###########################...',
  '##############################',
  '..............................',
];

/** A drifting cloud, in the same idiom as the smoke. */
export const CLOUD_SMALL = ['..#####..', '.#######.', '#########', '#########'];
export const CLOUD_LARGE = [
  '.....######.....',
  '...##########...',
  '.##############.',
  '################',
  '################',
];
