import { WIDTH, HEIGHT } from '../config.js';
import { getInput, promptFor } from '../input/Input.js';

// Overlay scene (key 'HUD'), launched in parallel with 'Game'. Draws bars, gold, souls/XP, the
// potion slot, a boss bar, toasts and zone banners. Reads game.player every frame and listens to
// the Game scene's event emitter:
//   'player-hurt' (dmg)   'player-heal' (amount)   'levelup' (level)   'gold' (amount)
//   'toast' (text, ms)    'zone-title' (text)      'boss-start' (name, getter)   'boss-end'

// Inner windows of the bar frames (assets/ui/ui.json).
const HP_INNER = { x: 8, y: 8, w: 300, h: 18 };
const ST_INNER = { x: 8, y: 8, w: 220, h: 12 };
const HP_POS = { x: 96, y: 30 };
const ST_POS = { x: 96, y: 66 };

const lerp = (a, b, t) => a + (b - a) * t;

export default class HUDScene extends Phaser.Scene {
  constructor() { super('HUD'); }

  create() {
    this.input_ = getInput();
    this.boundGame = null;
    this.debug = typeof location !== 'undefined' && /debug/.test(location.search || '');

    // --- emblem + bars -------------------------------------------------------------------
    this.add.image(52, 52, 'ui_emblem');
    this.hp = this.makeBar(HP_POS, HP_INNER, 'ui_bar_frame_hp', 0xc0201a, 0x4a0c0c);
    this.st = this.makeBar(ST_POS, ST_INNER, 'ui_bar_frame_stamina', 0x4caf50, 0x0c2a10);

    // --- gold (top-right) ----------------------------------------------------------------
    this.goldText = this.add.bitmapText(WIDTH - 60, 34, 'body', '0', 26).setOrigin(1, 0.5).setTint(0xe8c868);
    if (this.textures.exists('prop_coin')) {
      this.coin = this.add.image(WIDTH - 36, 34, 'prop_coin', 0).setScale(0.8);
    } else {
      this.coin = this.add.circle(WIDTH - 36, 34, 10, 0xe0b040).setStrokeStyle(2, 0x6a4a10);
    }
    this.goldShown = 0;

    // --- souls / XP (bottom-right) -------------------------------------------------------
    this.levelText = this.add.bitmapText(WIDTH - 24, HEIGHT - 46, 'body', 'LV 1', 24).setOrigin(1, 1).setTint(0xb8a8e0);
    this.xpLabel = this.add.bitmapText(WIDTH - 248, HEIGHT - 46, 'small', 'SOULS', 16).setOrigin(0, 1).setTint(0x8a7ab0);
    this.xpBg = this.add.rectangle(WIDTH - 248, HEIGHT - 36, 224, 10, 0x0c0a14).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a3050);
    this.xpFill = this.add.rectangle(WIDTH - 246, HEIGHT - 36, 0, 6, 0x9a60e0).setOrigin(0, 0.5);
    this.xpText = this.add.bitmapText(WIDTH - 24, HEIGHT - 22, 'small', '', 14).setOrigin(1, 0.5).setTint(0x7a6a9a);
    this.xpShown = 0;

    // --- potion slot (bottom-left) -------------------------------------------------------
    this.seedText = this.add.bitmapText(WIDTH / 2, HEIGHT - 14, 'small', '', 12).setOrigin(0.5, 1).setTint(0x6a6a7a).setAlpha(0.8);
    this.slot = this.add.image(52, HEIGHT - 52, 'ui_slot');
    if (this.textures.exists('prop_potion_red')) this.potionImg = this.add.image(52, HEIGHT - 52, 'prop_potion_red', 0).setScale(0.9);
    else this.potionImg = this.add.ellipse(52, HEIGHT - 52, 20, 30, 0xc02030);
    this.potionCount = this.add.bitmapText(74, HEIGHT - 30, 'small', '3', 16).setOrigin(1, 1);
    this.promptGlyph = this.add.image(98, HEIGHT - 36, 'ui_key');
    this.promptLetter = this.add.bitmapText(98, HEIGHT - 37, 'small', 'Q', 14).setOrigin(0.5).setTint(0x202028);
    this.promptDevice = '';

