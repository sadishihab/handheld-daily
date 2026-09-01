/**
 * Daily ritual test -- plain Node, no framework, no dependencies.
 *
 *   node test/progress.test.js
 *
 * Covers the rules that decide whether a player keeps their streak: one run
 * per UTC day, increment on consecutive days, reset after a gap.
 */

import { createProgress } from '../src/progress.js';
import { createMemoryStorage } from '../src/storage.js';
import { formatShareText } from '../src/share.js';
import { readDevClock, createClock, isDevHost } from '../src/devtime.js';
import { puzzleNumber, displayPuzzleNumber, LAUNCH_DATE_UTC } from '../src/daily.js';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

function newProgress() {
  return createProgress(createMemoryStorage());
}

function play(progress, puzzle, score = 10) {
  return progress.record({
    puzzle,
    score,
    rescued: Math.floor(score / 10),
    misses: 3,
    endReason: 'misses',
    steps: 600,
    date: '2026-11-01',
  });
}

console.log('daily ritual\n');

// --- streaks
{
  const p = newProgress();
  check('a fresh player has no streak', p.streak === 0 && p.lastPuzzle === null);

  play(p, 10);
  check('the first run starts a 1 day streak', p.streak === 1);

  play(p, 11);
  play(p, 12);
  check('consecutive days increment the streak', p.streak === 3, `streak ${p.streak}`);
}

{
  const p = newProgress();
  play(p, 10);
  play(p, 11);
  check('streak is 2 before the gap', p.streak === 2);

  play(p, 13); // skipped 12
  check('a skipped day resets the streak to 1', p.streak === 1, `streak ${p.streak}`);

  play(p, 14);
  check('the streak rebuilds after a reset', p.streak === 2, `streak ${p.streak}`);
}

{
  const p = newProgress();
  play(p, 10);
  play(p, 40); // a long absence
  check('a long gap resets to 1, not 0', p.streak === 1);
}

// --- one run per day
{
  const p = newProgress();
  check('a new puzzle has not been played', !p.hasPlayed(10));

  const first = play(p, 10, 47);
  check('the first run is recorded', first.recorded === true && first.streak === 1);
  check('the day is now marked played', p.hasPlayed(10));

  const second = play(p, 10, 99);
  check('the same day cannot be played twice', second.recorded === false);
  check('a repeat attempt does not change the streak', p.streak === 1, `streak ${p.streak}`);
  check('a repeat attempt does not add history', p.history.length === 1, `${p.history.length} entries`);
  check('the original score is kept', p.resultFor(10).score === 47, JSON.stringify(p.resultFor(10)));

  check('tomorrow is playable', !p.hasPlayed(11));
}

{
  // Winding the clock back must not hand out extra runs.
  const p = newProgress();
  play(p, 20);
  check('an earlier puzzle counts as already played', p.hasPlayed(19) && p.hasPlayed(1));
  const back = play(p, 19);
  check('an earlier puzzle cannot be recorded', back.recorded === false && p.lastPuzzle === 20);
}

// --- persistence
{
  const storage = createMemoryStorage();
  const first = createProgress(storage);
  play(first, 10);
  play(first, 11);

  const reloaded = createProgress(storage);
  check(
    'streak and last puzzle survive a reload',
    reloaded.streak === 2 && reloaded.lastPuzzle === 11,
    `streak ${reloaded.streak}, last ${reloaded.lastPuzzle}`
  );
  check('history survives a reload', reloaded.history.length === 2);
  check('a reloaded player cannot replay today', reloaded.hasPlayed(11));
}

{
  const storage = createMemoryStorage();
  storage.setItem('handheld-daily:v1', '{ this is not json');
  const p = createProgress(storage);
  check('corrupt stored data falls back to a fresh player', p.streak === 0 && p.lastPuzzle === null);
}

{
  const storage = createMemoryStorage();
  storage.setItem('handheld-daily:v1', JSON.stringify({ version: 99, streak: 500, lastPuzzle: 3 }));
  const p = createProgress(storage);
  check('a future schema version is discarded, not trusted', p.streak === 0);
}

{
  // Storage that throws on write, as in Safari private mode.
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const p = createProgress(hostile);
  let threw = false;
  try {
    play(p, 10);
  } catch {
    threw = true;
  }
  check('a run still counts when storage refuses writes', !threw && p.streak === 1);
}

{
  const p = newProgress();
  for (let puzzle = 1; puzzle <= 80; puzzle++) play(p, puzzle);
  check('history is capped', p.history.length === 60, `${p.history.length} entries`);
  check('the cap keeps the most recent runs', p.history[0].puzzle === 80);
  check('the streak is unaffected by the cap', p.streak === 80, `streak ${p.streak}`);
}

