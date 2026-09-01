/**
 * Panel -- the overlay shown when nobody is playing: start, result, practice.
 *
 * Owns no game state. It is handed plain values and a set of callbacks, and
 * reports button presses back. Everything is written with textContent rather
 * than innerHTML.
 */

const el = (id) => document.getElementById(id);

export function createPanel() {
  const root = el('panel');
  const eyebrow = el('panel-eyebrow');
  const title = el('panel-title');
  const stats = el('panel-stats');
  const note = el('panel-note');
  const actions = el('panel-actions');
  const footer = el('panel-footer');

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function addStat(label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    stats.append(dt, dd);
  }

  function addButton(label, onClick, { variant = 'secondary', id } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${variant}`;
    button.textContent = label;
    if (id) button.id = id;
    button.addEventListener('click', onClick);
    actions.append(button);
    return button;
  }

  function reset() {
    clear(stats);
    clear(actions);
    note.hidden = true;
    note.textContent = '';
    footer.hidden = true;
    footer.textContent = '';
  }

  return {
    hide() {
      root.hidden = true;
    },

    /** Pre-run screen for a day that has not been played. */
    showStart({ puzzle, date, streak, onPlay, onPractice }) {
      reset();
      eyebrow.textContent = `PUZZLE #${puzzle} · ${date}`;
      title.textContent = 'HANDHELD DAILY';
      if (streak > 1) addStat('STREAK', `${streak} days`);
      note.textContent = 'One run per day. Make it count.';
      note.hidden = false;
      addButton('PLAY', onPlay, { variant: 'primary' });
      addButton('PRACTICE', onPractice);
      root.hidden = false;
    },

    /**
     * Result screen. Also shown on load when the day is already spent, which
     * is why it takes the result rather than reading it from a live game.
     */
    showResult({ puzzle, score, rescued, misses, streak, endReason, justPlayed, onShare, onPractice }) {
      reset();
      eyebrow.textContent = `PUZZLE #${puzzle}`;
      title.textContent = justPlayed
        ? endReason === 'time'
          ? 'TIME UP'
          : 'GAME OVER'
        : 'ALREADY PLAYED';
      addStat('SCORE', score);
      addStat('RESCUED', rescued);
      addStat('MISSED', misses);
      addStat('STREAK', streak === 1 ? '1 day' : `${streak} days`);
      addButton('SHARE', onShare, { variant: 'primary', id: 'btn-share' });
      addButton('PRACTICE', onPractice);
      footer.hidden = false;
      root.hidden = false;
    },

    /** Practice: unlimited, unranked, and labelled as such everywhere. */
    showPracticeResult({ score, rescued, misses, endReason, onAgain, onExit }) {
      reset();
      eyebrow.textContent = 'PRACTICE';
      title.textContent = endReason === 'time' ? 'TIME UP' : 'GAME OVER';
      addStat('SCORE', score);
      addStat('RESCUED', rescued);
      addStat('MISSED', misses);
      note.textContent = 'Practice runs do not count toward your streak.';
      note.hidden = false;
      addButton('PLAY AGAIN', onAgain, { variant: 'primary' });
      addButton('BACK TO DAILY', onExit);
      root.hidden = false;
    },

    showPracticeStart({ onPlay, onExit }) {
      reset();
      eyebrow.textContent = 'PRACTICE';
      title.textContent = 'FREE PLAY';
      note.textContent = 'Random seed, unlimited runs, no streak credit.';
      note.hidden = false;
      addButton('START', onPlay, { variant: 'primary' });
      addButton('BACK TO DAILY', onExit);
      root.hidden = false;
    },

    /** Countdown line on the result screen. Updated once a second. */
    setFooter(text) {
      footer.textContent = text;
      footer.hidden = !text;
    },

    setNote(text) {
      note.textContent = text;
      note.hidden = !text;
    },
  };
}