    // --- boss bar (top centre) -----------------------------------------------------------
    this.bossGetter = null;
    const bw = 620, bx = WIDTH / 2 - bw / 2, by = 64;
    this.boss = this.add.container(0, 0).setAlpha(0).setVisible(false);
    this.bossName = this.add.bitmapText(WIDTH / 2, 38, 'body', '', 24).setOrigin(0.5).setTint(0xe0c8c8);
    this.bossBg = this.add.rectangle(bx, by, bw, 16, 0x120608).setOrigin(0, 0.5).setStrokeStyle(2, 0x5a2020);
    this.bossGhost = this.add.rectangle(bx + 2, by, bw - 4, 10, 0xf0e0e0).setOrigin(0, 0.5);
    this.bossFill = this.add.rectangle(bx + 2, by, bw - 4, 10, 0xa01818).setOrigin(0, 0.5);
    this.boss.add([this.bossBg, this.bossGhost, this.bossFill, this.bossName]);
    this.bossW = bw - 4;
    this.bossShown = 1; this.bossGhostShown = 1; this.bossGhostDelay = 0;

    // --- toasts and banners --------------------------------------------------------------
    this.toastText = this.add.bitmapText(WIDTH / 2, HEIGHT * 0.74, 'body', '', 24).setOrigin(0.5).setAlpha(0);
    this.toastTimer = null;
    this.bannerText = this.add.bitmapText(WIDTH / 2, HEIGHT * 0.38, 'title', '', 64).setOrigin(0.5).setAlpha(0);
    this.bannerLine = this.add.rectangle(WIDTH / 2, HEIGHT * 0.38 + 48, 10, 2, 0xd8c7a0).setAlpha(0).setScale(0, 1);

    // --- debug ---------------------------------------------------------------------------
    if (this.debug) this.debugText = this.add.text(16, HEIGHT - 110, '', { fontFamily: 'monospace', fontSize: '14px', color: '#8a8a8a' });

