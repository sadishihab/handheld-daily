/**
 * Daily ritual flow test -- plain Node, no framework, no dependencies.
 *
 *   node test/flow.test.js
 *
 * Boots the real src/main.js against the mini-DOM in test/minidom.js and
 * walks the whole ritual: play, lock out, roll over, streak, share, practice.
 * This is the only coverage of the wiring in main.js and the panel, which a
 * headless Node process cannot otherwise reach.
 */
import { installDom } from './minidom.js';
import { createMemoryStorage } from '../src/storage.js';
import { INNER_DOCK } from '../src/games/rescue.js';

const ROOT = new URL('../src/', import.meta.url).href;
let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' -- ' + detail}`);
  if (!cond) failed++;
};

const storage = createMemoryStorage();
let bootCount = 0;

/** Boot a fresh instance of the app, sharing one localStorage across boots. */
async function bootApp(search = '') {
  const dom = installDom({ hostname: 'localhost', search, storage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  return dom;
}

/** Play the run to completion. */
function playToEnd(dom) {
  for (let i = 0; i < 500 && dom.ids.panel.hidden; i++) dom.pump(20);
}

console.log('daily ritual flow\n');

// --- first visit
let dom = await bootApp('?date=2026-11-10');
ok('start screen appears on first visit', dom.panelText()?.includes('HANDHELD DAILY'), String(dom.panelText()));
ok('start screen offers PLAY, PRACTICE and the control toggle',
   JSON.stringify(dom.buttons()) === '["PLAY","PRACTICE","CONTROL \u00b7 ONE AT A TIME"]', JSON.stringify(dom.buttons()));
dom.pump(120); // two seconds of frames with nobody having pressed PLAY
ok('the run does not auto-start on load', dom.ids.panel.hidden === false && dom.buttons().includes('PLAY'),
   `panel hidden=${dom.ids.panel.hidden}, buttons ${JSON.stringify(dom.buttons())}`);

dom.click('PLAY');
ok('panel hides when the run starts', dom.ids.panel.hidden === true);
ok('PLAY leaves no panel buttons live', dom.buttons().length === 0, JSON.stringify(dom.buttons()));
dom.pump(60);
ok('PLAY actually starts the simulation', window.handheldDaily.game.state.step > 0,
   `step ${window.handheldDaily.game.state.step}`);

playToEnd(dom);
ok('the run ends on its own', dom.ids.panel.hidden === false);
ok('result screen shows the puzzle number', dom.panelText()?.includes('PUZZLE #'), String(dom.panelText()));

const stats = dom.stats();
ok('result shows rescued, missed and streak',
   'RESCUED' in stats && 'MISSED' in stats && 'STREAK' in stats, JSON.stringify(stats));
ok('first day gives a 1 day streak', stats.STREAK === '1 day', JSON.stringify(stats));
ok('result offers SHARE', dom.buttons().includes('SHARE'), JSON.stringify(dom.buttons()));

dom.tickIntervals();
ok('countdown appears on the result screen',
   /NEXT PUZZLE IN \d\d:\d\d:\d\d/.test(dom.ids['panel-footer'].textContent),
   dom.ids['panel-footer'].textContent);

// --- share
dom.click('SHARE');
await new Promise((r) => setTimeout(r, 10));
ok('share copies to the clipboard', dom.clipboard.written.length === 1, JSON.stringify(dom.clipboard.written));
const shared = dom.clipboard.written[0] || '';
ok('share text has the expected shape',
   /^HANDHELD DAILY #\d+ {2}\u{1F6A2}\n\d+ rescued {2}[▓░]{10}$/u.test(shared),
   JSON.stringify(shared));
ok('share text carries no URL', !/https?:|www\./i.test(shared));

// --- same day, reloaded: must be locked out
dom = await bootApp('?date=2026-11-10');
ok('a replay of the same day is locked out', dom.panelText()?.includes('ALREADY PLAYED'), String(dom.panelText()));
ok('the locked screen offers no PLAY', !dom.buttons().includes('PLAY'), JSON.stringify(dom.buttons()));
ok('the locked screen still offers SHARE', dom.buttons().includes('SHARE'));
ok('the stored score is shown again', dom.stats().RESCUED !== undefined, JSON.stringify(dom.stats()));

// --- next day: playable, streak increments
dom = await bootApp('?date=2026-11-11');
ok('the next UTC day is playable again', dom.buttons().includes('PLAY'), JSON.stringify(dom.buttons()));
dom.click('PLAY');
playToEnd(dom);
ok('a consecutive day increments the streak', dom.stats().STREAK === '2 days', JSON.stringify(dom.stats()));

// --- skip a day: streak resets
dom = await bootApp('?date=2026-11-14');
dom.click('PLAY');
playToEnd(dom);
ok('a skipped day resets the streak', dom.stats().STREAK === '1 day', JSON.stringify(dom.stats()));

// --- practice
dom = await bootApp('?date=2026-11-14'); // already played today
ok('practice is reachable from the locked screen', dom.buttons().includes('PRACTICE'));
dom.click('PRACTICE');
ok('practice start screen appears', dom.panelText()?.includes('FREE PLAY'), String(dom.panelText()));
ok('practice marks the panel', dom.ids.lcd.classList.contains('lcd--practice'));

dom.click('START');
ok('practice START hides the panel', dom.ids.panel.hidden === true, `panel hidden=${dom.ids.panel.hidden}`);
ok('practice START leaves no panel buttons live', dom.buttons().length === 0, JSON.stringify(dom.buttons()));

// The run must actually be advancing, not merely un-panelled.
dom.pump(60);
const practiceStep = window.handheldDaily.game.state.step;
ok('practice START actually starts the simulation', practiceStep > 0, `step ${practiceStep}`);
ok('the practice badge is requested while playing', dom.ids.lcd.classList.contains('lcd--practice'));

playToEnd(dom);
ok('practice run ends with its own screen', dom.panelText()?.includes('PRACTICE'), String(dom.panelText()));
ok('practice offers unlimited replay', dom.buttons().includes('PLAY AGAIN'), JSON.stringify(dom.buttons()));
ok('practice never offers SHARE', !dom.buttons().includes('SHARE'), JSON.stringify(dom.buttons()));
ok('practice shows no streak', !('STREAK' in dom.stats()), JSON.stringify(dom.stats()));
ok('practice says it does not count', /do not count/i.test(dom.ids['panel-note'].textContent), dom.ids['panel-note'].textContent);

const streakBefore = JSON.parse(storage.getItem('handheld-daily:v1')).streak;
dom.click('PLAY AGAIN');
ok('PLAY AGAIN hides the panel and restarts', dom.ids.panel.hidden === true);
dom.pump(30);
ok('PLAY AGAIN starts a fresh run', window.handheldDaily.game.state.step > 0 && !window.handheldDaily.game.isOver,
   `step ${window.handheldDaily.game.state.step}`);
playToEnd(dom);
const streakAfter = JSON.parse(storage.getItem('handheld-daily:v1')).streak;
ok('practice runs do not touch the streak', streakBefore === streakAfter, `${streakBefore} -> ${streakAfter}`);
ok('practice can be replayed immediately', dom.buttons().includes('PLAY AGAIN'));

dom.click('BACK TO DAILY');
ok('leaving practice returns to the daily screen', dom.panelText()?.includes('ALREADY PLAYED'), String(dom.panelText()));
ok('leaving practice clears the practice mark', !dom.ids.lcd.classList.contains('lcd--practice'));

// --- dev override is refused off a dev host
{
  const cleanStorage = createMemoryStorage();
  const publicDom = installDom({ hostname: 'sadishihab.github.io', search: '?date=2026-11-10', storage: cleanStorage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  const eyebrow = publicDom.ids['panel-eyebrow'].textContent;
  // Derived from the real clock, not hardcoded: a fixed date here silently
  // rots the moment the day rolls over. The date half is what carries the
  // assertion -- before launch every real day clamps to #1 on screen, so the
  // number alone could agree with the override by accident.
  const { puzzleNumber, displayPuzzleNumber, utcDateString } = await import('../src/daily.js');
  const realPuzzle = displayPuzzleNumber(puzzleNumber(Date.now()));
  const realDate = utcDateString(Date.now());
  ok('a public host ignores ?date',
     eyebrow.includes(`#${realPuzzle}`) && eyebrow.includes(realDate),
     `${eyebrow} (expected #${realPuzzle} and ${realDate})`);
}

