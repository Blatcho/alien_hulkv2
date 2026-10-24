// Player input -> game commands.
//
// Squad mode (keyboard): the squad runs itself (sim/doctrine.js); the player's controls are
// Cover and Turn around, the kit (a grenade, a flare, the Defend guns), the options of an
// encounter in the scene, and the standing orders (each key cycles one - the orders bar in
// ui/hud.js).
//
// Lead mode (a controller, or keyboard and mouse): the player walks one marine himself.
// poll() reads the pad every frame into a steering state the sim consumes (world.steer):
// left stick moves (up/down at a ladder climbs it), right stick aims, RT fires, LT crouches
// everyone; the buttons are commands like the keys are: A use, B hold/follow, X grenade,
// Y flare, LB defend, RB reload, D-pad the followers' orders (or an encounter's options),
// Start pause, Back the ship map (ui/map.js). Without a pad: WASD/arrows walk, the mouse aims (from the
// marine), mouse 1 fires, Shift crouches, E uses, R reloads, T holds.
export const KEYS = {
  KeyC: 'cover', KeyT: 'turn', Digit1: 'option1', Digit2: 'option2', Digit3: 'option3',
  KeyQ: 'grenade', KeyE: 'flare', KeyD: 'defend',
  KeyR: 'cycle:route', KeyF: 'cycle:roe', KeyG: 'cycle:pace', KeyL: 'cycle:loot', KeyH: 'cycle:stims', KeyV: 'cycle:light', KeyK: 'cycle:kit',
  Space: 'pause', Escape: 'pause', Tab: 'map', KeyP: 'retro', KeyM: 'mute', Backquote: 'debug',
};

export const LEAD_KEYS = {
  KeyE: 'use', KeyR: 'reload', KeyT: 'hold', KeyC: 'cover', Digit1: 'option1', Digit2: 'option2', Digit3: 'option3',
  KeyQ: 'grenade', KeyF: 'flare', KeyG: 'defend',
  KeyX: 'cycle:roe', KeyH: 'cycle:stims', KeyV: 'cycle:light', KeyK: 'cycle:kit',
  Space: 'pause', Escape: 'pause', Tab: 'map', KeyP: 'retro', KeyM: 'mute', Backquote: 'debug',
};

// Held down in lead mode: walking and crouching.
const HELD = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ShiftLeft: 'cover', ShiftRight: 'cover' };

// Standard gamepad layout (Xbox names): what each button does in lead mode.
export const PAD_BUTTONS = {
  0: 'use', 1: 'hold', 2: 'grenade', 3: 'flare', 4: 'defend', 5: 'reload',
  8: 'map', 9: 'pause', 12: 'pad:up', 13: 'pad:down', 14: 'pad:left', 15: 'pad:right',
};
const DEADZONE = 0.18;
const TRIGGER = 0.4;

// Zoom goes by the character typed, not the key's position, so + and - work on any keyboard
// layout and on the numpad.
export const CHARS = { '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut' };

// Held down, these repeat; everything else fires once per press.
const REPEATS = new Set(['zoomIn', 'zoomOut']);

/** A stick axis past its dead zone, rescaled so it reaches 1 at full deflection. */
const axis = (v) => (Math.abs(v) < DEADZONE ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - DEADZONE) / (1 - DEADZONE)));

export class Input {
  constructor(handler, { stage = null } = {}) {
    this.handler = handler;
    this.mode = 'squad';
    this.held = new Set();
    this.mouse = { x: 0, y: 0, down: false, seen: false };
    this.coverLatch = false;
    this.padIndex = null;
    this.padDown = [];
    this.padSeen = false;  // a controller has spoken: the HUD shows its buttons
    this.padUsedAt = 0;    // last time the pad moved (keyboard and pad share the marine)
    this.state = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, cover: false };
    this.onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (Ctrl +/- zooms the page)
      if (this.mode === 'lead' && HELD[e.code]) { this.held.add(HELD[e.code]); e.preventDefault(); return; }
      const action = (this.mode === 'lead' ? LEAD_KEYS : KEYS)[e.code] ?? CHARS[e.key];
      if (!action || (e.repeat && !REPEATS.has(action))) return;
      e.preventDefault();
      handler(action);
    };
    this.onKeyUp = (e) => { if (HELD[e.code]) this.held.delete(HELD[e.code]); };
    this.onBlur = () => { this.held.clear(); this.mouse.down = false; };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    if (stage) {
      stage.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true; this.mouse.movedAt = performance.now(); });
      stage.addEventListener('mousedown', (e) => { if (e.button === 0 && this.mode === 'lead') { this.mouse.down = true; e.preventDefault(); } });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
      stage.addEventListener('contextmenu', (e) => { if (this.mode === 'lead') e.preventDefault(); });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.padSeen = true; });
      window.addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = null; });
    }
  }

  /** 'squad' (keys only) or 'lead' (the pad, or keys and mouse, steer one marine). */
  setMode(mode) {
    this.mode = mode;
    this.held.clear();
    this.mouse.down = false;
    this.coverLatch = false;
  }

  /** The Cover button in lead mode: a latch (the trigger or Shift held does the same). */
  toggleCover() { this.coverLatch = !this.coverLatch; }

  /** The connected controller, if any (the first one with any input, failing the one that announced itself). */
  gamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return null;
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; this.padSeen = true; return p; }
    return null;
  }

  /**
   * Lead mode, once a frame: the steering state for the sim (world.steer), plus one command per
   * button press. `origin` is the marine's screen position (the mouse aims from it).
   */
  poll(origin = null, now = performance.now()) {
    const s = this.state;
    s.moveX = s.moveY = s.aimX = s.aimY = 0;
    s.fire = false;
    s.cover = this.coverLatch;
    if (this.mode !== 'lead') return s;
    const pad = this.gamepad();
    if (pad) {
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      s.moveX = axis(lx);
      s.moveY = -axis(ly);
      s.aimX = axis(rx);
      s.aimY = -axis(ry);
      const b = (i) => pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > TRIGGER;
      s.fire = b(7);
      s.cover = s.cover || b(6);
      // D-pad on a stick-shaped hat (some pads report it on an axis): left as is - rare.
      for (let i = 0; i < pad.buttons.length; i++) {
        const down = b(i);
        if (down && !this.padDown[i] && PAD_BUTTONS[i]) this.handler(PAD_BUTTONS[i]);
        this.padDown[i] = down;
      }
      if (s.moveX || s.moveY || s.aimX || s.aimY || s.fire || b(6)) { this.padUsedAt = now; this.padSeen = true; }
    }
    // Keyboard and mouse, when the pad is quiet.
    if (now - this.padUsedAt > 250) {
      const h = this.held;
      const kx = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
      const ky = (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0);
      if (kx) s.moveX = kx;
      if (ky) s.moveY = ky;
      if (h.has('cover')) s.cover = true;
      if (this.mouse.down) s.fire = true;
      if (origin && this.mouse.seen && (this.mouse.down || !s.aimX)) {
        const dx = this.mouse.x - origin.x;
        const dy = origin.y - this.mouse.y;
        const d = Math.hypot(dx, dy);
        // Aiming: the cursor away from the marine, while it moves or the button is down (a cursor
        // left lying about doesn't keep his gun up).
        if (d > 36 && (this.mouse.down || now - (this.mouse.movedAt ?? -1e9) < 2500)) { s.aimX = dx / d; s.aimY = dy / d; }
      }
    }
    return s;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
