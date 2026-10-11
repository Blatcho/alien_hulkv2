import { WIDTH, HEIGHT, DEPTH } from '../config.js';
import { getInput, promptFor } from '../input/Input.js';
import Parallax from '../systems/Parallax.js';
import AudioSystem from '../systems/Audio.js';
import Stats from '../systems/Stats.js';

// Title screen: slow auto-scrolling Thornmoor parallax, bitmap-font title with a glow copy,
// menu (Begin the Hunt / Continue / Controls) navigated with up/down + confirm/back.
// Start on the pad (or Enter) activates the highlighted row, which defaults to Begin the Hunt.

const SAVE_KEY = 'botm_save';
const UI = DEPTH.hud + 10;
const TEXT = 0xd8d0c0;
const DIM = 0x7a7468;

const CONTROLS = [
  { action: 'Move', glyph: null, pad: 'Left stick / D-pad', key: 'A / D or Arrows' },
  { action: 'Jump', glyph: 'ui_button_a', pad: 'A', key: 'Space / W' },
  { action: 'Light attack (combo)', glyph: 'ui_button_x', pad: 'X', key: 'J' },
  { action: 'Heavy attack (hold)', glyph: 'ui_button_y', pad: 'Y', key: 'K' },
  { action: 'Dodge roll', glyph: 'ui_button_b', pad: 'B', key: 'L / Shift' },
  { action: 'Use potion', glyph: 'ui_button_rb', pad: 'RB', key: 'Q' },
  { action: 'Interact', glyph: 'ui_button_lb', pad: 'LB', key: 'E' },
  { action: 'Pause / inventory', glyph: 'ui_button_start', pad: 'Start', key: 'Esc / Enter' },
];

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    return save && typeof save === 'object' ? save : null;
  } catch (e) { return null; }
}

