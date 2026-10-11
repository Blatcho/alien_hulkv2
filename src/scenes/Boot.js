import { WIDTH, HEIGHT } from '../config.js';

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
    this.load.once('complete', () => this.scene.start('Title'));
    this.load.start();
  }
}
