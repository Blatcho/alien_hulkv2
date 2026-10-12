// Unified action input: merges keyboard and the first connected gamepad (Xbox layout via the
// standard mapping) into a single per-frame action state with edge detection. The gamepad is
// polled directly through navigator.getGamepads() so it works regardless of which Phaser scene
// is active and so rumble (vibrationActuator) is available.

export const ACTIONS = [
  'left', 'right', 'up', 'down',
  'jump', 'light', 'heavy', 'dodge', 'defend', 'potion', 'interact', 'pause', 'confirm', 'back',
];

// Standard gamepad button indices (Xbox labels).
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9,
  LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16,
};

const PAD_MAP = {
  jump: [PAD.A],
  light: [PAD.X],
  heavy: [PAD.Y],
  dodge: [PAD.B, PAD.RT],
  defend: [PAD.LT],
  potion: [PAD.RB],
  interact: [PAD.LB],
  pause: [PAD.START],
  confirm: [PAD.A],
  back: [PAD.B],
  up: [PAD.UP],
  down: [PAD.DOWN],
  left: [PAD.LEFT],
  right: [PAD.RIGHT],
};

const KEY_MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyW', 'ArrowUp'],
  light: ['KeyJ', 'KeyZ'],
  heavy: ['KeyK', 'KeyX'],
  dodge: ['KeyL', 'KeyC'],
  defend: ['ShiftLeft', 'ShiftRight', 'KeyI'],
  potion: ['KeyQ'],
  interact: ['KeyE'],
  pause: ['Escape', 'Enter', 'Tab'],
  confirm: ['Enter', 'Space', 'KeyJ'],
  back: ['Escape', 'Backspace', 'KeyK'],
};

export const DEADZONE = 0.22;

export function applyDeadzone(v, dz = DEADZONE) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * Math.min(1, (a - dz) / (1 - dz));
}

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.held = {};
    this.pressed = {};
    this.released = {};
    this.prevHeld = {};
    this.moveX = 0;
    this.moveY = 0;
    this.padConnected = false;
    this.padId = '';
    this.lastDevice = 'keyboard';
    this.lastFrame = -1;
    this.enabled = true;
    this.rumbleEnabled = true;
    this._pad = null;
    this.virtual = null;          // { moveX, moveY, actions: Set } supplied by the demo autopilot
    this.realActivity = false;    // true when a physical device produced input this frame
    for (const a of ACTIONS) { this.held[a] = false; this.pressed[a] = false; this.released[a] = false; this.prevHeld[a] = false; }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        this.keys.add(e.code);
        this.lastDevice = 'keyboard';
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
      window.addEventListener('blur', () => { this.keys.clear(); });
      window.addEventListener('gamepadconnected', (e) => { this.padConnected = true; this.padId = e.gamepad.id; });
      window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; this._pad = null; });
    }
  }

  getPad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return null; }
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }

  // Call once per game frame. `frame` guards against multiple active scenes updating twice.
  update(frame) {
    if (frame !== undefined && frame === this.lastFrame) return;
    this.lastFrame = frame;

    const pad = this.getPad();
    this._pad = pad;
    this.padConnected = !!pad;
    if (pad) this.padId = pad.id;

    let mx = 0, my = 0;
    const raw = {};
    for (const a of ACTIONS) raw[a] = false;
    this.realActivity = this.keys.size > 0;

    if (this.enabled) {
      for (const a of ACTIONS) {
        for (const code of KEY_MAP[a]) if (this.keys.has(code)) { raw[a] = true; break; }
      }
      if (pad) {
        let padActive = false;
        for (const a of ACTIONS) {
          const idx = PAD_MAP[a];
          if (!idx) continue;
          for (const i of idx) {
            const b = pad.buttons[i];
            if (b && (b.pressed || b.value > 0.5)) { raw[a] = true; padActive = true; }
          }
        }
        const ax = applyDeadzone(pad.axes[0] || 0);
        const ay = applyDeadzone(pad.axes[1] || 0);
        if (ax !== 0 || ay !== 0) padActive = true;
        mx += ax; my += ay;
        if (padActive) { this.lastDevice = 'gamepad'; this.realActivity = true; }
      }
      if (this.virtual) {
        for (const a of this.virtual.actions || []) raw[a] = true;
        mx += this.virtual.moveX || 0; my += this.virtual.moveY || 0;
      }
    }

    if (raw.left) mx -= 1;
    if (raw.right) mx += 1;
    if (raw.up) my -= 1;
    if (raw.down) my += 1;
    this.moveX = Math.max(-1, Math.min(1, mx));
    this.moveY = Math.max(-1, Math.min(1, my));
    // Stick pushed sideways counts as the directional actions too (menus, ledge drop).
    if (this.moveX < -0.5) raw.left = true;
    if (this.moveX > 0.5) raw.right = true;
    if (this.moveY < -0.5) raw.up = true;
    if (this.moveY > 0.5) raw.down = true;

    for (const a of ACTIONS) {
      this.prevHeld[a] = this.held[a];
      this.held[a] = raw[a];
      this.pressed[a] = raw[a] && !this.prevHeld[a];
      this.released[a] = !raw[a] && this.prevHeld[a];
    }
  }

  // Consume a press so other scenes/systems in the same frame do not see it.
  consume(action) { this.pressed[action] = false; }

  rumble(strong = 0.5, weak = 0.5, duration = 120) {
    if (!this.rumbleEnabled) return;
    const pad = this._pad || this.getPad();
    if (!pad) return;
    const act = pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]);
    if (!act) return;
    try {
      if (act.playEffect) {
        act.playEffect('dual-rumble', { startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak });
      } else if (act.pulse) {
        act.pulse(Math.max(strong, weak), duration);
      }
    } catch (e) { /* unsupported */ }
  }
}

let shared = null;
export function getInput() {
  if (!shared) shared = new InputManager();
  return shared;
}

// Human-readable prompt glyphs for the current device.
export function promptFor(action, device) {
  const pad = { jump: 'A', light: 'X', heavy: 'Y', dodge: 'B', defend: 'LT', potion: 'RB', interact: 'LB', pause: 'Start', confirm: 'A', back: 'B' };
  const key = { jump: 'Space', light: 'J', heavy: 'K', dodge: 'L', defend: 'Shift', potion: 'Q', interact: 'E', pause: 'Esc', confirm: 'Enter', back: 'Esc' };
  return (device === 'gamepad' ? pad : key)[action] || action;
}