export default class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.input_ = getInput();
    this.audio = new AudioSystem(this);
    this.started = false;
    this.controlsOpen = false;
    this.sel = 0;
    this.repeat = { dir: 0, t: 0 };

    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x0a0c14).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.bgFar - 1);
    const meta = this.cache.json.get('bg_layers');
    this.parallax = meta && meta.thornmoor ? new Parallax(this, 'thornmoor', meta.thornmoor) : null;
    this.cameras.main.scrollX = 0;
    // dark wash so the title reads over the scenery
    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x05060a, 0.35).setOrigin(0).setScrollFactor(0).setDepth(UI - 2);

    // title with a soft glow copy behind it
    const ty = HEIGHT * 0.3;
    this.titleGlow = this.add.bitmapText(WIDTH / 2, ty, 'title', 'BEAST OF THORNMOOR', 72).setOrigin(0.5).setScrollFactor(0)
      .setDepth(UI).setTint(0xff9040).setAlpha(0.3).setScale(1.015);
    this.title = this.add.bitmapText(WIDTH / 2, ty, 'title', 'BEAST OF THORNMOOR', 72).setOrigin(0.5).setScrollFactor(0)
      .setDepth(UI + 1).setTint(0xe8d8b0);
    this.tweens.add({ targets: this.titleGlow, alpha: 0.5, scaleX: 1.03, scaleY: 1.03, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.bitmapText(WIDTH / 2, ty + 58, 'small', 'A hunt through the moor, the graves and the black gate', 16)
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI + 1).setTint(0x9a8a70);

    // menu
    this.save = readSave();
    this.items = [{ key: 'begin', label: 'Begin the Hunt' }];
    if (this.save) this.items.push({ key: 'continue', label: 'Continue' });
    this.items.push({ key: 'controls', label: 'Controls' });
    const my = HEIGHT * 0.56;
    this.menuTexts = this.items.map((it, i) => this.add.bitmapText(WIDTH / 2, my + i * 44, 'body', it.label, 26)
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI + 1));
    this.cursorL = this.add.image(0, 0, 'ui_cursor').setScrollFactor(0).setDepth(UI + 1).setOrigin(21 / 24, 0.5);
    this.cursorR = this.add.image(0, 0, 'ui_cursor').setScrollFactor(0).setDepth(UI + 1).setOrigin(21 / 24, 0.5).setFlipX(true);
    this.saveLine = this.add.bitmapText(WIDTH / 2, my + this.items.length * 44 + 4, 'small', '', 14)
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI + 1).setTint(DIM);
    if (this.save) {
      const lvl = this.save.stats && this.save.stats.level ? this.save.stats.level : 1;
      this.saveLine.setText(`Continue: level ${lvl}, ${this.save.zone || 'thornmoor'}`);
    }

    this.prompt = this.add.bitmapText(WIDTH / 2, HEIGHT - 92, 'body', '', 20).setOrigin(0.5).setScrollFactor(0).setDepth(UI + 1).setTint(0xb8b0a0);
    this.tweens.add({ targets: this.prompt, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 });
    this.padText = this.add.bitmapText(WIDTH / 2, HEIGHT - 40, 'small', '', 16).setOrigin(0.5).setScrollFactor(0).setDepth(UI + 1).setTint(0x6f6a60);

    this.buildControls();
    this.placeCursor();
    this.cameras.main.fadeIn(600, 0, 0, 0);
    this.audio.playMusic('music_title', { fade: 1500 });
    this.events.once('shutdown', () => { if (this.parallax) { this.parallax.destroy(); this.parallax = null; } });
  }

  buildControls() {
    const w = 760, h = 470;
    const c = this.add.container(WIDTH / 2, HEIGHT / 2).setScrollFactor(0).setDepth(UI + 5).setVisible(false).setAlpha(0);
    c.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.55));
    c.add(this.add.nineslice(0, 0, 'ui_panel', undefined, w, h, 24, 24, 24, 24));
    c.add(this.add.bitmapText(0, -h / 2 + 34, 'title', 'CONTROLS', 32).setOrigin(0.5).setTint(0xd8c7a0));
    const left = -w / 2 + 44;
    c.add(this.add.bitmapText(left, -h / 2 + 74, 'small', 'ACTION', 16).setTint(0x9a8a70));
    c.add(this.add.bitmapText(left + 300, -h / 2 + 74, 'small', 'XBOX PAD', 16).setTint(0x9a8a70));
    c.add(this.add.bitmapText(left + 520, -h / 2 + 74, 'small', 'KEYBOARD', 16).setTint(0x9a8a70));
    c.add(this.add.rectangle(left, -h / 2 + 96, w - 88, 1, 0x3a3444).setOrigin(0, 0.5));
    let y = -h / 2 + 122;
    for (const row of CONTROLS) {
      c.add(this.add.bitmapText(left, y, 'body', row.action, 18).setOrigin(0, 0.5).setTint(TEXT));
      let px = left + 300;
      if (row.glyph && this.textures.exists(row.glyph)) { c.add(this.add.image(px + 14, y, row.glyph)); px += 36; }
      c.add(this.add.bitmapText(px, y, 'body', row.pad, 18).setOrigin(0, 0.5).setTint(row.glyph ? DIM : TEXT));
      c.add(this.add.bitmapText(left + 520, y, 'body', row.key, 18).setOrigin(0, 0.5).setTint(TEXT));
      y += 38;
    }
    const ly = h / 2 - 30;
    let lx = left;
    const legend = (tex, text) => {
      if (this.textures.exists(tex)) { c.add(this.add.image(lx + 14, ly, tex)); lx += 34; }
      const t = this.add.bitmapText(lx, ly, 'small', text, 16).setOrigin(0, 0.5).setTint(0x9a8a70);
      c.add(t); lx += t.width + 36;
    };
    legend('ui_button_b', 'Back (Esc)');
    legend('ui_button_a', 'Close (Enter)');
    this.controlsPanel = c;
  }

  placeCursor() {
    const t = this.menuTexts[this.sel];
    for (let i = 0; i < this.menuTexts.length; i++) {
      this.menuTexts[i].setTint(i === this.sel ? 0xf0e0b0 : TEXT).setScale(i === this.sel ? 1.08 : 1).setAlpha(i === this.sel ? 1 : 0.75);
    }
    const half = t.width * 0.54 + 24;
    this.cursorL.setPosition(t.x - half, t.y);
    this.cursorR.setPosition(t.x + half, t.y);
  }

  sfx(key, opts) { this.audio.play(key, opts); }

  openControls() {
    this.controlsOpen = true;
    this.controlsPanel.setVisible(true);
    this.tweens.killTweensOf(this.controlsPanel);
    this.tweens.add({ targets: this.controlsPanel, alpha: 1, duration: 180 });
    this.sfx('sfx_ui_confirm');
  }

  closeControls() {
    this.controlsOpen = false;
    this.tweens.killTweensOf(this.controlsPanel);
    this.tweens.add({ targets: this.controlsPanel, alpha: 0, duration: 160, onComplete: () => this.controlsPanel.setVisible(false) });
    this.sfx('sfx_ui_back');
  }

  activate() {
    const it = this.items[this.sel];
    if (!it) return;
    if (it.key === 'controls') { this.openControls(); return; }
    if (it.key === 'continue') { this.startGame(this.save); return; }
    this.startGame(null);
  }

  startGame(save) {
    if (this.started) return;
    this.started = true;
    this.sfx('sfx_ui_confirm');
    const music = this.audio.music;
    this.audio.stopMusic(380);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (music) { try { music.stop(); } catch (e) { /* already stopped */ } }
      let data;
      if (save) {
        let stats;
        try { stats = new Stats(save.stats); } catch (e) { stats = new Stats(); }
        data = { zone: save.zone || 'thornmoor', stats, save };
      } else {
        data = { zone: 'thornmoor', stats: new Stats() };
      }
      this.scene.start('Game', data);
      this.scene.launch('HUD');
    });
  }

  update(time, delta) {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    const dev = inp.lastDevice;
    if (this.parallax) {
      this.cameras.main.scrollX += delta * 0.04;
      this.parallax.update(time, delta);
    }
    this.prompt.setText(dev === 'gamepad' ? 'Press START to begin   -   A select' : 'Press ENTER to begin   -   Arrows / W S navigate');
    this.padText.setText(inp.padConnected ? `Controller: ${inp.padId}`.slice(0, 90) : 'No controller detected - keyboard: A/D move, Space jump, J/K attack, L dodge, Q potion');
    if (this.started) return;

    if (this.controlsOpen) {
      if (inp.pressed.back || inp.pressed.confirm || inp.pressed.pause) {
        inp.consume('back'); inp.consume('confirm'); inp.consume('pause'); inp.consume('jump');
        this.closeControls();
      }
      return;
    }

    // Esc maps to both 'pause' and 'back': on the menu it does nothing rather than starting the game
    if (inp.pressed.pause && inp.pressed.back) { inp.consume('pause'); inp.consume('back'); return; }
    let dy = 0;
    if (inp.pressed.up) { dy = -1; inp.consume('up'); }
    if (inp.pressed.down) { dy = 1; inp.consume('down'); }
    const heldDir = inp.held.up ? -1 : inp.held.down ? 1 : 0;
    if (heldDir && heldDir === this.repeat.dir && !dy) {
      this.repeat.t += delta;
      if (this.repeat.t > 380) { dy = heldDir; this.repeat.t = 270; }
    } else { this.repeat.dir = heldDir; this.repeat.t = 0; }
    if (dy) {
      this.sel = (this.sel + dy + this.items.length) % this.items.length;
      this.placeCursor();
      this.sfx('sfx_ui_move', { volume: 0.6 });
      // W / ArrowUp are also 'jump'; do not let them start the game
      inp.consume('jump'); inp.consume('confirm');
      return;
    }
    // confirm (A / Enter) activates the highlighted row; Start (or Enter via 'pause') does the same,
    // which keeps the classic "press START" behaviour since the first row is Begin the Hunt.
    if (inp.pressed.confirm || inp.pressed.pause || (inp.pressed.jump && dev === 'gamepad')) {
      inp.consume('confirm'); inp.consume('pause'); inp.consume('jump');
      this.activate();
    }
  }
}
