/**
 * Seven-segment digits drawn on the LCD cell grid.
 *
 * Segments are rectangles sized from a thickness and a length, so the digits
 * scale with the panel rather than being locked to one cell size. Unlit
 * segments are drawn faintly instead of omitted, which is what makes a real
 * LCD read as a device: the shape of the digit you are not showing is always
 * faintly there.
 */

/** Which of the seven segments each digit lights. */
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

const ALL = 'abcdefg';

/**
 * Geometry of one digit.
 *
 * @param {number} unit Segment thickness, in cells.
 * @param {number} len Segment length, in cells.
 */
export function digitMetrics(unit, len) {
  return {
    width: len + unit * 2,
    height: len * 2 + unit * 3,
    /** Cell advance from one glyph to the next. */
    advance: len + unit * 3,
    colonWidth: unit,
    colonAdvance: unit * 3,
  };
}

/** Rectangles for each segment, as [x, y, w, h] in cells. */
function segmentRects(unit, len) {
  return {
    a: [unit, 0, len, unit],
    f: [0, unit, unit, len],
    b: [unit + len, unit, unit, len],
    g: [unit, unit + len, len, unit],
    e: [0, unit * 2 + len, unit, len],
    c: [unit + len, unit * 2 + len, unit, len],
    d: [unit, unit * 2 + len * 2, len, unit],
  };
}

/**
 * Draw a run of seven-segment glyphs. Digits and ':' are supported.
 *
 * @param {object} lcd LCD surface.
 * @param {string} text
 * @param {number} col Left cell.
 * @param {number} row Top cell.
 * @param {{on: string, off: string|null, unit: number, len: number, colonOn?: boolean}} style
 */
export function drawDigits(lcd, text, col, row, style) {
  const { on, off, unit, len, colonOn = true } = style;
  const metrics = digitMetrics(unit, len);
  const rects = segmentRects(unit, len);
  let x = col;

  for (const char of text) {
    if (char === ':') {
      const dotStyle = colonOn ? on : off;
      if (dotStyle) {
        lcd.fillArea(x, row + unit + Math.floor(len / 2), unit, unit, dotStyle);
        lcd.fillArea(x, row + unit * 2 + len + Math.floor(len / 2), unit, unit, dotStyle);
      }
      x += metrics.colonAdvance;
      continue;
    }

    const lit = DIGIT_SEGMENTS[char] || '';
    for (const name of ALL) {
      const isLit = lit.includes(name);
      const fill = isLit ? on : off;
      if (!fill) continue;
      const [rx, ry, rw, rh] = rects[name];
      lcd.fillArea(x + rx, row + ry, rw, rh, fill);
    }
    x += metrics.advance;
  }
}

/** Total cell width of a string rendered at this size. */
export function measure(text, unit, len) {
  const metrics = digitMetrics(unit, len);
  let width = 0;
  for (const char of text) {
    width += char === ':' ? metrics.colonAdvance : metrics.advance;
  }
  // Trim the trailing gap.
  return Math.max(0, width - (unit * 2));
}
