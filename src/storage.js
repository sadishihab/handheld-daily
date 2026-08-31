/**
 * Storage adapters.
 *
 * Everything that persists goes through a {getItem, setItem, removeItem}
 * adapter rather than touching localStorage directly, so progress logic can
 * be tested in Node against a plain in-memory Map.
 */

/** In-memory adapter. Used by tests, and as the fallback below. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * localStorage if it is actually usable, otherwise an in-memory stand-in.
 *
 * Safari in private mode exposes localStorage but throws on setItem, and
 * browsers set to block site data can throw on mere access. Probing once here
 * means the rest of the app never has to care: the game still plays, it just
 * forgets between sessions.
 */
export function createBrowserStorage() {
  try {
    const probe = '__handheld_daily_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}
