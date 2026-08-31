/**
 * Countdown formatting for the wait until the next puzzle.
 *
 * Separate from daily.js because this is presentation: daily.js returns
 * milliseconds, this turns them into something a person reads.
 */

/** @param {number} ms @returns {string} e.g. "07:12:45" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
