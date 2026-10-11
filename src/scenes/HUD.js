import { WIDTH, HEIGHT } from '../config.js';

export default class HUDScene extends Phaser.Scene {
  constructor() { super('HUD'); }

  create() {
    this.debugText = this.add.text(16, HEIGHT - 28, '', { fontFamily: 'monospace', fontSize: '14px', color: '#8a8a8a' });
    this.hpBg = this.add.rectangle(90, 40, 300, 16, 0x1a0a0a).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(92, 40, 296, 12, 0xc0201a).setOrigin(0, 0.5);
    this.stBg = this.add.rectangle(90, 62, 220, 10, 0x0a140a).setOrigin(0, 0.5);
    this.stBar = this.add.rectangle(92, 62, 216, 6, 0x4caf50).setOrigin(0, 0.5);
    this.gold = this.add.text(WIDTH - 24, 28, '0', { fontFamily: 'Georgia, serif', fontSize: '24px', color: '#e0c060' }).setOrigin(1, 0.5);
  }

  update() {
    const game = this.scene.get('Game');
    const p = game && game.player;
    if (!p) return;
    this.hpBar.width = 296 * Math.max(0, p.hp / p.maxHp);
    this.stBar.width = 216 * Math.max(0, p.stamina / p.maxStamina);
    this.gold.setText(String(p.gold || 0));
    this.debugText.setText(`${Math.round(game.game.loop.actualFps)} fps  x:${Math.round(p.x)}  ${game.input_.lastDevice}`);
  }
}
