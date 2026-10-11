import { DEPTH } from '../config.js';

const RARITY_TINT = { common: 0xd0c8b8, rare: 0x5aa0ff, epic: 0xc060ff, legendary: 0xffa030 };

// Physics pickups: coins, potions, gear orbs. They bounce, settle, then drift to the player when close.
export default class Pickup {
  constructor(scene, x, y, drop) {
    this.scene = scene;
    this.drop = drop;
    this.alive = true;
    this.age = 0;
    const type = drop.type;
    let key = 'prop_coin', frame = 0, anim = null;
    if (type === 'gold') { key = 'prop_coin'; anim = 'coin_spin'; }
    else if (type === 'potion') { key = 'prop_potion_red'; }
    else if (type === 'item') { key = 'prop_gem'; anim = 'gem_spin'; }
    else if (type === 'gem') { key = 'prop_gem'; anim = 'gem_spin'; }
    this.sprite = scene.physics.add.sprite(x, y, key, frame).setDepth(DEPTH.pickups);
    if (anim && scene.anims.exists(anim)) this.sprite.play(anim);
    if (type === 'item') { this.sprite.setTint(RARITY_TINT[drop.item.rarity] || 0xffffff).setScale(1.2); }
    this.sprite.body.setBounce(0.45, 0.45).setCollideWorldBounds(true).setDrag(300, 0);
    this.sprite.body.setVelocity((Math.random() - 0.5) * 260, -300 - Math.random() * 200);
    this.sprite.body.setSize(24, 24);
    this.glow = scene.add.image(x, y, 'glow').setDepth(DEPTH.pickups - 1).setScale(type === 'item' ? 0.5 : 0.22).setAlpha(0.35).setBlendMode('ADD');
    if (type === 'item') this.glow.setTint(RARITY_TINT[drop.item.rarity]);
    else if (type === 'potion') this.glow.setTint(0xff4040);
    else if (type === 'gem') this.glow.setTint(0x60ffd0);
    scene.physics.add.collider(this.sprite, scene.ground);
    scene.physics.add.collider(this.sprite, scene.platforms);
  }

  update(dt) {
    if (!this.alive) return;
    this.age += dt;
    const p = this.scene.player;
    const s = this.sprite;
    this.glow.setPosition(s.x, s.y).setAlpha(0.3 + 0.15 * Math.sin(this.age / 150));
    if (!p.alive) return;
    const dx = p.x - s.x, dy = p.y - s.y;
    const d = Math.hypot(dx, dy);
    const magnet = this.drop.type === 'gold' ? 150 : 90;
    if (this.age > 350 && d < magnet) {
      s.body.setAllowGravity(false);
      s.body.setVelocity(dx / d * 700, dy / d * 700);
    }
    if (this.age > 250 && d < 34) this.collect();
    if (this.age > 60000) this.destroy();
  }

  collect() {
    const s = this.scene;
    const p = s.player;
    const d = this.drop;
    if (d.type === 'gold') { const n = Math.round(d.amount * p.stats.goldFind); p.gold += n; s.events.emit('gold', n); s.audio.play('sfx_coin', { volume: 0.6 }); s.fx.number(p.x, p.y - 80, `+${n}`, { color: 0xffd060, size: 0.9 }); }
    else if (d.type === 'potion') { p.potions += 1; s.audio.play('sfx_loot'); s.events.emit('toast', 'Potion found', 1200); }
    else if (d.type === 'gem') { const lv = p.stats.addXp(d.amount); s.audio.play('sfx_gem'); s.fx.number(p.x, p.y - 80, `+${d.amount} souls`, { color: 0x80ffd0, size: 0.9 }); if (lv) s.onLevelUp(lv); }
    else if (d.type === 'item') { s.addItemToInventory(d.item); s.audio.play('sfx_loot'); }
    this.destroy();
  }

  destroy() {
    this.alive = false;
    this.sprite.destroy(); this.glow.destroy();
    const i = this.scene.pickups.indexOf(this);
    if (i >= 0) this.scene.pickups.splice(i, 1);
  }
}