// --- a pre-launch date must never put a zero or negative number on screen
//
// LAUNCH_DATE_UTC is a placeholder in the future, so this is the state every
// real visit is in today: puzzleNumber() returns something like -60, and the
// screens and the share card have to clamp it. Walks the whole ritual rather
// than checking one string, because the number is rendered in three places.
{
  const cleanStorage = createMemoryStorage();
  const { LAUNCH_DATE_UTC } = await import('../src/daily.js');
  const wellBeforeLaunch = new Date(Date.parse(`${LAUNCH_DATE_UTC}T00:00:00Z`) - 86400000 * 91)
    .toISOString()
    .slice(0, 10);

  const earlyDom = installDom({
    hostname: 'localhost',
    search: `?date=${wellBeforeLaunch}`,
    storage: cleanStorage,
  });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);

  /** The number the eyebrow is showing, whatever it is. */
  const shownPuzzle = () => Number(/#(-?\d+)/.exec(earlyDom.ids['panel-eyebrow'].textContent)?.[1]);

  ok('the raw puzzle number really is negative here',
     window.handheldDaily.daily.puzzle < 0, `puzzle ${window.handheldDaily.daily.puzzle}`);
  ok('the start screen shows puzzle 1, not a negative number',
     shownPuzzle() === 1, earlyDom.ids['panel-eyebrow'].textContent);

  earlyDom.click('PLAY');
  playToEnd(earlyDom);
  ok('the result screen shows puzzle 1, not a negative number',
     shownPuzzle() === 1, earlyDom.ids['panel-eyebrow'].textContent);

  earlyDom.click('SHARE');
  await new Promise((r) => setTimeout(r, 10));
  const earlyShare = earlyDom.clipboard.written[0] || '';
  ok('the share card shows puzzle 1, not a negative number',
     earlyShare.startsWith('HANDHELD DAILY #1  '), JSON.stringify(earlyShare));
  ok('nothing user-facing carries a zero or negative puzzle number',
     !/#(-\d+|0\b)/.test(earlyShare + ' ' + earlyDom.ids['panel-eyebrow'].textContent),
     JSON.stringify(earlyShare));
}

