/**
 * Shell -- the daily ritual around the game.
 *
 * Owns the screen flow (start -> playing -> result), one-run-per-UTC-day
 * enforcement, streak recording, sharing, and practice mode. It contains no
 * game logic and names no specific game; it reads src/registry.js.
 *
 * The clock lives here and nowhere near the simulation: the shell turns the
 * current UTC day into an integer seed and hands that to the game. See
 * docs/DETERMINISM.md.
 */

import { today, puzzleNumber, msUntilNextPuzzle, cyrb53 } from './daily.js';
import { createLoop } from './loop.js';
import { createInput, blockBrowserGestures } from './input.js';
import { createProgress } from './progress.js';
import { createBrowserStorage } from './storage.js';
import { formatShareText, deliverShare } from './share.js';
import { readDevClock, createClock } from './devtime.js';
import { formatCountdown } from './countdown.js';
import { createPanel } from './ui/panel.js';
import { GAMES, DEFAULT_GAME_ID } from './registry.js';

const MODE_DAILY = 'daily';
const MODE_PRACTICE = 'practice';

function boot() {
  const canvas = document.getElementById('screen');
  const lcd = document.getElementById('lcd');
  if (!canvas || !lcd) throw new Error('boot: expected #screen and #lcd');

  const entry = GAMES[DEFAULT_GAME_ID];
  const devClock = readDevClock();
  const now = createClock(devClock);

  const progress = createProgress(createBrowserStorage());
  if (devClock.reset) progress.reset();

  blockBrowserGestures();
  const input = createInput(canvas);
  const panel = createPanel();
  const renderer = entry.createRenderer(canvas);
  renderer.resize();

  /** @type {'idle'|'playing'} */
  let phase = 'idle';
  let mode = MODE_DAILY;
  let game = entry.create({ seed: 0 });
  let practiceRuns = 0;
  /** True while the screen shows a run the player just finished. */
  let resultIsFresh = false;

  /** Today, as of the last time we asked. Re-read on rollover. */
  let daily = today(now());

  function startRun(seed) {
    resultIsFresh = false;
    game = entry.create({ seed });
    input.releaseAll();
    phase = 'playing';
    panel.hide();
  }

  // ---- screens

  function showDaily() {
    mode = MODE_DAILY;
    phase = 'idle';
    lcd.classList.remove('lcd--practice');
    daily = today(now());

    if (progress.hasPlayed(daily.puzzle)) {
      showResultScreen({ justPlayed: false });
      return;
    }

    panel.showStart({
      puzzle: daily.puzzle,
      date: daily.date,
      streak: progress.streak,
      onPlay: () => startRun(daily.seed),
      onPractice: showPracticeStart,
    });
  }

  function showResultScreen({ justPlayed }) {
    // On a return visit the run is read back from storage, so the screen is
    // identical whether or not this session played it.
    const stored = progress.resultFor(daily.puzzle);
    const result = justPlayed
      ? {
          score: game.state.score,
          misses: game.state.misses,
          endReason: game.state.endReason,
          steps: game.state.step,
        }
      : stored || { score: 0, misses: 0, endReason: 'misses', steps: 0 };

    resultIsFresh = justPlayed;
    panel.showResult({
      puzzle: daily.puzzle,
      score: result.score,
      misses: result.misses,
      streak: progress.streak,
      endReason: result.endReason,
      justPlayed,
      onShare: () => handleShare(result),
      onPractice: showPracticeStart,
    });
    updateCountdown();
  }

  function showPracticeStart() {
    mode = MODE_PRACTICE;
    phase = 'idle';
    resultIsFresh = false;
    lcd.classList.add('lcd--practice');
    panel.showPracticeStart({ onPlay: startPractice, onExit: showDaily });
  }

  function startPractice() {
    mode = MODE_PRACTICE;
    lcd.classList.add('lcd--practice');
    // Practice seeds are picked from the wall clock, which is fine because
    // choosing a seed is outside the simulation -- the run itself is still
    // fully determined by the integer that comes out of here.
    practiceRuns += 1;
    const seed = cyrb53(`practice:${Date.now()}:${practiceRuns}`) >>> 0;
    startRun(seed);
  }

  // ---- sharing

  async function handleShare(result) {
    const text = formatShareText({
      puzzle: daily.puzzle,
      score: result.score,
      streak: progress.streak,
      steps: result.steps,
    });

    const outcome = await deliverShare(text);
    if (outcome === 'copied') panel.setNote('Copied. Paste it anywhere.');
    else if (outcome === 'failed') panel.setNote('Could not share on this device.');
    else panel.setNote('');
  }

  // ---- the countdown, and the rollover it is counting down to

  function updateCountdown() {
    if (phase === 'playing' || mode !== MODE_DAILY) return;
    const stamp = now();

    // Crossing UTC midnight while the page sits open unlocks the next run.
    // Not while a just-finished result is on screen, though: a run that ends
    // seconds before midnight would otherwise have its result yanked away
    // before the player could read or share it.
    if (puzzleNumber(stamp) !== daily.puzzle) {
      if (resultIsFresh) {
        panel.setFooter('NEXT PUZZLE READY · RELOAD TO PLAY');
        return;
      }
      showDaily();
      return;
    }

    if (progress.hasPlayed(daily.puzzle)) {
      panel.setFooter(`NEXT PUZZLE IN ${formatCountdown(msUntilNextPuzzle(stamp))}`);
    }
  }

  setInterval(updateCountdown, 1000);

  // ---- the wall clock shown on the panel
  //
  // Local time, not UTC: a handheld shows the time where you are. This is
  // render-only chrome -- it is passed into draw() rather than read by the
  // renderer, and it never reaches the simulation. Memoised per second so a
  // 60Hz render loop does not build a Date sixty times a second.

  let clockFaceSecond = -1;
  let clockFace = { clock: '00:00', colonOn: true };

  function readClockFace() {
    const stamp = now();
    const second = Math.floor(stamp / 1000);
    if (second !== clockFaceSecond) {
      clockFaceSecond = second;
      const when = new Date(stamp);
      const hh = String(when.getHours()).padStart(2, '0');
      const mm = String(when.getMinutes()).padStart(2, '0');
      // The colon blinks once a second, as it did on the originals.
      clockFace = { clock: `${hh}:${mm}`, colonOn: when.getSeconds() % 2 === 0 };
    }
    return clockFace;
  }

  // ---- the loop

  const loop = createLoop({
    update() {
      if (phase !== 'playing') return;

      game.update(input.state);

      if (game.isOver) {
        phase = 'idle';
        if (mode === MODE_DAILY) {
          progress.record({
            puzzle: daily.puzzle,
            score: game.state.score,
            misses: game.state.misses,
            endReason: game.state.endReason,
            steps: game.state.step,
            date: daily.date,
          });
          showResultScreen({ justPlayed: true });
        } else {
          panel.showPracticeResult({
            score: game.state.score,
            misses: game.state.misses,
            endReason: game.state.endReason,
            onAgain: startPractice,
            onExit: showDaily,
          });
        }
      }
    },
    render() {
      renderer.draw(game.state, {
        badge: mode === MODE_PRACTICE ? 'PRACTICE' : null,
        ...readClockFace(),
      });
    },
  });

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  loop.start();
  showDaily();

  // Handy from the console; not used by the game.
  window.handheldDaily = {
    get daily() {
      return daily;
    },
    get game() {
      return game;
    },
    progress,
    devClock,
    loop,
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
