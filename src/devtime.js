/**
 * Development clock override, so the UTC rollover can be tested without
 * waiting for midnight.
 *
 *   ?date=2026-11-03   jump to that UTC date (noon UTC)
 *   ?days=2            shift the clock forward two days (negative works too)
 *   ?reset=1           clear stored progress on boot
 *
 * There is no build step to strip this from a production bundle, so it is
 * gated on the host instead: overrides are honoured on localhost and on
 * private network addresses (so a phone on the LAN can use them) and ignored
 * everywhere else. A public deploy therefore serves the real clock.
 */

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|.*\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

const MS_PER_DAY = 86400000;

export function isDevHost(hostname) {
  const host =
    hostname !== undefined
      ? hostname
      : typeof location !== 'undefined'
        ? location.hostname
        : '';
  // file:// has an empty hostname.
  if (host === '') return true;
  return PRIVATE_HOST.test(host);
}

/**
 * Resolve the override into a fixed offset from the real clock.
 *
 * An offset rather than a frozen timestamp, so the clock still ticks: set
 * ?date to a day and the countdown runs, and an actual rollover can be
 * watched by overriding to just before midnight.
 *
 * @returns {{offsetMs: number, reset: boolean, active: boolean, label: string|null}}
 */
export function readDevClock(search, hostname) {
  const inactive = { offsetMs: 0, reset: false, active: false, label: null };

  if (!isDevHost(hostname)) return inactive;

  const query = search !== undefined ? search : typeof location !== 'undefined' ? location.search : '';
  const params = new URLSearchParams(query);

  const reset = params.get('reset') === '1' || params.get('reset') === 'true';
  let offsetMs = 0;
  let label = null;

  const dateParam = params.get('date');
  const daysParam = params.get('days');

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const target = Date.parse(`${dateParam}T12:00:00Z`);
    if (!Number.isNaN(target)) {
      offsetMs = target - Date.now();
      label = dateParam;
    }
  } else if (daysParam !== null && /^-?\d+$/.test(daysParam)) {
    offsetMs = Number(daysParam) * MS_PER_DAY;
    label = `${Number(daysParam) >= 0 ? '+' : ''}${daysParam}d`;
  }

  return { offsetMs, reset, active: offsetMs !== 0 || reset, label };
}

/**
 * @param {{offsetMs: number}} devClock
 * @returns {() => number} A now() that includes the override.
 */
export function createClock(devClock) {
  const offset = devClock && Number.isFinite(devClock.offsetMs) ? devClock.offsetMs : 0;
  return () => Date.now() + offset;
}
