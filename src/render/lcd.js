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
const CELL_GAP_RATIO = 0;

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
  // Fallbacks only; the real values come from the stylesheet on resize().
  let ink = '#14170d';
  let ground = '#a9b77c';
  let ghost = 'rgba(20, 23, 13, 0.07)';
  let dim = 'rgba(20, 23, 13, 0.4)';

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

  /**
   * Which grid column a touch landed on.
   *
   * The panel is letterboxed inside the canvas, so a fraction of the canvas
   * width is not a fraction of the board -- a thumb on the outermost dock is
   * several cells off if you assume it is. Input has to ask the surface,
   * because the surface is the only thing that knows where the board was
   * actually drawn.
   *
   * Clamped to the board: a touch in the letterbox is the nearest edge
   * rather than nothing, so the far dock stays reachable at the very edge of
   * the glass where thumbs actually land.
   *
   * @param {number} clientX Viewport X, as reported by a pointer event.
   * @returns {number} Column in 0 .. gridWidth - 1.
   */
  function columnAt(clientX) {
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / (rect.width || 1);
    const col = Math.floor(((clientX - rect.left) * ratio - originX) / cell);
    return col < 0 ? 0 : col >= gridWidth ? gridWidth - 1 : col;
  }

  return {
    resize,
    clear,
    fillCell,
    fillRow,
    fillArea,
    drawText,
    flood,
    columnAt,
    get colors() {
      return { ink, ground, ghost, dim };
    },
  };
}
