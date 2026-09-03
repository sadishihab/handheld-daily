/**
 * Control-scheme preference -- which of the two schemes the player is using.
 *
 * Kept out of input.js because input.js should not know what a URL or a
 * localStorage is, and out of progress.js because this is a setting rather
 * than a result: it is not part of the day's record and clearing progress
 * must not clear it.
 *
 *   ?control=mirror   pick a scheme by link, and remember it
 *   ?control=side
 *
 * The query param is NOT gated to dev hosts the way the clock override in
 * devtime.js is. This is a real player-facing option, not a way to cheat the
 * daily: both schemes play the same seed and produce the same kind of score.
 */

import { normaliseScheme, DEFAULT_SCHEME } from './input.js';

const KEY = 'handheld-daily:control';

/**
 * @param {{getItem: Function, setItem: Function}} storage
 * @param {string} [search] location.search, injected for testing.
 */
export function createControlSetting(storage, search) {
  const query = search !== undefined ? search : typeof location !== 'undefined' ? location.search : '';

  let scheme = DEFAULT_SCHEME;
  try {
    const stored = storage.getItem(KEY);
    if (stored) scheme = normaliseScheme(stored);
  } catch {
    // A browser that refuses storage still gets to play, on the default.
  }

  // A link wins over what was stored, and is then remembered -- so a scheme
  // sent to a phone survives the next plain load of the page.
  const asked = new URLSearchParams(query).get('control');
  if (asked && asked !== scheme) {
    const wanted = normaliseScheme(asked);
    // normaliseScheme falls back to the default, so only honour a param that
    // actually named a scheme; a typo should not silently reset the setting.
    if (asked === wanted) {
      scheme = wanted;
      write(scheme);
    }
  }

  function write(value) {
    try {
      storage.setItem(KEY, value);
    } catch {
      // Setting is lost at the end of the session. The game still plays.
    }
  }

  return {
    get scheme() {
      return scheme;
    },
    /** @param {string} next @returns {string} the scheme actually in force. */
    set(next) {
      scheme = normaliseScheme(next);
      write(scheme);
      return scheme;
    },
  };
}
