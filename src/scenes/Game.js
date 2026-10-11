import { WIDTH, HEIGHT, PLAYER, DEPTH } from '../config.js';
import { getInput } from '../input/Input.js';

// Milestone 1 placeholder world: flat ground, rectangle player, camera follow.
export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) { this.zoneKey = (data && data.zone) || 'thornmoor'; }

  create() {
    this.input_ = getInput();
    const worldW = 6000;
    this.physics.world.setBounds(0, -2000, worldW, HEIGHT + 2000);
    this.add.rectangle(0, 0, worldW, HEIGHT, 0x0c1018).setOrigin(0).setScrollFactor(0.0);
    for (let i = 0; i < 40; i++) {
      this.add.rectangle(i * 300, 420 + (i % 3) * 20, 120, 300, 0x1a2230).setOrigin(0.5, 1).setScrollFactor(0.4, 1);
    }
    this.ground = this.physics.add.staticGroup();
    const g = this.add.rectangle(0, 600, worldW, 120, 0x1c1a16).setOrigin(0);
    this.ground.add(g);
    this.player = this.add.rectangle(200, 500, PLAYER.bodyWidth, PLAYER.bodyHeight, 0x9a8a6a);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.hp = 100; this.player.maxHp = 100; this.player.stamina = 100; this.player.maxStamina = 100; this.player.gold = 0;
    this.physics.add.collider(this.player, this.ground);
    this.cameras.main.setBounds(0, 0, worldW, HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, 0, 120);
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  update() {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    const body = this.player.body;
    body.setVelocityX(inp.moveX * PLAYER.runSpeed);
    if (inp.pressed.jump && body.blocked.down) body.setVelocityY(PLAYER.jumpVelocity);
  }
}
