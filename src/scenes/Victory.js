import { WIDTH, HEIGHT } from '../config.js';
import { getInput } from '../input/Input.js';
import AudioSystem from '../systems/Audio.js';

// Victory screen (scene key 'Victory'), launched over the Game scene after the Gate Warden
// falls. Shows kills / gold / level from Game's player, plays 'music_victory' and returns to the
// Title scene on confirm.

export default class VictoryScene extends Phaser.Scene {
  constructor() { super('Victory'); }

  create() {
    this.input_ = getInput();
    this.audio = new AudioSystem(this);
    this.done = false;
    this.ready = false;

    const g = this.scene.get('Game');
    const p = g && g.player;
    const stats = p && p.stats ? p.stats : null;
    if (g && g.audio && g.audio.stopMusic) { try { g.audio.stopMusic(1200); } catch (e) { /* ignore */ } }
    this.audio.playMusic('music_victory', { fade: 2000, loop: true });

    this.overlay = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x06060c, 0).setOrigin(0);
    this.tweens.add({ targets: this.overlay, fillAlpha: 0.7, duration: 1600 });
    const glow = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0xffd080, 0).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: glow, fillAlpha: 0.35, duration: 500, yoyo: true, hold: 200 });

    const ty = HEIGHT * 0.3;
    this.titleGlow = this.add.bitmapText(WIDTH / 2, ty, 'title', 'THE WARDEN IS SLAIN', 64).setOrigin(0.5).setTint(0xffa030).setAlpha(0).setScale(1.02);
    this.title = this.add.bitmapText(WIDTH / 2, ty, 'title', 'THE WARDEN IS SLAIN', 64).setOrigin(0.5).setTint(0xf0e0b0).setAlpha(0).setScale(1.12);
    this.tweens.add({ targets: this.title, alpha: 1, scaleX: 1, scaleY: 1, duration: 1300, delay: 400, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: this.titleGlow, alpha: 0.35, duration: 1300, delay: 400 });
    this.tweens.add({ targets: this.titleGlow, scaleX: 1.035, scaleY: 1.035, duration: 2400, delay: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.line = this.add.rectangle(WIDTH / 2, ty + 50, 520, 2, 0xd8c7a0).setAlpha(0).setScale(0, 1);
    this.tweens.add({ targets: this.line, alpha: 0.8, scaleX: 1, duration: 900, delay: 900, ease: 'Cubic.easeOut' });
    this.sub = this.add.bitmapText(WIDTH / 2, ty + 78, 'small', 'The black gate stands open and the moor is quiet at last', 16).setOrigin(0.5).setTint(0x9a8a70).setAlpha(0);
    this.tweens.add({ targets: this.sub, alpha: 1, duration: 800, delay: 1200 });

    // summary
    const rows = [
      ['Level', stats ? String(stats.level) : '-'],
      ['Foes slain', p ? String(p.kills || 0) : '-'],
      ['Gold', p ? String(p.gold || 0) : '-'],
      ['Potions left', p ? String(p.potions || 0) : '-'],
    ];
    let y = HEIGHT * 0.5;
    this.summary = [];
    for (const [label, value] of rows) {
      const l = this.add.bitmapText(WIDTH / 2 - 30, y, 'body', label, 22).setOrigin(1, 0.5).setTint(0x9a8a70).setAlpha(0);
      const v = this.add.bitmapText(WIDTH / 2 + 30, y, 'body', value, 22).setOrigin(0, 0.5).setTint(0xf0e0b0).setAlpha(0);
      this.summary.push(l, v);
      y += 36;
    }
    this.summary.forEach((t, i) => this.tweens.add({ targets: t, alpha: 1, duration: 500, delay: 1400 + Math.floor(i / 2) * 220 }));

    this.prompt = this.add.bitmapText(WIDTH / 2, HEIGHT - 72, 'body', '', 20).setOrigin(0.5).setTint(0xb8b0a0).setAlpha(0);
    this.tweens.add({ targets: this.prompt, alpha: 1, duration: 600, delay: 2600, onComplete: () => {
      this.ready = true;
      this.tweens.add({ targets: this.prompt, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 });
    } });
    this.time.delayedCall(2600, () => { this.ready = true; });
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const g = this.scene.get('Game');
    if (g && g.audio && g.audio.play) g.audio.play('sfx_ui_confirm');
    const music = this.audio.music;
    this.audio.stopMusic(700);
    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (music) { try { music.stop(); } catch (e) { /* ignore */ } }
      try { this.game.sound.stopAll(); } catch (e) { /* ignore */ }
      for (const k of ['HUD', 'Pause', 'GameOver']) if (this.scene.isActive(k) || this.scene.isPaused(k)) this.scene.stop(k);
      if (this.scene.isActive('Game') || this.scene.isPaused('Game')) this.scene.stop('Game');
      this.scene.start('Title');
    });
  }

  update() {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    this.prompt.setText(inp.lastDevice === 'gamepad' ? 'Press A to return to the title' : 'Press ENTER to return to the title');
    if (this.done || !this.ready) return;
    if (inp.pressed.confirm || inp.pressed.pause || inp.pressed.jump) {
      inp.consume('confirm'); inp.consume('pause'); inp.consume('jump');
      this.finish();
    }
  }
}
