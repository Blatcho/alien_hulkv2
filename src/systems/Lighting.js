import { WIDTH, HEIGHT } from '../config.js';

// Dynamic lighting (Phaser Light2D) and camera post-processing. Everything degrades gracefully:
// on the Canvas renderer nothing here applies and the scene looks as it did before.
export default class Lighting {
  constructor(scene, zoneMeta) {
    this.scene = scene;
    this.enabled = !!(scene.sys.renderer && scene.sys.renderer.pipelines && scene.sys.game.config.renderType === Phaser.WEBGL);
    this.torches = [];
    if (!this.enabled) return;
    const ambient = zoneMeta.ambient || 0x6a7290;
    scene.lights.enable().setAmbientColor(ambient);
    const m = zoneMeta.moon || { x: 900, y: 120 };
    this.moonLight = scene.lights.addLight(m.x, m.y, 1400, zoneMeta.moonLight || 0x9fb4e8, 0.55);
    this.moonPos = m;
    // camera post effects: subtle bloom for torches/moon, filmic contrast, vignette
    const cam = scene.cameras.main;
    try {
      cam.postFX.addBloom(0xffffff, 1, 1, 0.42, 1.0, 4);
      const cm = cam.postFX.addColorMatrix();
      cm.contrast(0.12).saturate(-0.06);
      cam.postFX.addVignette(0.5, 0.5, 0.92, 0.38);
    } catch (e) { /* older renderer */ }
  }

  // Apply the lit pipeline to a game object (or a container's children).
  lit(obj) {
    if (!this.enabled || !obj) return obj;
    if (obj.list) { for (const c of obj.list) this.lit(c); return obj; }
    if (obj.setPipeline) { try { obj.setPipeline('Light2D'); } catch (e) { /* unsupported object */ } }
    return obj;
  }

  addTorch(x, y, { color = 0xffa040, radius = 300, intensity = 1.3 } = {}) {
    if (!this.enabled) return null;
    const l = this.scene.lights.addLight(x, y, radius, color, intensity);
    this.torches.push({ light: l, base: intensity, radius, phase: Math.random() * 10 });
    return l;
  }

  addPoint(x, y, radius, color, intensity) {
    if (!this.enabled) return null;
    return this.scene.lights.addLight(x, y, radius, color, intensity);
  }

  remove(light) { if (this.enabled && light) this.scene.lights.removeLight(light); }

  update(time) {
    if (!this.enabled) return;
    const cam = this.scene.cameras.main;
    this.moonLight.setPosition(cam.scrollX + this.moonPos.x, cam.scrollY + this.moonPos.y);
    for (const t of this.torches) {
      t.light.intensity = t.base * (0.82 + 0.14 * Math.sin(time / 83 + t.phase) + 0.08 * Math.sin(time / 31 + t.phase * 1.7));
      t.light.radius = t.radius * (0.95 + 0.05 * Math.sin(time / 140 + t.phase));
    }
  }
}
