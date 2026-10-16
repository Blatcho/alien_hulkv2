// Controller first (standard gamepad mapping), keyboard + mouse as the fallback, plus a virtual
// source the autopilot writes into for the demo. Everything the game reads is on `state`.
//   left stick   move (x, y)        right stick  aim          LT shield     RT fire
//   A jump       B dodge back       Y weapon     X interact   RB reload     LB medkit
//   start pause  back toggles demo
// Keyboard: WASD / arrows move, mouse aims, Shift shield, Mouse1 / J fire, Space jump, K dodge,
// Q weapon, E interact, R reload, H medkit, Esc pause, F1 demo.
const DEAD = 0.22;

function dz(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * (a - DEAD) / (1 - DEAD);
}

const BUTTONS = ['jump', 'dodge', 'interact', 'weapon', 'medkit', 'reload', 'pause', 'demo', 'confirm', 'back'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.tapped = new Set();                 // keys pressed since the last poll (a tap shorter than a frame still counts)
    this.mouse = { x: 0, y: 0, down: false, right: false, moved: 0 };
    this.state = this.blank();
    this.prev = this.blank();
    this.virtual = null;                     // set by the autopilot: same shape as state
    this.lastHuman = -1e9;                   // performance.now() of the last real input
    this.source = 'keys';
    this.padIndex = -1;
    this.scale = 1;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.tapped.add(e.code);
      this.lastHuman = performance.now(); this.source = 'keys';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / this.scale; this.mouse.y = (e.clientY - r.top) / this.scale;
      this.mouse.moved = performance.now();
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.right = true;
      this.lastHuman = performance.now(); this.source = 'keys';
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; if (e.button === 2) this.mouse.right = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
  }

  blank() {
    const s = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, aiming: false, fire: 0, shield: 0, mouseAim: false };
    for (const b of BUTTONS) s[b] = false;
    return s;
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  poll() {
    const prev = this.state;
    const s = this.blank();
    const p = this.pad();
    if (p) {
      const b = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
      const v = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      s.moveX = dz(p.axes[0] || 0); s.moveY = -dz(p.axes[1] || 0);
      s.aimX = dz(p.axes[2] || 0); s.aimY = -dz(p.axes[3] || 0);
      s.aiming = Math.hypot(s.aimX, s.aimY) > 0.2;
      s.fire = Math.max(v(7), b(7) ? 1 : 0); s.shield = Math.max(v(6), b(6) ? 1 : 0);
      s.jump = b(0); s.dodge = b(1); s.interact = b(2); s.weapon = b(3);
      s.medkit = b(4); s.reload = b(5); s.pause = b(9); s.demo = b(8);
      s.confirm = b(0) || b(9); s.back = b(1);
      // d-pad as movement too
      if (b(14)) s.moveX = -1; if (b(15)) s.moveX = 1; if (b(12)) s.moveY = 1; if (b(13)) s.moveY = -1;
      const active = Math.abs(s.moveX) + Math.abs(s.moveY) + Math.abs(s.aimX) + Math.abs(s.aimY) + s.fire + s.shield > 0.1 ||
        BUTTONS.some((k) => s[k]);
      if (active) { this.lastHuman = performance.now(); this.source = 'pad'; }
    }
    const k = (c) => this.keys.has(c) || this.tapped.has(c);
    if (k('KeyA') || k('ArrowLeft')) s.moveX = -1;
    if (k('KeyD') || k('ArrowRight')) s.moveX = 1;
    if (k('KeyW') || k('ArrowUp')) s.moveY = 1;
    if (k('KeyS') || k('ArrowDown')) s.moveY = -1;
    if (k('ShiftLeft') || k('ShiftRight')) s.shield = 1;
    if (this.mouse.down || this.mouse.clicked || k('KeyJ')) s.fire = 1;
    if (this.mouse.right) s.shield = 1;
    if (k('Space')) s.jump = true;
    if (k('KeyK')) s.dodge = true;
    if (k('KeyQ')) s.weapon = true;
    if (k('KeyE')) s.interact = true;
    if (k('KeyR')) s.reload = true;
    if (k('KeyH')) s.medkit = true;
    if (k('Escape')) s.pause = true;
    if (k('F1')) s.demo = true;
    if (k('Enter') || k('Space')) s.confirm = true;
    if (k('Backspace')) s.back = true;
    if (performance.now() - this.mouse.moved < 4000 && !(p && s.aiming)) s.mouseAim = true;
    if (this.virtual) {
      const v = this.virtual;
      for (const key of Object.keys(s)) if (v[key] !== undefined && (typeof v[key] === 'number' ? Math.abs(v[key]) > 0 : v[key])) s[key] = v[key];
      if (v.aiming) s.mouseAim = false;
    }
    s.mouse = this.mouse;
    this.tapped.clear(); this.mouse.clicked = false;
    // edges
    for (const bname of BUTTONS) s[bname + 'Pressed'] = s[bname] && !prev[bname];
    this.state = s;
    return s;
  }

  humanIdleFor() { return performance.now() - this.lastHuman; }
}
