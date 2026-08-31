/**
 * LCD surface -- a coarse dot-matrix panel drawn on a canvas.
 *
 * Shared by every minigame's renderer. It owns canvas sizing, device-pixel
 * scaling and the cell grid; it knows nothing about any particular game.
 *
 * Everything lands on integer pixel boundaries and every cell is the same
 * integer size, so the result reads as a physical LCD panel rather than
 * smoothly animated graphics. Nothing here is part of the simulation, so it
 * may use floats freely -- but it must never write to game state.
 */

/** Cap the backing store on very high-DPI phones; beyond 3x costs fill rate
 *  for pixels nobody can see, and this is a chunky grid to begin with. */
const MAX_PIXEL_RATIO = 3;

/** Fraction of a cell left as a gap, giving the dot-matrix look. */
const CELL_GAP_RATIO = 0.08;

function cssVar(element, name, fallback) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{gridWidth: number, gridHeight: number}} grid
 */
export function createLcdSurface(canvas, { gridWidth, gridHeight }) {
  const ctx = canvas.getContext('2d', { alpha: false });

  let cell = 1;
  let gap = 0;
  let originX = 0;
  let originY = 0;
  // Kept in sync with styles/main.css so the panel and the canvas cannot drift.
  let ink = '#7dff8a';
  let ground = '#0b1a0f';
  let ghost = 'rgba(125, 255, 138, 0.08)';
  let dim = 'rgba(125, 255, 138, 0.45)';

  /** Recompute geometry. Call on resize and orientation change. */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Integer cell size, so no cell is ever a fraction of a pixel wider than
    // its neighbour -- that is what makes the grid look machined.
    cell = Math.max(1, Math.floor(Math.min(width / gridWidth, height / gridHeight)));
    gap = Math.floor(cell * CELL_GAP_RATIO);
    originX = Math.floor((width - cell * gridWidth) / 2);
    originY = Math.floor((height - cell * gridHeight) / 2);

    ink = cssVar(canvas, '--lcd-on', ink);
    ground = cssVar(canvas, '--lcd-bg', ground);
    ghost = cssVar(canvas, '--lcd-ghost', ghost);
    dim = cssVar(canvas, '--lcd-dim', dim);
  }

  function clear() {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** Light one cell. Out-of-bounds cells are dropped, so sprites can hang
   *  off the edge of the playfield without the caller clipping them. */
  function fillCell(col, row, style = ink) {
    if (col < 0 || col >= gridWidth || row < 0 || row >= gridHeight) return;
    ctx.fillStyle = style;
    ctx.fillRect(originX + col * cell + gap, originY + row * cell + gap, cell - gap * 2, cell - gap * 2);
  }

  /** Light a horizontal run of cells. */
  function fillRow(col, row, length, style = ink) {
    for (let i = 0; i < length; i++) fillCell(col + i, row, style);
  }

  /**
   * Draw text on the cell grid. Text is the one thing not snapped to cells --
   * a readout rendered as dot-matrix glyphs at this scale is unreadable.
   *
   * @param {'left'|'center'|'right'} align
   */
  function drawText(text, col, row, { align = 'left', scale = 2, style = ink } = {}) {
    ctx.fillStyle = style;
    ctx.font = `700 ${Math.floor(cell * scale)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = align === 'center' ? 'center' : align;
    ctx.textBaseline = 'top';
    ctx.fillText(text, originX + col * cell, originY + row * cell);
  }

  /** Paint a solid block of cells, ignoring the dot-matrix gap. Used to
   *  clear a strip so chrome drawn over it stays legible. */
  function fillArea(col, row, widthCells, heightCells, style) {
    ctx.fillStyle = style;
    ctx.fillRect(
      originX + col * cell,
      originY + row * cell,
      widthCells * cell,
      heightCells * cell
    );
  }

  /** Cover the whole panel -- used for the miss flash. */
  function flood(style) {
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return {
    resize,
    clear,
    fillCell,
    fillRow,
    fillArea,
    drawText,
    flood,
    get colors() {
      return { ink, ground, ghost, dim };
    },
  };
}