    this.events.once('shutdown', () => this.unbind());
    this.bindGame();
  }

  // ------------------------------------------------------------------------------ helpers
  makeBar(pos, inner, frameKey, fillColor, bgColor) {
    const x = pos.x + inner.x, y = pos.y + inner.y;
    const bg = this.add.rectangle(x, y, inner.w, inner.h, bgColor).setOrigin(0);
    const ghost = this.add.rectangle(x, y, inner.w, inner.h, 0xf4f0e8).setOrigin(0);
    const fill = this.add.rectangle(x, y, inner.w, inner.h, fillColor).setOrigin(0);
    const shine = this.add.rectangle(x, y, inner.w, Math.max(2, Math.floor(inner.h * 0.35)), 0xffffff, 0.14).setOrigin(0);
    const frame = this.add.image(pos.x, pos.y, frameKey).setOrigin(0);
    return { bg, ghost, fill, shine, frame, inner, shown: 1, ghostShown: 1, ghostDelay: 0, target: 1 };
  }

  updateBar(bar, frac, dt) {
    const t = Math.max(0, Math.min(1, frac));
    const k = 1 - Math.pow(0.0005, dt / 1000); // smooth lerp, frame-rate independent
    if (t < bar.shown) bar.shown = lerp(bar.shown, t, Math.min(1, k * 1.6));
    else bar.shown = lerp(bar.shown, t, Math.min(1, k * 0.7));
    if (Math.abs(bar.shown - t) < 0.002) bar.shown = t;
    // ghost: holds for a moment after damage, then drains; snaps up on heal
    if (t >= bar.ghostShown) { bar.ghostShown = t; bar.ghostDelay = 0; }
    else if (bar.ghostDelay > 0) bar.ghostDelay -= dt;
    else bar.ghostShown = Math.max(t, bar.ghostShown - dt / 650);
    bar.fill.width = Math.round(bar.inner.w * bar.shown);
    bar.shine.width = bar.fill.width;
    bar.ghost.width = Math.round(bar.inner.w * bar.ghostShown);
    bar.ghost.setVisible(bar.ghostShown > bar.shown + 0.001);
  }

  bindGame() {
    const g = this.scene.get('Game');
    if (!g || !g.events || this.boundGame === g) return;
    this.unbind();
    this.boundGame = g;
    this.handlers = {
      'player-hurt': (dmg) => this.onHurt(dmg),
      'player-heal': (n) => this.onHeal(n),
      'levelup': (lvl) => this.onLevelUp(lvl),
      'gold': (n) => this.pulseGold(n),
      'toast': (text, ms) => this.toast(text, ms),
      'zone-title': (text) => this.zoneTitle(text),
      'banner': (text, opts) => this.banner(text, opts || {}),
      'boss-start': (name, getter) => this.showBoss(name, getter),
      'boss-end': () => this.hideBoss(),
    };
    for (const [ev, fn] of Object.entries(this.handlers)) g.events.on(ev, fn, this);
  }

  unbind() {
    if (!this.boundGame || !this.handlers) return;
    for (const [ev, fn] of Object.entries(this.handlers)) this.boundGame.events.off(ev, fn, this);
    this.boundGame = null; this.handlers = null;
  }

  playSfx(key, opts) {
    const g = this.scene.get('Game');
    if (g && g.audio && g.audio.play) g.audio.play(key, opts);
  }

  // ------------------------------------------------------------------------------ events
  onHurt(dmg) {
    this.hp.ghostDelay = 420;
    const s = Math.min(1, (dmg || 0) / 40);
    this.tweens.add({ targets: this.hp.frame, x: HP_POS.x - 3 - 4 * s, duration: 40, yoyo: true, repeat: 2, onComplete: () => { this.hp.frame.x = HP_POS.x; } });
    this.flash(0xff2020, 0.18 + 0.2 * s);
  }

  onHeal() {
    this.flash(0x40ff80, 0.12);
    this.tweens.add({ targets: this.hp.fill, alpha: 0.6, duration: 120, yoyo: true });
  }

  onLevelUp(level) {
    this.banner(level ? `LEVEL ${level}` : 'LEVEL UP', { tint: 0xffd070, sub: 'LEVEL UP', hold: 1500 });
    this.playSfx('sfx_levelup');
    this.tweens.add({ targets: this.levelText, scaleX: 1.4, scaleY: 1.4, duration: 180, yoyo: true, ease: 'Back.easeOut' });
    this.flash(0xffe0a0, 0.25);
  }

  pulseGold() {
    this.tweens.killTweensOf(this.goldText);
    this.goldText.setScale(1);
    this.tweens.add({ targets: this.goldText, scaleX: 1.25, scaleY: 1.25, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
    if (this.coin.setAngle) {
      this.tweens.add({ targets: this.coin, angle: 20, duration: 90, yoyo: true });
    }
  }

  flash(color, alpha) {
    const r = this.add.rectangle(0, 0, WIDTH, HEIGHT, color, alpha).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: r, alpha: 0, duration: 260, onComplete: () => r.destroy() });
  }

  // ------------------------------------------------------------------------------ public API
  toast(text, ms = 2200) {
    if (this.toastTimer) { this.toastTimer.remove(false); this.toastTimer = null; }
    this.tweens.killTweensOf(this.toastText);
    this.toastText.setText(String(text)).setAlpha(0).setY(HEIGHT * 0.74 + 12);
    this.tweens.add({ targets: this.toastText, alpha: 1, y: HEIGHT * 0.74, duration: 220, ease: 'Quad.easeOut' });
    this.toastTimer = this.time.delayedCall(ms, () => {
      this.toastTimer = null;
      this.tweens.add({ targets: this.toastText, alpha: 0, duration: 450 });
    });
  }

  zoneTitle(text) { this.banner(text, { tint: 0xd8c7a0, hold: 1800 }); }

  banner(text, { tint = 0xd8c7a0, hold = 1600, sub = null } = {}) {
    this.tweens.killTweensOf([this.bannerText, this.bannerLine]);
    this.bannerText.setText(String(text)).setTint(tint).setAlpha(0).setScale(1.06);
    const w = Math.min(WIDTH - 200, this.bannerText.width + 80);
    this.bannerLine.setFillStyle(tint).setAlpha(0).setSize(w, 2).setScale(0, 1);
    this.tweens.add({ targets: this.bannerText, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: this.bannerLine, alpha: 0.8, scaleX: 1, duration: 700, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: [this.bannerText, this.bannerLine], alpha: 0, duration: 900, delay: 600 + hold });
    if (sub) {
      const s = this.add.bitmapText(WIDTH / 2, HEIGHT * 0.38 + 72, 'body', sub, 22).setOrigin(0.5).setTint(tint).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 1, duration: 500, delay: 200, yoyo: true, hold, onComplete: () => s.destroy() });
    }
  }

  showBoss(name, getter) {
    this.bossGetter = typeof getter === 'function' ? getter : null;
    this.bossName.setText(String(name || ''));
    this.bossShown = 1; this.bossGhostShown = 1; this.bossGhostDelay = 0;
    this.bossFill.width = this.bossW; this.bossGhost.width = this.bossW;
    this.boss.setVisible(true);
    this.tweens.killTweensOf(this.boss);
    this.tweens.add({ targets: this.boss, alpha: 1, duration: 500 });
  }

  hideBoss() {
    this.bossGetter = null;
    this.tweens.killTweensOf(this.boss);
    this.tweens.add({ targets: this.boss, alpha: 0, duration: 700, onComplete: () => this.boss.setVisible(false) });
  }

  // ------------------------------------------------------------------------------ update
  update(time, delta) {
    { const g = this.scene.get('Game'); if (this.seedText && g && g.seed && this.seedText.text !== `Seed ${g.seed}`) this.seedText.setText(`Seed ${g.seed}`); }
    const dt = Math.min(delta, 50);
    const game = this.scene.get('Game');
    if (!game || !game.events) return;
    if (this.boundGame !== game) this.bindGame();
    const p = game.player;
    if (!p) return;
    const stats = p.stats || {};

    this.updateBar(this.hp, p.maxHp ? p.hp / p.maxHp : 0, dt);
    this.updateBar(this.st, p.maxStamina ? p.stamina / p.maxStamina : 0, dt);
    if (p.stamina !== undefined && p.maxStamina && p.stamina < 12 && p.stamina < p.maxStamina) {
      this.st.fill.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(time / 90)));
    } else this.st.fill.setAlpha(1);

    // gold counts up toward the real value
    const gold = p.gold || 0;
    if (this.goldShown !== gold) {
      const diff = gold - this.goldShown;
      this.goldShown = Math.abs(diff) < 2 ? gold : this.goldShown + Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt / 160)));
      this.goldText.setText(String(Math.round(this.goldShown)));
    }

    // souls / xp
    const lvl = stats.level || 1;
    const need = typeof stats.xpToNext === 'function' ? stats.xpToNext() : 1;
    const xpFrac = need > 0 ? Math.max(0, Math.min(1, (stats.xp || 0) / need)) : 0;
    this.xpShown = lerp(this.xpShown, xpFrac, Math.min(1, dt / 220));
    this.xpFill.width = Math.round(220 * this.xpShown);
    this.levelText.setText(`LV ${lvl}`);
    this.xpText.setText(`${Math.floor(stats.xp || 0)} / ${need}`);

    // potion slot
    const potions = p.potions || 0;
    this.potionCount.setText(String(potions));
    this.potionImg.setAlpha(potions > 0 ? 1 : 0.3);
    const dev = this.input_.lastDevice;
    if (dev !== this.promptDevice) {
      this.promptDevice = dev;
      if (dev === 'gamepad' && this.textures.exists('ui_button_rb')) {
        this.promptGlyph.setTexture('ui_button_rb'); this.promptLetter.setVisible(false);
      } else {
        this.promptGlyph.setTexture('ui_key'); this.promptLetter.setVisible(true).setText(promptFor('potion', dev));
      }
    }

    // boss bar
    if (this.bossGetter && this.boss.visible) {
      let v = null;
      try { v = this.bossGetter(); } catch (e) { v = null; }
      if (v && v.maxHp) {
        const t = Math.max(0, Math.min(1, v.hp / v.maxHp));
        if (t < this.bossShown) { if (this.bossGhostDelay <= 0 && this.bossGhostShown <= this.bossShown + 0.001) this.bossGhostDelay = 350; }
        this.bossShown = lerp(this.bossShown, t, Math.min(1, dt / 90));
        if (t >= this.bossGhostShown) this.bossGhostShown = t;
        else if (this.bossGhostDelay > 0) this.bossGhostDelay -= dt;
        else this.bossGhostShown = Math.max(t, this.bossGhostShown - dt / 900);
        this.bossFill.width = Math.round(this.bossW * this.bossShown);
        this.bossGhost.width = Math.round(this.bossW * this.bossGhostShown);
      }
    }

    if (this.debugText) {
      const fps = Math.round(this.game.loop.actualFps);
      this.debugText.setText(`${fps} fps  x:${Math.round(p.x || 0)}  ${dev}  hp:${Math.round(p.hp)}/${p.maxHp}`);
    }
  }
}
