import { WIDTH, HEIGHT, DEPTH } from '../config.js';

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
        const img = scene.add.image(L.x + L.w / 2, L.y + L.h / 2, key).setScrollFactor(0).setDepth(depth);
        this.layers.push({ obj: img, meta: L, fixed: true });
        // gentle pulse on the moon glow
        scene.tweens.add({ targets: img, alpha: 0.9, duration: 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        return;
      }
      const ts = scene.add.tileSprite(0, L.y, WIDTH, L.h, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
      if (L.key === 'foreground') ts.setAlpha(0.95);
      this.layers.push({ obj: ts, meta: L, fixed: false });
    });

    // Fog banks: one behind the hedge, one in front of the ground.
    const fogColor = Phaser.Display.Color.HexStringToColor(meta.fog || '#2c2f3d').color;
    this.fogs = [
      scene.add.tileSprite(0, meta.ground_y - 170, WIDTH, 256, 'fog').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.bgFar + 5.5).setAlpha(0.22).setTint(fogColor | 0x404040),
      scene.add.tileSprite(0, meta.ground_y - 90, WIDTH, 256, 'fog').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.fx + 1).setAlpha(0.16),
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

    // Vignette on top of the world (under the HUD scene).
    this.vignette = scene.add.image(WIDTH / 2, HEIGHT / 2, 'ui_vignette').setScrollFactor(0).setDepth(DEPTH.hud - 1).setAlpha(0.85);
    this.cam = cam;
  }

  update(time, dt) {
    this.time += dt;
    const sx = this.cam.scrollX;
    const sy = this.cam.scrollY;
    for (const L of this.layers) {
      if (L.fixed) continue;
      const m = L.meta;
      let drift = 0;
      if (m.key === 'sky') drift = this.time * 0.004;        // clouds roll slowly
      L.obj.tilePositionX = sx * m.scroll + drift;
      // vertical parallax is much weaker so layers stay anchored to the ground line
      L.obj.y = m.y - sy * Math.min(1, m.scroll) + (m.key === 'ground' ? 0 : 0);
    }
    this.fogs[0].tilePositionX = sx * 0.7 + this.time * 0.012;
    this.fogs[1].tilePositionX = sx * 1.05 - this.time * 0.02;
    for (const f of this.fogs) f.y = f.y; // fixed to ground line
  }

  destroy() {
    for (const L of this.layers) L.obj.destroy();
    for (const f of this.fogs) f.destroy();
    this.embers.destroy();
    this.vignette.destroy();
  }
}
