import { WIDTH, HEIGHT, DEPTH, VIEW_TOP, BG_SCALE } from '../config.js';

// Builds the multi-layer parallax backdrop for a zone from assets/bg/layers.json.
// Every layer is a screen-fixed TileSprite whose tilePosition follows the camera at its own
// scroll factor, so the world can be arbitrarily wide while textures stay small and tileable.
//
// Zoom: the camera zoom is treated as the camera moving back. A layer with parallax factor p is
// displayed at zoom^p, so the ground (p=1) zooms exactly with the world, the sky (p≈0) barely
// changes, and the layers in between shrink progressively. Because the camera zoom already scales
// every screen-fixed object by `zoom` around the screen centre, each layer is pre-scaled by
// zoom^p / zoom and positioned at centre + (desired - centre) / zoom.
export default class Parallax {
  constructor(scene, zoneKey, meta) {
    this.scene = scene;
    this.zone = zoneKey;
    this.meta = meta;
    this.layers = [];
    this.time = 0;
    this.zoom = 1;
    const cam = scene.cameras.main;
    this.cam = cam;

    meta.layers.forEach((L, i) => {
      const key = `bg_${zoneKey}_${L.key}`;
      const depth = L.key === 'foreground' ? DEPTH.foreground : DEPTH.bgFar + i;
      if (L.fixed) {
        const img = scene.add.image(0, 0, key).setScrollFactor(0).setDepth(depth);
        this.layers.push({ obj: img, meta: L, fixed: true, p: 0, sx: (L.x + L.w / 2) * BG_SCALE, sy: (L.y + L.h / 2) * BG_SCALE });
        scene.tweens.add({ targets: img, alpha: 0.9, duration: 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        return;
      }
      const isGround = L.key === 'ground';
      const ts = scene.add.tileSprite(0, 0, WIDTH, isGround ? L.h : HEIGHT, key).setOrigin(0.5, 0).setScrollFactor(0).setDepth(depth);
      if (L.key === 'foreground') ts.setAlpha(0.8);
      if ((isGround || L.key === 'hedge') && scene.lighting) scene.lighting.lit(ts);
      // desired screen y of the layer's top at zoom 1
      const sy = isGround ? meta.ground_y - 20 - VIEW_TOP : (L.y + (L.key === 'foreground' ? 50 : 0)) * BG_SCALE;
      this.layers.push({ obj: ts, meta: L, fixed: false, p: isGround ? 1 : L.scroll, sy, isGround, texH: L.h });
    });
    // dark earth below the ground strip (visible when zoomed out)
    const earth = this.earthColor(meta);
    this.earth = scene.add.rectangle(0, 0, WIDTH, HEIGHT, earth).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.bgFar + meta.layers.length - 1.5);

    // Fog banks: one behind the hedge, one in front of the ground.
    const fogColor = Phaser.Display.Color.HexStringToColor(meta.fog || '#2c2f3d').color;
    const groundScreen = meta.ground_y - VIEW_TOP;
    this.fogs = [
      { obj: scene.add.tileSprite(0, 0, WIDTH, 256, 'fog').setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.bgFar + 5.5).setAlpha(0.22).setTint(fogColor | 0x404040), p: 0.7, sy: groundScreen - 170 },
      { obj: scene.add.tileSprite(0, 0, WIDTH, 256, 'fog').setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH.fx + 1).setAlpha(0.16), p: 1.05, sy: groundScreen - 90 },
    ];

    // Drifting embers / spores.
    this.emberTint = meta.embers ? [0xffa040, 0xff6020, 0xffd080] : [0x80c0a0, 0x50a080, 0xa0e0c0];
    this.embers = null;
    this.weatherEmitters = [];
    this.shafts = [];
    this.lightning = !!meta.lightning;
    this.nextLightning = 6000 + Math.random() * 10000;
    this.moonScreen = { x: (meta.moon || { x: 900 }).x * BG_SCALE, y: (meta.moon || { y: 120 }).y * BG_SCALE };
    if (meta.shafts && scene.textures.exists('bg_lightshaft')) {
      for (let i = 0; i < 4; i++) {
        const img = scene.add.image(0, 0, 'bg_lightshaft').setScrollFactor(0).setDepth(DEPTH.bgFar + 4.5)
          .setBlendMode('ADD').setAlpha(0.09 + i * 0.02).setAngle(-18 + i * 12).setTint(0xc0d0ff);
        this.shafts.push({ img, phase: i * 1.3, sx: this.moonScreen.x + (i - 1.5) * 90, sy: this.moonScreen.y + 300 * BG_SCALE });
      }
    }

