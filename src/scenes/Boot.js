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
    for (const k of ['gate', 'platform', 'fence']) this.load.image(`world_${k}`, `assets/sprites/world/${k}.png`);
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
      for (const L of meta[zone].layers) this.load.image(`bg_${zone}_${L.key}`, `assets/bg/${zone}/${L.key}.png`);
    }
    const props = this.cache.json.get('props_manifest').sprites;
    for (const [name, p] of Object.entries(props)) {
      if (p.frames > 1) this.load.spritesheet(`prop_${name}`, `assets/sprites/props/${p.file}`, { frameWidth: p.frame_width, frameHeight: p.frame_height });
      else this.load.image(`prop_${name}`, `assets/sprites/props/${p.file}`);
    }
    import('../systems/Loot.js').then((m) => this.registry.set('loot', m)).catch((e) => console.warn('Loot module unavailable', e));
    const manifest = this.cache.json.get('rig_manifest');
    for (const rig of Object.keys(manifest)) {
      this.load.json(`rig_${rig}`, `assets/rigs/${rig}.json`);
      for (const tex of manifest[rig]) this.load.image(`rig_${tex}`, `assets/sprites/rigs/${tex}.png`);
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
