// Keyboard shortcuts -> game commands. The squad runs itself (sim/doctrine.js): the player's
// controls are Cover and Turn around, the kit (a grenade, a flare, the Defend guns), the options of
// an encounter in the scene, and the standing orders (each key cycles one - the orders bar in
// ui/hud.js).
export const KEYS = {
  KeyC: 'cover', KeyT: 'turn', Digit1: 'option1', Digit2: 'option2', Digit3: 'option3',
  KeyQ: 'grenade', KeyE: 'flare', KeyD: 'defend',
  KeyR: 'cycle:route', KeyF: 'cycle:roe', KeyG: 'cycle:pace', KeyL: 'cycle:loot', KeyH: 'cycle:stims', KeyV: 'cycle:light', KeyK: 'cycle:kit',
  Space: 'pause', Escape: 'pause', KeyP: 'retro', KeyM: 'mute', Backquote: 'debug',
};

// Zoom goes by the character typed, not the key's position, so + and - work on any keyboard
// layout and on the numpad.
export const CHARS = { '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut' };

// Held down, these repeat; everything else fires once per press.
const REPEATS = new Set(['zoomIn', 'zoomOut']);

export class Input {
  constructor(handler) {
    this.handler = handler;
    this.onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (Ctrl +/- zooms the page)
      const action = KEYS[e.code] ?? CHARS[e.key];
      if (!action || (e.repeat && !REPEATS.has(action))) return;
      e.preventDefault();
      handler(action);
    };
    window.addEventListener('keydown', this.onKey);
  }

  dispose() { window.removeEventListener('keydown', this.onKey); }
}
