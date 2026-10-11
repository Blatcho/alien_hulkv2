import { DEPTH } from '../config.js';

// Visual effects helpers: slashes, impacts, particles, floating damage numbers, hit-stop and shake.
export default class FX {
  constructor(scene) {
    this.scene = scene;
    this.hitStopUntil = 0;
    this.blood = scene.add.particles(0, 0, 'fx_drop', {
      speed: { min: 120, max: 420 }, angle: { min: 200, max: 340 }, gravityY: 1400, lifespan: { min: 300, max: 700 },
      scale: { start: 0.9, end: 0.2 }, alpha: { start: 1, end: 0.6 }, tint: [0x9a1020, 0xc02030, 0x5a0810], emitting: false,
    }).setDepth(DEPTH.fx);
    this.sparks = scene.add.particles(0, 0, 'fx_shard', {
      speed: { min: 200, max: 600 }, angle: { min: 180, max: 360 }, gravityY: 900, lifespan: { min: 200, max: 450 },
      scale: { start: 1, end: 0.1 }, rotate: { min: 0, max: 360 }, tint: [0xfff0b0, 0xffc040, 0xffffff], blendMode: 'ADD', emitting: false,
    }).setDepth(DEPTH.fx);
    this.dust = scene.add.particles(0, 0, 'particle_soft', {
      speed: { min: 20, max: 90 }, angle: { min: 220, max: 320 }, lifespan: { min: 300, max: 600 },
      scale: { start: 0.5, end: 1.2 }, alpha: { start: 0.35, end: 0 }, tint: 0x8a7a66, emitting: false,
    }).setDepth(DEPTH.player - 1);
    this.bones = scene.add.particles(0, 0, 'fx_shard', {
      speed: { min: 100, max: 300 }, angle: { min: 200, max: 340 }, gravityY: 1200, lifespan: { min: 400, max: 800 },
      scale: { start: 1.2, end: 0.6 }, rotate: { min: 0, max: 720 }, tint: [0xd8d0b8, 0xa89c80], emitting: false,
    }).setDepth(DEPTH.fx);
  }

  slash(x, y, facing, kind = 'claw', scale = 1, tint = 0xffffff) {
    const img = this.scene.add.image(x, y, kind === 'claw' ? 'fx_slash_claw' : 'fx_slash_sword')
      .setDepth(DEPTH.fx).setScale(scale * 0.6 * facing, scale * 0.6).setAlpha(0.9).setBlendMode('ADD').setTint(tint);
    this.scene.tweens.add({ targets: img, scaleX: scale * 1.15 * facing, scaleY: scale * 1.1, alpha: 0, duration: 220, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
  }

  impact(x, y, { heavy = false, metal = false, blood = true, bone = false } = {}) {
    const img = this.scene.add.image(x, y, 'fx_impact').setDepth(DEPTH.fx + 1).setScale(heavy ? 0.9 : 0.5).setBlendMode('ADD')
      .setTint(metal ? 0xfff4d0 : 0xffd0c0).setAngle(Math.random() * 360);
    this.scene.tweens.add({ targets: img, scale: heavy ? 1.6 : 1.0, alpha: 0, duration: heavy ? 220 : 150, onComplete: () => img.destroy() });
    if (metal) this.sparks.explode(heavy ? 18 : 9, x, y);
    if (blood) this.blood.explode(heavy ? 16 : 8, x, y);
    if (bone) this.bones.explode(heavy ? 10 : 5, x, y);
  }

  landDust(x, y, n = 6) { this.dust.explode(n, x, y); }

  number(x, y, value, { color = 0xffffff, crit = false, size = 1 } = {}) {
    const t = this.scene.add.bitmapText(x + (Math.random() * 20 - 10), y, 'small', String(value), 16 * (crit ? 1.6 : 1.15) * size)
      .setOrigin(0.5).setDepth(DEPTH.fx + 2).setTint(color);
    this.scene.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
    if (crit) this.scene.tweens.add({ targets: t, scale: 1.3, duration: 120, yoyo: true });
  }

  hitStop(ms) {
    this.hitStopUntil = Math.max(this.hitStopUntil, this.scene.time.now + ms);
  }

  get stopped() { return this.scene.time.now < this.hitStopUntil; }

  shake(intensity = 0.004, ms = 120) { this.scene.cameras.main.shake(ms, intensity); }

  flashScreen(color = 0xffffff, ms = 80, alpha = 0.25) {
    this.scene.cameras.main.flash(ms, (color >> 16) & 255, (color >> 8) & 255, color & 255, false);
  }
}
