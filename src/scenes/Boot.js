import { WIDTH, HEIGHT } from '../config.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    const bar = this.add.graphics();
    const box = this.add.graphics();
    box.fillStyle(0x111318, 1).fillRect(WIDTH / 2 - 200, HEIGHT / 2 - 12, 400, 24);
    this.load.on('progress', (v) => {
      bar.clear().fillStyle(0x8b1a1a, 1).fillRect(WIDTH / 2 - 196, HEIGHT / 2 - 8, 392 * v, 16);
    });
    // Asset manifest is filled in as the generators produce content.
  }

  create() {
    this.scene.start('Title');
  }
}
