import { WIDTH, HEIGHT, DEPTH, VIEW_TOP, BG_SCALE } from '../config.js';

// Builds the multi-layer parallax backdrop for a zone from assets/bg/layers.json.
// Every layer is a screen-fixed TileSprite whose tilePosition follows the camera at its own
// scroll factor, so the world can be arbitrarily wide while textures stay small and tileable.
export default class Parallax {
  constructor(scene, zoneKey, meta) {
    this.scene = scene;
    this.zone = zoneKey;
    this.meta = meta;
    this.layers = [];
    this.time = 0;
    const cam = scene.cameras.main;

    meta.layers.forEach((L, i) => {
      const key = `bg_${zoneKey}_${L.key}`;
      const depth = L.key === 'foreground' ? DEPTH.foreground : DEPTH.bgFar + i;
      if (L.fixed) {
        const img = scene.add.image((L.x + L.w / 2) * BG_SCALE, (L.y + L.h / 2) * BG_SCALE, key).setScrollFactor(0).setDepth(depth).setScale(BG_SCALE);
        this.layers.push({ obj: img, meta: L, fixed: true });
        // gentle pulse on the moon glow
        scene.tweens.add({ targets: img, alpha: 0.9, duration: 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        return;
      }
      // The ground strip stays at world scale, anchored to the physics ground line; every other layer is
      // scaled up to fill the taller view (its ground line lands close to the world ground).
      const isGround = L.key === 'ground';
      const y = isGround ? meta.ground_y - 20 - VIEW_TOP : (L.y + (L.key === 'foreground' ? 50 : 0)) * BG_SCALE;
      const h = isGround ? L.h : HEIGHT;
      const ts = scene.add.tileSprite(0, y, WIDTH, h, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
      if (!isGround) ts.setTileScale(BG_SCALE, BG_SCALE);
      if (L.key === 'foreground') ts.setAlpha(0.8);
      if ((L.key === 'ground' || L.key === 'hedge') && scene.lighting) scene.lighting.lit(ts);
      this.layers.push({ obj: ts, meta: L, fixed: false });
    });

    // Fog banks: one behind the hedge, one in front of the ground.
    const fogColor = Phaser.Display.Color.HexStringToColor(meta.fog || '#2c2f3d').color;
    const groundScreen = meta.ground_y - VIEW_TOP;
    this.fogs = [
      scene.add.tileSprite(0, groundScreen - 170, WIDTH, 256, 'fog').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.bgFar + 5.5).setAlpha(0.22).setTint(fogColor | 0x404040),
      scene.add.tileSprite(0, groundScreen - 90, WIDTH, 256, 'fog').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.fx + 1).setAlpha(0.16),
    ];

    // Drifting embers / spores.
    const emberTint = meta.embers ? [0xffa040, 0xff6020, 0xffd080] : [0x80c0a0, 0x50a080, 0xa0e0c0];
    this.embers = scene.add.particles(0, 0, 'particle_soft', {
      x: { min: 0, max: WIDTH }, y: { min: HEIGHT * 0.3, max: HEIGHT + 20 },
      lifespan: { min: 4000, max: 8000 }, speedY: { min: -40, max: -12 }, speedX: { min: -25, max: 25 },
      scale: { start: 0.22, end: 0.02 }, alpha: { start: 0, end: 0.9, ease: 'Sine.easeIn' },
      tint: emberTint, frequency: meta.embers ? 140 : 260, blendMode: 'ADD',
    }).setScrollFactor(0).setDepth(DEPTH.fx + 2);
    this.embers.setEmitZone({ type: 'random', source: new Phaser.Geom.Rectangle(0, HEIGHT * 0.35, WIDTH, HEIGHT * 0.7) });

    this.buildWeather(meta);

    // Vignette on top of the world (under the HUD scene).
    this.vignette = scene.add.image(WIDTH / 2, HEIGHT / 2, 'ui_vignette').setScrollFactor(0).setDepth(DEPTH.hud - 1).setAlpha(0.5).setDisplaySize(WIDTH, HEIGHT);
    this.cam = cam;
  }

  buildWeather(meta) {
    const scene = this.scene;
    const tex = (k, fb) => (scene.textures.exists(k) ? k : fb);
    this.weatherEmitters = [];
    if (meta.weather === 'rain') {
      const e = scene.add.particles(0, 0, tex('bg_rain', 'fx_shard'), {
        x: { min: -100, max: WIDTH + 100 }, y: -30, lifespan: 900, speedY: { min: 900, max: 1200 }, speedX: { min: -140, max: -100 },
        scale: { min: 0.7, max: 1.2 }, alpha: { start: 0.38, end: 0.2 }, quantity: 3, frequency: 14, rotate: 8, tint: 0xc8d8f0,
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3);
      this.weatherEmitters.push(e);
    } else if (meta.weather === 'leaves') {
      const e = scene.add.particles(0, 0, tex('bg_leaf', 'particle_hard'), {
        x: { min: -40, max: WIDTH + 40 }, y: -20, lifespan: { min: 6000, max: 9000 }, speedY: { min: 40, max: 90 }, speedX: { min: -90, max: -30 },
        scale: { min: 0.7, max: 1.3 }, alpha: { start: 0.9, end: 0.5 }, rotate: { start: 0, end: 720 }, frequency: 420, tint: [0x7a5a30, 0x5a4020, 0x8a6a30],
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3);
      this.weatherEmitters.push(e);
    } else if (meta.weather === 'ash') {
      const e = scene.add.particles(0, 0, tex('bg_ash', 'particle_soft'), {
        x: { min: -40, max: WIDTH + 40 }, y: { min: -20, max: HEIGHT }, lifespan: { min: 7000, max: 11000 }, speedY: { min: -14, max: 24 }, speedX: { min: -30, max: 10 },
        scale: { min: 0.3, max: 0.9 }, alpha: { start: 0, end: 0.6, ease: 'Sine.easeIn' }, frequency: 120, tint: [0x9a9aa0, 0x6a6a70, 0xc0b0a0],
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3);
      this.weatherEmitters.push(e);
    }
    this.lightning = !!meta.lightning;
    this.nextLightning = 6000 + Math.random() * 10000;
    this.shafts = [];
    if (meta.shafts && scene.textures.exists('bg_lightshaft')) {
      const m = { x: (meta.moon || { x: 900 }).x * BG_SCALE, y: (meta.moon || { y: 120 }).y * BG_SCALE };
      for (let i = 0; i < 4; i++) {
        const img = scene.add.image(m.x + (i - 1.5) * 90, m.y + 300 * BG_SCALE, 'bg_lightshaft').setScrollFactor(0).setDepth(DEPTH.bgFar + 4.5)
          .setBlendMode('ADD').setAlpha(0.09 + i * 0.02).setAngle(-18 + i * 12).setScale(1.6, 1.4).setTint(0xc0d0ff);
        this.shafts.push({ img, phase: i * 1.3 });
      }
    }
  }

  strike() {
    const scene = this.scene;
    const cam = scene.cameras.main;
    cam.flash(140, 200, 210, 255, false);
    if (scene.textures.exists('bg_lightning')) {
      const bolt = scene.add.image(200 + Math.random() * (WIDTH - 400), 40, 'bg_lightning').setOrigin(0.5, 0).setScrollFactor(0)
        .setDepth(DEPTH.bgFar + 1.5).setBlendMode('ADD').setAlpha(0.9).setScale(0.8 + Math.random() * 0.5).setFlipX(Math.random() < 0.5);
      scene.tweens.add({ targets: bolt, alpha: 0, duration: 260, ease: 'Expo.easeOut', onComplete: () => bolt.destroy() });
    }
    if (scene.lighting && scene.lighting.moonLight) {
      const L = scene.lighting.moonLight; const base = L.intensity;
      L.intensity = base * 3.5;
      scene.tweens.add({ targets: L, intensity: base, duration: 400, ease: 'Expo.easeOut' });
    }
    scene.time.delayedCall(300 + Math.random() * 700, () => scene.audio && scene.audio.play('sfx_thunder', { volume: 0.7 }));
  }

  update(time, dt) {
    this.time += dt;
    if (this.lightning) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) { this.strike(); this.nextLightning = 9000 + Math.random() * 16000; }
    }
    for (const s of this.shafts) s.img.setAlpha(0.07 + 0.05 * Math.sin(this.time / 1700 + s.phase)).setAngle(s.img.angle + Math.sin(this.time / 2600 + s.phase) * 0.004);
    const sx = this.cam.scrollX;
    for (const L of this.layers) {
      if (L.fixed) continue;
      const m = L.meta;
      let drift = 0;
      if (m.key === 'sky') drift = this.time * 0.004;        // clouds roll slowly
      // tilePosition is in texture pixels; scaled layers move at the same on-screen rate as before
      const k = m.key === 'ground' ? 1 : 1 / BG_SCALE;
      L.obj.tilePositionX = (sx * m.scroll + drift) * k;
    }
    this.fogs[0].tilePositionX = sx * 0.7 + this.time * 0.012;
    this.fogs[1].tilePositionX = sx * 1.05 - this.time * 0.02;
    for (const f of this.fogs) f.y = f.y; // fixed to ground line
  }

  destroy() {
    for (const L of this.layers) L.obj.destroy();
    for (const f of this.fogs) f.destroy();
    for (const e of this.weatherEmitters || []) e.destroy();
    for (const s of this.shafts || []) s.img.destroy();
    this.embers.destroy();
    this.vignette.destroy();
  }
}
