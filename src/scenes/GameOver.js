import { WIDTH, HEIGHT } from '../config.js';
import { getInput } from '../input/Input.js';

// Game over overlay (scene key 'GameOver'), launched over the (paused) Game scene when the
// player dies. "Rise again" emits 'restart-checkpoint' on the Game scene and resumes it;
// "Quit to title" tears Game/HUD down and returns to the Title scene.

const TEXT = 0xd8d0c0;
const OPTIONS = [
  { key: 'rise', label: 'Rise again (last checkpoint)' },
  { key: 'quit', label: 'Quit to title' },
];

export default class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create() {
    this.input_ = getInput();
    this.sel = 0;
    this.done = false;
    this.ready = false;
    this.repeat = { dir: 0, t: 0 };

    this.overlay = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x05030a, 0).setOrigin(0);
    this.tweens.add({ targets: this.overlay, fillAlpha: 0.72, duration: 1200 });
    const blood = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x600000, 0).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.tweens.add({ targets: blood, fillAlpha: 0.5, duration: 900 });

    this.title = this.add.bitmapText(WIDTH / 2, HEIGHT * 0.36, 'title', 'YOU HAVE FALLEN', 68).setOrigin(0.5).setTint(0xb02020).setAlpha(0).setScale(1.1);
    this.tweens.add({ targets: this.title, alpha: 1, scaleX: 1, scaleY: 1, duration: 1100, delay: 300, ease: 'Quad.easeOut' });
    const g = this.scene.get('Game');
    const p = g && g.player;
    const sub = p ? `Souls lost on the moor   -   ${p.kills || 0} slain   -   ${p.gold || 0} gold` : 'The moor keeps its dead';
    this.sub = this.add.bitmapText(WIDTH / 2, HEIGHT * 0.36 + 60, 'small', sub, 16).setOrigin(0.5).setTint(0x8a7a7a).setAlpha(0);
    this.tweens.add({ targets: this.sub, alpha: 1, duration: 800, delay: 900 });

    const oy = HEIGHT * 0.6;
    this.optionTexts = OPTIONS.map((o, i) => this.add.bitmapText(WIDTH / 2, oy + i * 44, 'body', o.label, 24).setOrigin(0.5).setTint(TEXT).setAlpha(0));
    this.cursorL = this.add.image(0, 0, 'ui_cursor').setOrigin(21 / 24, 0.5).setAlpha(0);
    this.cursorR = this.add.image(0, 0, 'ui_cursor').setOrigin(21 / 24, 0.5).setFlipX(true).setAlpha(0);
    this.legend = this.add.bitmapText(WIDTH / 2, HEIGHT - 48, 'small', '', 16).setOrigin(0.5).setTint(0x6f6a60).setAlpha(0);
    this.tweens.add({ targets: [...this.optionTexts, this.cursorL, this.cursorR, this.legend], alpha: 1, duration: 500, delay: 1400, onComplete: () => { this.ready = true; } });
    this.placeCursor();
    this.time.delayedCall(1400, () => { this.ready = true; });
  }

  sfx(key, opts) {
    const g = this.scene.get('Game');
    if (g && g.audio && g.audio.play) g.audio.play(key, opts);
  }

  placeCursor() {
    for (let i = 0; i < this.optionTexts.length; i++) {
      this.optionTexts[i].setTint(i === this.sel ? 0xf0e0b0 : TEXT).setScale(i === this.sel ? 1.08 : 1);
    }
    const t = this.optionTexts[this.sel];
    const half = t.width * 0.54 + 24;
    this.cursorL.setPosition(t.x - half, t.y);
    this.cursorR.setPosition(t.x + half, t.y);
  }

  choose() {
    if (this.done) return;
    this.done = true;
    const o = OPTIONS[this.sel];
    this.sfx('sfx_ui_confirm');
    if (o.key === 'rise') {
      this.cameras.main.fadeOut(350, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const g = this.scene.get('Game');
        if (g && g.events) g.events.emit('restart-checkpoint');
        this.scene.resume('Game');
        this.scene.stop();
      });
    } else {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const g = this.scene.get('Game');
        if (g && g.audio && g.audio.music) { try { g.audio.music.stop(); } catch (e) { /* ignore */ } }
        try { this.game.sound.stopAll(); } catch (e) { /* ignore */ }
        for (const k of ['HUD', 'Pause']) if (this.scene.isActive(k) || this.scene.isPaused(k)) this.scene.stop(k);
        this.scene.stop('Game');
        this.scene.start('Title');
      });
    }
  }

  update(time, delta) {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    const dev = inp.lastDevice;
    this.legend.setText(dev === 'gamepad' ? 'Up/Down choose   -   A confirm' : 'Up/Down choose   -   Enter confirm');
    if (this.done || !this.ready) return;
    let dy = 0;
    if (inp.pressed.up) { dy = -1; inp.consume('up'); inp.consume('jump'); }
    if (inp.pressed.down) { dy = 1; inp.consume('down'); }
    const heldDir = inp.held.up ? -1 : inp.held.down ? 1 : 0;
    if (heldDir && heldDir === this.repeat.dir && !dy) {
      this.repeat.t += delta;
      if (this.repeat.t > 380) { dy = heldDir; this.repeat.t = 270; }
    } else { this.repeat.dir = heldDir; this.repeat.t = 0; }
    if (dy) {
      this.sel = (this.sel + dy + OPTIONS.length) % OPTIONS.length;
      this.placeCursor();
      this.sfx('sfx_ui_move', { volume: 0.6 });
      inp.consume('confirm');
      return;
    }
    if (inp.pressed.confirm || (inp.pressed.pause && !inp.pressed.back)) {
      inp.consume('confirm'); inp.consume('pause'); inp.consume('jump');
      this.choose();
    }
  }
}
