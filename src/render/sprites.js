/**
 * Sprite patterns for the LCD panel.
 *
 * Art is authored as text so it can be read and edited as a picture. Each
 * row is a string; '#' lights a cell and anything else leaves it clear.
 * drawPattern merges horizontal runs into single fills, so a figure costs a
 * handful of rectangles rather than one per cell.
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
 * A parachutist: rounded canopy, shroud lines, and a figure with head, arms
 * and legs. 9 wide, 14 tall.
 */
export const PARACHUTIST = [
  '..#####..',
  '.#######.',
  '#########',
  '##.....##',
  '.#.....#.',
  '..#...#..',
  '...#.#...',
  '....#....',
  '...###...',
  '..#####..',
  '...###...',
  '...###...',
  '..##.##..',
  '..#...#..',
];

/**
 * One survivor standing on the deck. 2 wide, 4 tall.
 *
 * Narrow because the boat has to be narrow: ten dock positions have to tile
 * across the panel, which caps the hull at 13 cells, which caps four slots at
 * a 3-cell pitch. A 2-wide figure is what fits with a clear column between
 * neighbours -- at a 3-wide sprite the arms row runs into the next survivor
 * and four of them read as one bar.
 */
export const SURVIVOR = ['.#', '##', '.#', '##'];

/** The hull, without survivors. 13 wide, 5 tall, sits under the slot row. */
export const HULL = [
  '#############',
  '#############',
  '.###########.',
  '..#########..',
  '....#####....',
];

/** A shark: dorsal fin over a body with a tail. 17 wide, 7 tall. */
export const SHARK = [
  '.......##........',
  '......####.......',
  '.....######......',
  '#...##########...',
  '###############..',
  '#..############..',
  '.....########....',
];

/** Water thrown up where a parachutist went in. 9 wide, 5 tall. */
export const SPLASH = [
  '#..#...#.',
  '.#.#..#..',
  '..#####..',
  '.#######.',
  '#########',
];

/** The burning aircraft, nose down and trailing smoke. 24 wide, 13 tall. */
export const PLANE = [
  '.....................###',
  '....................####',
  '...................#####',
  '..................######',
  '.......###########.####.',
  '....####################',
  '..######################',
  '.#######################',
  '..######################',
  '....##########.#####....',
  '.......#####....####....',
  '..........##.....###....',
  '.................##.....',
];

/** Smoke, as stacked billows of increasing size. */
export const SMOKE_SMALL = ['.##.', '####', '.##.'];
export const SMOKE_MEDIUM = ['..####..', '.######.', '########', '.######.'];
export const SMOKE_LARGE = [
  '...######...',
  '.##########.',
  '############',
  '############',
  '.##########.',
  '...######...',
];

/** The jetty the boat unloads onto. 28 wide, 6 tall. */
export const JETTY = [
  '############################',
  '############################',
  '#..#....#..#....#..#....#..#',
  '#..#....#..#....#..#....#..#',
  '#..#....#..#....#..#....#..#',
  '#..#....#..#....#..#....#..#',
];

/** A hut above the jetty, marking the landing as the destination. */
export const HUT = [
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.##########.',
  '############',
  '##........##',
  '##..####..##',
  '##..####..##',
  '##..####..##',
];

/** A palm tree on the shore. 13 wide, 16 tall. */
export const PALM = [
  '...##...##...',
  '.###.###.###.',
  '##...###...##',
  '#...#####...#',
  '.....###.....',
  '.....###.....',
  '......##.....',
  '.....###.....',
  '.....##......',
  '.....###.....',
  '......##.....',
  '.....###.....',
  '.....##......',
  '.....###.....',
  '......##.....',
  '.....####....',
];
