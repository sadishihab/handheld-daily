/**
 * Seven-segment digits drawn on the LCD cell grid.
 *
 * Each digit is 3 cells wide and 5 tall. Unlit segments are drawn faintly
 * rather than omitted, which is what makes a real LCD readable as a device
 * rather than as text: you can always see the shape of the digit that is not
 * currently displayed.
 */

/** Cell offsets for each of the seven segments, within a 3x5 digit. */
const SEGMENTS = {
  a: [[0, 0], [1, 0], [2, 0]],
  f: [[0, 1]],
  b: [[2, 1]],
  g: [[0, 2], [1, 2], [2, 2]],
  e: [[0, 3]],
  c: [[2, 3]],
  d: [[0, 4], [1, 4], [2, 4]],
};

const ALL_SEGMENTS = 'abcdefg';

const DIGIT_SEGMENTS = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

export const DIGIT_WIDTH = 3;
export const DIGIT_HEIGHT = 5;
/** A digit plus the gap before the next one. */
export const DIGIT_ADVANCE = 4;
/** The colon is one cell wide plus a gap. */
export const COLON_ADVANCE = 2;

/**
 * Draw one digit.
 *
 * @param {object} lcd LCD surface.
 * @param {string} char A single character; anything but 0-9 draws blank.
 * @param {number} col Left cell.
 * @param {number} row Top cell.
 * @param {{on: string, off: string|null}} style
 */
export function drawDigit(lcd, char, col, row, { on, off }) {
  const lit = DIGIT_SEGMENTS[char] || '';

  for (const name of ALL_SEGMENTS) {
    const isLit = lit.includes(name);
    if (!isLit && !off) continue;
    const style = isLit ? on : off;
    for (const [dx, dy] of SEGMENTS[name]) {
      lcd.fillArea(col + dx, row + dy, 1, 1, style);
    }
  }
}

/** Draw the two dots of a colon, at the same height as the digit segments. */
export function drawColon(lcd, col, row, style) {
  if (!style) return;
  lcd.fillArea(col, row + 1, 1, 1, style);
  lcd.fillArea(col, row + 3, 1, 1, style);
}

/** Total cell width of a string rendered as seven-segment digits. */
export function measure(text) {
  let width = 0;
  for (const char of text) width += char === ':' ? COLON_ADVANCE : DIGIT_ADVANCE;
  return width > 0 ? width - 1 : 0;
}

/**
 * Draw a run of digits (and colons).
 *
 * @param {{on: string, off: string|null, colonOn?: boolean}} style `off`
 *   paints the unlit segments; pass null to omit them.
 */
export function drawDigits(lcd, text, col, row, style) {
  let x = col;
  for (const char of text) {
    if (char === ':') {
      drawColon(lcd, x, row, style.colonOn === false ? style.off : style.on);
      x += COLON_ADVANCE;
    } else {
      drawDigit(lcd, char, x, row, style);
      x += DIGIT_ADVANCE;
    }
  }
}