// --- share text
{
  const text = formatShareText({ puzzle: 1, rescued: 47, streak: 6, steps: 2520, totalSteps: 3600 });
  const lines = text.split('\n');
  check('share text is three lines', lines.length === 3, JSON.stringify(text));
  check('line 1 names the puzzle', lines[0] === 'HANDHELD DAILY #1  \u{1FA82}', JSON.stringify(lines[0]));
  check('line 2 carries score and bar', lines[1] === '47 rescued  ▓▓▓▓▓▓▓░░░', JSON.stringify(lines[1]));
  check('line 3 carries the streak', lines[2] === '\u{1F525} 6 day streak', JSON.stringify(lines[2]));
  check('share text contains no URL', !/https?:|www\.|\.com/i.test(text));
  check(
    'share text avoids WhatsApp formatting characters',
    !/[*_~`]/.test(text),
    JSON.stringify(text)
  );
  check('share text has no trailing whitespace', text.split('\n').every((l) => l === l.trimEnd()));
}

{
  const solo = formatShareText({ puzzle: 5, rescued: 3, streak: 1, steps: 300, totalSteps: 3600 });
  check('a 1 day streak is omitted', solo.split('\n').length === 2, JSON.stringify(solo));
  check('a short run still shows one filled cell', solo.includes('▓░'), JSON.stringify(solo));
}

{
  const full = formatShareText({ puzzle: 5, rescued: 60, streak: 2, steps: 3600, totalSteps: 3600 });
  check('a full run fills the bar', full.includes('▓'.repeat(10)), JSON.stringify(full));
}

// --- puzzle numbers a player is allowed to see
//
// LAUNCH_DATE_UTC is still a placeholder in the future, so puzzleNumber() is
// negative for every real date until it lands. That is fine internally -- the
// lockout and streak rules only need it to be monotonic -- but "PUZZLE #-60"
// on the result screen and "HANDHELD DAILY #-60" on a share card are not.
{
  check('a date before launch clamps to puzzle 1', displayPuzzleNumber(-60) === 1);
  check('the day before launch clamps to puzzle 1', displayPuzzleNumber(0) === 1);
  check('launch day is left alone', displayPuzzleNumber(1) === 1);
  check('a date after launch is left alone', displayPuzzleNumber(7) === 7);
  check('a garbage value still renders something playable', displayPuzzleNumber(NaN) === 1);

  // The clamp belongs at the render boundary, not at the source. If someone
  // ever "fixes" puzzleNumber() itself, hasPlayed() and record() stop being
  // able to order days across the launch boundary and the dev clock's
  // ?days=-N override silently stops working.
  const beforeLaunch = Date.parse(`${LAUNCH_DATE_UTC}T00:00:00Z`) - 86400000 * 3;
  check(
    'the raw puzzle number is still allowed below 1',
    puzzleNumber(beforeLaunch) === -2,
    `got ${puzzleNumber(beforeLaunch)}`
  );
  check(
    'raw numbers before launch still order correctly',
    puzzleNumber(beforeLaunch) < puzzleNumber(beforeLaunch + 86400000)
  );

  // The share card is the copy that leaves the device, so it is the one that
  // would be embarrassing.
  const early = formatShareText({ puzzle: -60, rescued: 12, streak: 1, steps: 1800, totalSteps: 3600 });
  check('share text clamps a pre-launch puzzle number',
    early.startsWith('HANDHELD DAILY #1  '), JSON.stringify(early));
  check('share text never shows a negative or zero puzzle number',
    !/#(-\d+|0\b)/.test(early), JSON.stringify(early));
  check('share text clamps puzzle zero too',
    formatShareText({ puzzle: 0, rescued: 1, streak: 1, steps: 60 }).startsWith('HANDHELD DAILY #1  '));
}

// --- dev clock
{
  check('localhost is a dev host', isDevHost('localhost') && isDevHost('127.0.0.1'));
  check('a LAN address is a dev host', isDevHost('192.168.1.42') && isDevHost('10.0.0.7'));
  check(
    'a public host is not',
    !isDevHost('sadishihab.github.io') && !isDevHost('handhelddaily.com')
  );

  const ignored = readDevClock('?date=2027-01-01', 'sadishihab.github.io');
  check('a public host ignores the override', ignored.active === false && ignored.offsetMs === 0);

  const byDate = readDevClock('?date=2026-11-05', 'localhost');
  const clock = createClock(byDate);
  check(
    'a date override moves the puzzle number',
    puzzleNumber(clock()) === puzzleNumber(Date.parse('2026-11-05T12:00:00Z')),
    `got ${puzzleNumber(clock())}`
  );

  const launchClock = createClock(readDevClock(`?date=${LAUNCH_DATE_UTC}`, 'localhost'));
  check('a date override can reach launch day', puzzleNumber(launchClock()) === 1);

  const byDays = createClock(readDevClock('?days=3', 'localhost'));
  check(
    'a days override shifts exactly three days',
    puzzleNumber(byDays()) === puzzleNumber(Date.now()) + 3,
    `${puzzleNumber(byDays())} vs ${puzzleNumber(Date.now()) + 3}`
  );

  const back = createClock(readDevClock('?days=-2', 'localhost'));
  check('a negative days override goes backwards', puzzleNumber(back()) === puzzleNumber(Date.now()) - 2);

  check('reset is picked up', readDevClock('?reset=1', 'localhost').reset === true);
  check('reset is ignored on a public host', readDevClock('?reset=1', 'example.com').reset === false);
  check('garbage params are ignored', readDevClock('?date=banana', 'localhost').offsetMs === 0);

  // The override must tick rather than freeze, or a rollover can never happen.
  const ticking = createClock(readDevClock('?days=1', 'localhost'));
  const a = ticking();
  const b = ticking();
  check('the overridden clock still advances', b >= a && b - Date.now() > 86000000);
}

// --- the rollover the whole ritual depends on
{
  const p = newProgress();
  const dayOne = puzzleNumber(Date.parse('2026-11-10T23:59:00Z'));
  const dayTwo = puzzleNumber(Date.parse('2026-11-11T00:01:00Z'));
  check('one minute either side of UTC midnight is two puzzles', dayTwo === dayOne + 1);

  play(p, dayOne);
  check('locked out just before midnight', p.hasPlayed(dayOne));
  check('unlocked just after midnight', !p.hasPlayed(dayTwo));
  play(p, dayTwo);
  check('crossing midnight extends the streak', p.streak === 2, `streak ${p.streak}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