    // Vignette on top of the world (under the HUD scene).
    this.vignette = scene.add.image(WIDTH / 2, HEIGHT / 2, 'ui_vignette').setScrollFactor(0).setDepth(DEPTH.hud - 1).setAlpha(0.5);
    this.setZoom(1);
  }

  earthColor(meta) {
    try { return Phaser.Display.Color.HexStringToColor(meta.earth || '#15110c').color; } catch (e) { return 0x15110c; }
  }

  // Map a desired on-screen point (at zoom 1 framing) to the object position the zoomed camera needs.
  screenToObj(x, y, z) {
    return { x: WIDTH / 2 + (x - WIDTH / 2) / z, y: HEIGHT / 2 + (y - HEIGHT / 2) / z };
  }

  // Where a layer's design-top should appear on screen when displayed at net scale s: layers scale
  // about the ground line (so they stay attached to it), the sky about the top of the screen.
  anchoredTop(sy, s, p) {
    const groundScreen = this.meta.ground_y - VIEW_TOP;
    if (p < 0.1) return sy * s;
    return groundScreen - (groundScreen - sy) * s;
  }

  setZoom(z) {
    this.zoom = z;
    const cover = 1 / z;                          // extra extent needed to still cover the screen
    for (const L of this.layers) {
      const s = Math.pow(z, L.p);                 // net on-screen scale for this layer
      const pre = s / z;                          // object scale, since the camera multiplies by z
      if (L.fixed) {
        const P = this.screenToObj(L.sx, L.sy, z);
        L.obj.setPosition(P.x, P.y).setScale(BG_SCALE * pre);
        continue;
      }
      const t = (L.isGround ? 1 : BG_SCALE) * pre;
      L.obj.setTileScale(t, t);
      L.obj.width = WIDTH * cover + 4;
      L.obj.height = L.isGround ? L.texH * pre : HEIGHT * cover + 4;
      // position so the layer's design-top lands at its anchored screen position after the camera zoom
      const top = this.anchoredTop(L.sy, s, L.p);
      L.obj.setPosition(WIDTH / 2, HEIGHT / 2 + (top - HEIGHT / 2) / z);
    }
    // earth under the ground strip
    const g = this.layers.find((L) => L.isGround);
    if (g) {
      this.earth.setPosition(WIDTH / 2, g.obj.y + g.obj.height - 2).setSize(WIDTH * cover + 4, HEIGHT * cover);
    }
    for (const f of this.fogs) {
      const s = Math.pow(z, f.p), pre = s / z;
      f.obj.setTileScale(pre, pre);
      f.obj.width = WIDTH * cover + 4; f.obj.height = 256 * pre;
      const top = this.anchoredTop(f.sy, s, f.p);
      f.obj.setPosition(WIDTH / 2, HEIGHT / 2 + (top - HEIGHT / 2) / z);
    }
    for (const sh of this.shafts) {
      const P = this.screenToObj(sh.sx, sh.sy, z);
      sh.img.setPosition(P.x, P.y).setScale(1.6 / z, 1.4 / z);
    }
    this.vignette.setDisplaySize(WIDTH * cover, HEIGHT * cover);
    this.rebuildParticles();
  }

  rebuildParticles() {
    const scene = this.scene;
    const z = this.zoom;
    const cover = 1 / z;
    const x0 = WIDTH / 2 - (WIDTH / 2) * cover, x1 = WIDTH / 2 + (WIDTH / 2) * cover;
    const y0 = HEIGHT / 2 - (HEIGHT / 2) * cover, y1 = HEIGHT / 2 + (HEIGHT / 2) * cover;
    if (this.embers) this.embers.destroy();
    for (const e of this.weatherEmitters) e.destroy();
    this.weatherEmitters = [];
    const meta = this.meta;
    const tex = (k, fb) => (scene.textures.exists(k) ? k : fb);
    const pscale = (a, b) => ({ start: a / z, end: b / z });
    this.embers = scene.add.particles(0, 0, 'particle_soft', {
      x: { min: x0, max: x1 }, y: { min: y0 + (y1 - y0) * 0.3, max: y1 + 20 },
      lifespan: { min: 4000, max: 8000 }, speedY: { min: -40 / z, max: -12 / z }, speedX: { min: -25 / z, max: 25 / z },
      scale: pscale(0.22, 0.02), alpha: { start: 0, end: 0.9, ease: 'Sine.easeIn' },
      tint: this.emberTint, frequency: meta.embers ? 140 : 260, blendMode: 'ADD',
    }).setScrollFactor(0).setDepth(DEPTH.fx + 2);
    if (meta.weather === 'rain') {
      this.weatherEmitters.push(scene.add.particles(0, 0, tex('bg_rain', 'fx_shard'), {
        x: { min: x0 - 100, max: x1 + 100 }, y: y0 - 30, lifespan: 900, speedY: { min: 900 / z, max: 1200 / z }, speedX: { min: -140 / z, max: -100 / z },
        scale: { min: 0.7 / z, max: 1.2 / z }, alpha: { start: 0.38, end: 0.2 }, quantity: 3, frequency: 14, rotate: 8, tint: 0xc8d8f0,
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3));
    } else if (meta.weather === 'leaves') {
      this.weatherEmitters.push(scene.add.particles(0, 0, tex('bg_leaf', 'particle_hard'), {
        x: { min: x0 - 40, max: x1 + 40 }, y: y0 - 20, lifespan: { min: 6000, max: 9000 }, speedY: { min: 40 / z, max: 90 / z }, speedX: { min: -90 / z, max: -30 / z },
        scale: { min: 0.7 / z, max: 1.3 / z }, alpha: { start: 0.9, end: 0.5 }, rotate: { start: 0, end: 720 }, frequency: 420, tint: [0x7a5a30, 0x5a4020, 0x8a6a30],
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3));
    } else if (meta.weather === 'ash') {
      this.weatherEmitters.push(scene.add.particles(0, 0, tex('bg_ash', 'particle_soft'), {
        x: { min: x0 - 40, max: x1 + 40 }, y: { min: y0 - 20, max: y1 }, lifespan: { min: 7000, max: 11000 }, speedY: { min: -14 / z, max: 24 / z }, speedX: { min: -30 / z, max: 10 / z },
        scale: { min: 0.3 / z, max: 0.9 / z }, alpha: { start: 0, end: 0.6, ease: 'Sine.easeIn' }, frequency: 120, tint: [0x9a9aa0, 0x6a6a70, 0xc0b0a0],
      }).setScrollFactor(0).setDepth(DEPTH.fx + 3));
    }
  }

  strike() {
    const scene = this.scene;
    const cam = scene.cameras.main;
    cam.flash(140, 200, 210, 255, false);
    if (scene.textures.exists('bg_lightning')) {
      const P = this.screenToObj(200 + Math.random() * (WIDTH - 400), 40, this.zoom);
      const bolt = scene.add.image(P.x, P.y, 'bg_lightning').setOrigin(0.5, 0).setScrollFactor(0)
        .setDepth(DEPTH.bgFar + 1.5).setBlendMode('ADD').setAlpha(0.9).setScale((0.8 + Math.random() * 0.5) / this.zoom).setFlipX(Math.random() < 0.5);
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
      // tilePosition is in texture pixels: divide by the texture's on-screen scale so the layer moves
      // `scroll` screen pixels per world pixel of camera travel (times the zoom, like the world does)
      const screenScale = L.obj.tileScaleX * this.zoom;
      L.obj.tilePositionX = (sx * m.scroll * this.zoom + drift) / screenScale;
    }
    this.fogs[0].obj.tilePositionX = (sx * 0.7 * this.zoom + this.time * 0.012) / (this.fogs[0].obj.tileScaleX * this.zoom);
    this.fogs[1].obj.tilePositionX = (sx * 1.05 * this.zoom - this.time * 0.02) / (this.fogs[1].obj.tileScaleX * this.zoom);
  }

  destroy() {
    for (const L of this.layers) L.obj.destroy();
    for (const f of this.fogs) f.obj.destroy();
    for (const e of this.weatherEmitters || []) e.destroy();
    for (const s of this.shafts || []) s.img.destroy();
    if (this.embers) this.embers.destroy();
    this.earth.destroy();
    this.vignette.destroy();
  }
}
