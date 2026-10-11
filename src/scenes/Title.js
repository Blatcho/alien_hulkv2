import { WIDTH, HEIGHT } from '../config.js';
import { getInput, promptFor } from '../input/Input.js';

export default class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.input_ = getInput();
    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x0a0c14).setOrigin(0);
    this.add.text(WIDTH / 2, HEIGHT * 0.36, 'BEAST OF THORNMOOR', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '72px', color: '#d8c7a0',
      stroke: '#2a0b0b', strokeThickness: 8,
    }).setOrigin(0.5);
    this.prompt = this.add.text(WIDTH / 2, HEIGHT * 0.62, '', {
      fontFamily: 'Georgia, serif', fontSize: '28px', color: '#b8b0a0',
    }).setOrigin(0.5);
    this.tweens.add({ targets: this.prompt, alpha: 0.35, duration: 800, yoyo: true, repeat: -1 });
    this.padText = this.add.text(WIDTH / 2, HEIGHT - 40, '', { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#6f6a60' }).setOrigin(0.5);
    this.started = false;
  }

  update() {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    const dev = inp.lastDevice;
    this.prompt.setText(dev === 'gamepad' ? 'Press START' : 'Press ENTER');
    this.padText.setText(inp.padConnected ? `Controller: ${inp.padId}` : 'No controller detected — keyboard: A/D move, Space jump, J/K attack, L dodge');
    if (!this.started && (inp.pressed.pause || inp.pressed.confirm || inp.pressed.jump)) {
      this.started = true;
      inp.consume('pause'); inp.consume('confirm'); inp.consume('jump');
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('Game', { zone: 'thornmoor' });
        this.scene.launch('HUD');
      });
    }
  }
}
