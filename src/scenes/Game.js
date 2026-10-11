import { WIDTH, HEIGHT, PLAYER, DEPTH } from '../config.js';
import { getInput } from '../input/Input.js';
import Parallax from '../systems/Parallax.js';

// Milestone 1 placeholder world: flat ground, rectangle player, camera follow.
export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) { this.zoneKey = (data && data.zone) || 'thornmoor'; }

  create() {
    this.input_ = getInput();
    const worldW = 6000;
    this.physics.world.setBounds(0, -2000, worldW, HEIGHT + 2000);
    const bgMeta = this.cache.json.get('bg_layers')[this.zoneKey];
    this.parallax = new Parallax(this, this.zoneKey, bgMeta);
    this.ground = this.physics.add.staticGroup();
    const g = this.add.rectangle(0, bgMeta.ground_y, worldW, 120, 0x1c1a16, 0).setOrigin(0);
    this.ground.add(g);
    this.player = this.add.rectangle(200, 500, PLAYER.bodyWidth, PLAYER.bodyHeight, 0x9a8a6a).setDepth(DEPTH.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.hp = 100; this.player.maxHp = 100; this.player.stamina = 100; this.player.maxStamina = 100; this.player.gold = 0;
    this.physics.add.collider(this.player, this.ground);
    this.cameras.main.setBounds(0, 0, worldW, HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, 0, 120);
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  update(time, delta) {
    const inp = this.input_;
    inp.update(this.game.loop.frame);
    this.parallax.update(time, delta);
    const body = this.player.body;
    body.setVelocityX(inp.moveX * PLAYER.runSpeed);
    if (inp.pressed.jump && body.blocked.down) body.setVelocityY(PLAYER.jumpVelocity);
  }
}
