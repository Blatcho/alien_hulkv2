import { COMBAT } from '../config.js';

// Active hitboxes are rectangles owned by an attacker for a time window. Each frame they are tested
// against the opposing faction; each (hitbox, target) pair connects at most once.
export default class Combat {
  constructor(scene) {
    this.scene = scene;
    this.hitboxes = [];
    this.debug = false;
    this.gfx = null;
  }

  add(hb) {
    // hb: { owner, faction:'player'|'enemy', x, y, w, h, damage, knockback, heavy, kind, hits:Set, follow:fn }
    hb.hits = new Set();
    hb.active = true;
    this.hitboxes.push(hb);
    return hb;
  }

  remove(hb) { hb.active = false; }

  clearOwner(owner) { for (const hb of this.hitboxes) if (hb.owner === owner) hb.active = false; }

  update(player, enemies) {
    if (this.debug && !this.gfx) this.gfx = this.scene.add.graphics().setDepth(99);
    if (this.gfx) this.gfx.clear();
    const alive = [];
    for (const hb of this.hitboxes) {
      if (!hb.active) continue;
      if (hb.follow) hb.follow(hb);
      if (this.gfx) this.gfx.lineStyle(1, hb.faction === 'player' ? 0x40ff40 : 0xff4040).strokeRect(hb.x - hb.w / 2, hb.y - hb.h / 2, hb.w, hb.h);
      const targets = hb.faction === 'player' ? enemies : [player];
      for (const t of targets) {
        if (!t || !t.alive || hb.hits.has(t)) continue;
        if (t.invulnerable) continue;
        const b = t.hitBounds();
        if (Math.abs(b.x - hb.x) * 2 < b.w + hb.w && Math.abs(b.y - hb.y) * 2 < b.h + hb.h) {
          hb.hits.add(t);
          this.resolve(hb, t);
        }
      }
      alive.push(hb);
    }
    this.hitboxes = alive;
  }

  resolve(hb, target) {
    let dmg = hb.damage;
    let crit = false;
    if (hb.faction === 'player' && Math.random() < (hb.critChance || COMBAT.critChanceBase)) { crit = true; dmg *= COMBAT.critMultiplier; }
    dmg = Math.max(1, Math.round(dmg));
    const dir = Math.sign(target.x - (hb.owner ? hb.owner.x : hb.x)) || 1;
    target.takeHit({ damage: dmg, dir, knockback: hb.knockback, heavy: hb.heavy, crit, source: hb.owner, kind: hb.kind, x: hb.x, y: hb.y });
  }
}
