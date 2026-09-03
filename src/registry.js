/**
 * Minigame registry -- the one place logic and rendering are wired together.
 *
 * Adding a second minigame means adding its two modules and one entry here.
 * The shell in main.js reads this and never names a specific game, so it does
 * not change.
 */

import { createRescueGame, DOCKS, FAR_DOCK } from './games/rescue.js';
import { createRescueRenderer } from './render/rescue.js';

export const GAMES = {
  rescue: {
    id: 'rescue',
    title: 'SHIP RESCUE',
    /** (options: {seed: number}) => game */
    create: createRescueGame,
    /** (canvas: HTMLCanvasElement) => {resize, draw(state), orderAt(clientX)} */
    createRenderer: createRescueRenderer,
    /**
     * What the control surface is shaped like.
     *
     * The shell hands this to createInput along with the renderer's
     * orderAt(). It is the only thing about a game's controls the shell has
     * to carry, and it stays here rather than in input.js so that a second
     * minigame with a different board does not have to edit the input module.
     */
    controls: { docks: DOCKS, startDock: FAR_DOCK },
  },
};

/** Which game today's puzzle plays. Eventually this can be picked by the
 *  daily seed to rotate games; for now there is only one. */
export const DEFAULT_GAME_ID = 'rescue';
