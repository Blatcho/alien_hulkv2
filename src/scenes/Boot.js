import { WIDTH, HEIGHT } from '../config.js';
import { SFX_KEYS, MUSIC_KEYS } from '../systems/Audio.js';

export const ZONE_KEYS = ['thornmoor', 'graveyard', 'castle'];

export default class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    const bar = this.add.graphics();
    const box = this.add.graphics();
    box.fillStyle(0x111318, 1).fillRect(WIDTH / 2 - 200, HEIGHT / 2 - 12, 400, 24);
    this.load.on('progress', (v) => {
      bar.clear().fillStyle(0x8b1a1a, 1).fillRect(WIDTH / 2 - 196, HEIGHT / 2 - 8, 392 * v, 16);
    });

    this.load.json('bg_layers', 'assets/bg/layers.json');
    this.load.json('rig_manifest', 'assets/rigs/manifest.json');
    this.load.json('props_manifest', 'assets/sprites/props/props.json');
    for (const k of ['slash_claw', 'slash_sword', 'impact', 'drop', 'shard', 'shadow']) this.load.image(`fx_${k}`, `assets/sprites/fx/${k}.png`);
    this.load.json('fx_manifest', 'assets/sprites/fx/manifest.json');
    this.load.json('world_manifest', 'assets/sprites/world/manifest.json');
    this.load.spritesheet('fx_flame', 'assets/sprites/fx/flame_sheet.png', { frameWidth: 32, frameHeight: 48 });
    for (const k of SFX_KEYS) this.load.audio(k, `assets/audio/${k}.ogg`);
    for (const k of MUSIC_KEYS) this.load.audio(k, `assets/audio/${k}.ogg`);
    this.load.image('fog', 'assets/bg/common/fog.png');
    this.load.image('particle_soft', 'assets/sprites/fx/particle_soft.png');
    this.load.image('particle_hard', 'assets/sprites/fx/particle_hard.png');
    this.load.image('glow', 'assets/sprites/fx/glow.png');

    // UI
    for (const k of ['panel', 'bar_frame_hp', 'bar_frame_stamina', 'emblem', 'cursor', 'slot', 'slot_selected', 'vignette',
      'button_a', 'button_b', 'button_x', 'button_y', 'button_rb', 'button_lb', 'button_start', 'key']) {
      this.load.image(`ui_${k}`, `assets/ui/${k}.png`);
    }
    this.load.bitmapFont('title', 'assets/fonts/title.png', 'assets/fonts/title.xml');
    this.load.bitmapFont('body', 'assets/fonts/body.png', 'assets/fonts/body.xml');
    this.load.bitmapFont('small', 'assets/fonts/small.png', 'assets/fonts/small.xml');
  }

  create() {
    // Second pass: background layers depend on the manifest loaded above.
    const meta = this.cache.json.get('bg_layers');
    for (const zone of ZONE_KEYS) {
      if (!meta[zone]) continue;
      for (const L of meta[zone].layers) {
        const url = `assets/bg/${zone}/${L.key}.png`;
        this.load.image(`bg_${zone}_${L.key}`, L.normal ? [url, `assets/bg/${zone}/${L.normal}`] : url);
      }
    }
    const props = this.cache.json.get('props_manifest').sprites;
    for (const [name, p] of Object.entries(props)) {
      const url = p.normal ? [`assets/sprites/props/${p.file}`, `assets/sprites/props/${p.normal}`] : `assets/sprites/props/${p.file}`;
      if (p.frames > 1) this.load.spritesheet(`prop_${name}`, url, { frameWidth: p.frame_width, frameHeight: p.frame_height });
      else this.load.image(`prop_${name}`, url);
    }
    // optional manifests written by the generators (extra fx, world sprites with normal maps)
    const fxm = this.cache.json.get('fx_manifest');
    if (fxm && Array.isArray(fxm.extra)) for (const k of fxm.extra) this.load.image(`fx_${k}`, `assets/sprites/fx/${k}.png`);
    if (fxm && Array.isArray(fxm.common)) for (const k of fxm.common) this.load.image(`bg_${k}`, `assets/bg/common/${k}.png`);
    const wm = this.cache.json.get('world_manifest') || { textures: ['gate', 'platform', 'fence'], normals: [] };
    for (const k of wm.textures) {
      const hasN = (wm.normals || []).includes(k);
      this.load.image(`world_${k}`, hasN ? [`assets/sprites/world/${k}.png`, `assets/sprites/world/${k}_n.png`] : `assets/sprites/world/${k}.png`);
    }
    import('../systems/Loot.js').then((m) => this.registry.set('loot', m)).catch((e) => console.warn('Loot module unavailable', e));
    const manifest = this.cache.json.get('rig_manifest');
    for (const rig of Object.keys(manifest)) {
      this.load.json(`rig_${rig}`, `assets/rigs/${rig}.json`);
      const entry = manifest[rig];
      const textures = Array.isArray(entry) ? entry : entry.textures;
      const normals = !Array.isArray(entry) && !!entry.normals;
      for (const tex of textures) {
        const url = `assets/sprites/rigs/${tex}.png`;
        this.load.image(`rig_${tex}`, normals ? [url, `assets/sprites/rigs/${tex}_n.png`] : url);
      }
    }
    this.load.once('complete', () => {
      this.anims.create({ key: 'coin_spin', frames: this.anims.generateFrameNumbers('prop_coin', { start: 0, end: 11 }), frameRate: 14, repeat: -1 });
      this.anims.create({ key: 'gem_spin', frames: this.anims.generateFrameNumbers('prop_gem', { start: 0, end: 11 }), frameRate: 10, repeat: -1 });
      this.anims.create({ key: 'flame', frames: this.anims.generateFrameNumbers('fx_flame', { start: 0, end: 5 }), frameRate: 12, repeat: -1 });
      this.scene.start('Title');
    });
    this.load.start();
  }
}
