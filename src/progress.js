/**
 * Daily progress: what has been played, and the streak.
 *
 * Pure logic over a storage adapter -- no DOM, no clock. The caller supplies
 * the puzzle number (from daily.js), which is what makes this testable and
 * what keeps UTC-day handling in exactly one place.
 */

export const STORAGE_KEY = 'handheld-daily:v1';
export const SCHEMA_VERSION = 1;

/** Keep recent runs only; nobody needs an unbounded history in localStorage. */
export const HISTORY_LIMIT = 60;

function defaultData() {
  return { version: SCHEMA_VERSION, lastPuzzle: null, streak: 0, history: [] };
}

/**
 * @param {{getItem: Function, setItem: Function, removeItem: Function}} storage
 */
export function createProgress(storage) {
  let data = read();

  function read() {
    let raw = null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return defaultData();
    }
    if (!raw) return defaultData();

    try {
      const parsed = JSON.parse(raw);
      // Corrupt or foreign data is discarded rather than trusted. Losing a
      // streak is bad; crashing on boot every time is worse.
      if (!parsed || typeof parsed !== 'object') return defaultData();
      if (parsed.version !== SCHEMA_VERSION) return defaultData();
      return {
        version: SCHEMA_VERSION,
        lastPuzzle: Number.isInteger(parsed.lastPuzzle) ? parsed.lastPuzzle : null,
        streak: Number.isInteger(parsed.streak) && parsed.streak >= 0 ? parsed.streak : 0,
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
      };
    } catch {
      return defaultData();
    }
  }

  function write() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked. The run still counts for this session.
    }
  }

  /**
   * Has this puzzle (or a later one) already been played?
   *
   * Uses <= rather than === so that winding the device clock backwards does
   * not hand out extra runs. This is all client-side and therefore trivially
   * cheatable anyway; the point is to stop honest accidents, not attackers.
   */
  function hasPlayed(puzzle) {
    return data.lastPuzzle !== null && puzzle <= data.lastPuzzle;
  }

  function resultFor(puzzle) {
    return data.history.find((entry) => entry.puzzle === puzzle) || null;
  }

  /**
   * Record a finished daily run.
   *
   * The streak increments only when this puzzle directly follows the last one
   * played. Any gap resets it to 1 -- this run still counts as a day.
   *
   * @returns {{recorded: boolean, streak: number}}
   */
  function record({ puzzle, score, misses, endReason, steps, date }) {
    if (!Number.isInteger(puzzle)) throw new TypeError('record: puzzle must be an integer');

    // Replaying a day already played, or an earlier one, changes nothing.
    if (data.lastPuzzle !== null && puzzle <= data.lastPuzzle) {
      return { recorded: false, streak: data.streak };
    }

    const consecutive = data.lastPuzzle !== null && puzzle === data.lastPuzzle + 1;
    data.streak = consecutive ? data.streak + 1 : 1;
    data.lastPuzzle = puzzle;
    data.history.unshift({ puzzle, score, misses, endReason, steps, date });
    if (data.history.length > HISTORY_LIMIT) data.history.length = HISTORY_LIMIT;

    write();
    return { recorded: true, streak: data.streak };
  }

  function reset() {
    data = defaultData();
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return {
    hasPlayed,
    resultFor,
    record,
    reset,
    get streak() {
      return data.streak;
    },
    get lastPuzzle() {
      return data.lastPuzzle;
    },
    get history() {
      return data.history.slice();
    },
  };
}
