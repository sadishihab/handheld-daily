/**
 * Shell -- wires the daily seed, the fixed-timestep loop, input and a
 * renderer together. It contains no game logic and names no specific game;
 * it reads src/registry.js. See docs/DETERMINISM.md.
 */

import { today } from './daily.js';
import { createLoop } from './loop.js';
import { createInput, blockBrowserGestures } from './input.js';
import { GAMES, DEFAULT_GAME_ID } from './registry.js';

/** Steps after a run ends before a press can start the next one, so the
 *  press that lost the game does not immediately restart it. */
const RESTART_LOCKOUT_STEPS = 45;

function boot() {
  const canvas = document.getElementById('screen');
  if (!canvas) throw new Error('boot: #screen canvas not found');

  const entry = GAMES[DEFAULT_GAME_ID];
  const daily = today();

  blockBrowserGestures();

  const input = createInput(canvas);
  const renderer = entry.createRenderer(canvas);
  renderer.resize();

  let game = entry.create({ seed: daily.seed });
  let endedSteps = 0;
  let wasPressed = false;

  const loop = createLoop({
    update() {
      if (!game.isOver) {
        game.update(input.state);
        return;
      }

      // Restart uses the same daily seed on purpose: today's puzzle is
      // today's puzzle, and replaying it gives the identical run.
      endedSteps += 1;
      const pressed = input.state.left || input.state.right;
      if (endedSteps > RESTART_LOCKOUT_STEPS && pressed && !wasPressed) {
        game = entry.create({ seed: daily.seed });
        endedSteps = 0;
      }
      wasPressed = pressed;
    },
    render() {
      renderer.draw(game.state);
    },
  });

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  loop.start();

  // Handy when poking at a run from the console; not used by the game.
  window.handheldDaily = { daily, get game() { return game; }, loop, input };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
