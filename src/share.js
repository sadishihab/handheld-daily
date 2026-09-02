/**
 * Share card -- plain text, no URL.
 *
 * Formatting is a pure function so it can be asserted in tests; delivery is
 * separate because it needs a browser and a user gesture.
 */

import { RUN_STEPS } from './games/rescue.js';
import { displayPuzzleNumber } from './daily.js';

const BAR_LENGTH = 10;
const BAR_FILLED = '▓'; // ▓
const BAR_EMPTY = '░'; // ░

/**
 * Build the share text.
 *
 * Deliberately plain: no markdown, no URL, no trailing spaces, and no
 * characters WhatsApp treats as formatting (* _ ~ `). Lines are joined with
 * plain \n, which is what both WhatsApp and Messenger paste cleanly.
 *
 * The headline number is passengers put ashore, not points: "rescued" has to
 * mean people. Points, which include the full-boat bonus, stay on the result
 * screen. The bar shows how far into the sixty seconds the run got, which is
 * the part neither number conveys.
 */
export function formatShareText({ puzzle, rescued, streak, steps, totalSteps = RUN_STEPS }) {
  const ratio = totalSteps > 0 ? steps / totalSteps : 0;
  // At least one filled cell: an all-empty bar reads as a broken message.
  const filled = Math.min(BAR_LENGTH, Math.max(1, Math.round(ratio * BAR_LENGTH)));
  const bar = BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_LENGTH - filled);

  const lines = [
    `HANDHELD DAILY #${displayPuzzleNumber(puzzle)}  \u{1F6A2}`,
    `${rescued} rescued  ${bar}`,
  ];

  // A "1 day streak" is just "played today", so it is left off.
  if (streak > 1) lines.push(`\u{1F525} ${streak} day streak`);

  return lines.join('\n');
}

/** Copy via a hidden textarea. Last resort for browsers with no async clipboard. */
function legacyCopy(text) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Deliver the share text. Must be called directly from a user gesture --
 * both the Web Share API and the async clipboard require one.
 *
 * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>}
 */
export async function deliverShare(text) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      // Text only. Passing a url would make WhatsApp render a link preview,
      // which is exactly what "keep it short" rules out.
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      // The user dismissing the sheet is a normal outcome, not a failure to
      // fall back from -- falling back would silently copy something they
      // just declined to send.
      if (error && error.name === 'AbortError') return 'cancelled';
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      /* fall through to the legacy path */
    }
  }

  return legacyCopy(text) ? 'copied' : 'failed';
}
