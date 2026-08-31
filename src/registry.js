/**
 * Minigame registry -- the one place logic and rendering are wired together.
 *
 * Adding a second minigame means adding its two modules and one entry here.
 * The shell in main.js reads this and never names a specific game, so it does
 * not change.
 */

import { createParachuteGame } from './games/parachute.js';
import { createParachuteRenderer } from './render/parachute.js';

export const GAMES = {
  parachute: {
    id: 'parachute',
    title: 'PARACHUTE',
    /** (options: {seed: number}) => game */
    create: createParachuteGame,
    /** (canvas: HTMLCanvasElement) => {resize, draw(state)} */
    createRenderer: createParachuteRenderer,
  },
};

/** Which game today's puzzle plays. Eventually this can be picked by the
 *  daily seed to rotate games; for now there is only one. */
export const DEFAULT_GAME_ID = 'parachute';