// --- control schemes
//
// Two schemes ship and the toggle picks between them, so the wiring that has
// to hold is: the button says which one is live, the preference outlives a
// reload, and -- the only part that is not cosmetic -- a single touch reaches
// one boat under 'side' and both under 'mirror'.
//
// Driven through main.js rather than against createInput directly, because
// the thing that could plausibly break is the wiring: the renderer's orderAt,
// the stored preference and the input module all have to agree about what a
// column means.
{
  const schemeStorage = createMemoryStorage();
  let schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-04', storage: schemeStorage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);

  const controlButton = () =>
    schemeDom.ids['panel-actions'].buttons().find((b) => b.startsWith('CONTROL'));

  ok('the toggle starts on the side-addressed scheme', controlButton() === 'CONTROL · ONE AT A TIME', String(controlButton()));

  schemeDom.click(controlButton());
  ok('pressing the toggle switches scheme', controlButton() === 'CONTROL · BOTH TOGETHER', String(controlButton()));
  ok('the input module was switched too, not just the label',
     window.handheldDaily.input.scheme === 'mirror', window.handheldDaily.input.scheme);

  schemeDom.click(controlButton());
  ok('pressing it again cycles back', window.handheldDaily.input.scheme === 'side', window.handheldDaily.input.scheme);

  // A scheme is a setting, not a result: it has to survive a reload.
  schemeDom.click(controlButton());
  schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-04', storage: schemeStorage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  ok('the chosen scheme survives a reload', window.handheldDaily.input.scheme === 'mirror', window.handheldDaily.input.scheme);

  // ?control= is a link anyone may follow, so unlike the clock override it is
  // not gated on the host -- and a nonsense value must not silently reset it.
  schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-04&control=side', storage: schemeStorage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  ok('?control picks a scheme by link', window.handheldDaily.input.scheme === 'side', window.handheldDaily.input.scheme);

  schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-04&control=sideways', storage: schemeStorage });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  ok('a nonsense ?control leaves the stored scheme alone',
     window.handheldDaily.input.scheme === 'side', window.handheldDaily.input.scheme);

  /**
   * Touch one column and report where each boat was ordered.
   *
   * The canvas is 420 CSS px wide at devicePixelRatio 2, so the panel is
   * letterboxed and a column is not a fraction of the width -- which is
   * exactly why input asks the renderer rather than doing the arithmetic
   * itself. Reading the targets back afterwards is the only honest check.
   */
  function touchAndRead(dom, clientX) {
    dom.click('PLAY');
    dom.canvas.dispatch('pointerdown', { pointerId: 1, clientX });
    dom.pump(2);
    const [left, right] = window.handheldDaily.game.state.boats;
    return { left: left.target, right: right.target };
  }

  schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-05&control=side', storage: createMemoryStorage() });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  const sideTargets = touchAndRead(schemeDom, 100);
  ok('side-addressed: a touch on the left half orders the left boat',
     sideTargets.left !== INNER_DOCK, JSON.stringify(sideTargets));
  ok('side-addressed: the other boat is left on its own standing order',
     sideTargets.right === INNER_DOCK, JSON.stringify(sideTargets));

  schemeDom = installDom({ hostname: 'localhost', search: '?date=2027-01-05&control=mirror', storage: createMemoryStorage() });
  bootCount++;
  await import(`${ROOT}main.js?boot=${bootCount}`);
  const mirrorTargets = touchAndRead(schemeDom, 100);
  ok('mirrored: one touch orders both boats',
     mirrorTargets.left !== INNER_DOCK && mirrorTargets.right !== INNER_DOCK, JSON.stringify(mirrorTargets));
  ok('mirrored: both boats take the same dock, so the pair stays a mirror image',
     mirrorTargets.left === mirrorTargets.right, JSON.stringify(mirrorTargets));
  ok('mirrored: the dock is the one the touch landed on',
     mirrorTargets.left === sideTargets.left, `${JSON.stringify(mirrorTargets)} vs ${JSON.stringify(sideTargets)}`);
}

console.log(`\n${failed === 0 ? 'all good' : failed + ' failed'}`);
process.exit(failed === 0 ? 0 : 1);
