// Player progression: base stats, levelling, and the derived numbers combat uses.
export const XP_CURVE = (level) => Math.round(60 * Math.pow(level, 1.55));

export default class Stats {
  constructor(save) {
    this.level = 1;
    this.xp = 0;
    this.str = 5; this.vit = 5; this.agi = 5;
    this.points = 0;
    this.gear = { claws: null, hide: null, charm: null };
    if (save) Object.assign(this, save);
    this.recalc();
  }

  recalc() {
    const g = this.gearBonus();
    this.maxHp = 90 + this.vit * 12 + (g.hp || 0);
    this.maxStamina = 80 + this.agi * 5 + (g.stamina || 0);
    this.staminaRegen = 26 + this.agi * 0.8 + (g.regen || 0);
    this.baseDamage = 12 + this.str * 2.4 + (g.damage || 0);
    this.critChance = 0.05 + this.agi * 0.006 + (g.crit || 0);
    this.speedMult = 1 + (g.speed || 0);
    this.reachMult = 1 + (g.reach || 0);
    this.damageTakenMult = Math.max(0.35, 1 - (g.armor || 0) / 100);
    this.lifesteal = g.lifesteal || 0;
    this.goldFind = 1 + (g.goldFind || 0);
  }

  gearBonus() {
    const total = {};
    for (const slot of Object.keys(this.gear)) {
      const item = this.gear[slot];
      if (!item) continue;
      for (const [k, v] of Object.entries(item.mods || {})) total[k] = (total[k] || 0) + v;
    }
    return total;
  }

  damage() { return this.baseDamage * (0.9 + Math.random() * 0.2); }

  xpToNext() { return XP_CURVE(this.level); }

  addXp(n) {
    this.xp += n;
    let levels = 0;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level += 1; levels += 1;
      this.str += 1; this.vit += 1; this.agi += 1; this.points += 2;
    }
    if (levels) this.recalc();
    return levels;
  }

  spend(stat) {
    if (this.points <= 0 || !['str', 'vit', 'agi'].includes(stat)) return false;
    this.points -= 1; this[stat] += 1; this.recalc(); return true;
  }

  equip(item) {
    const prev = this.gear[item.slot];
    this.gear[item.slot] = item;
    this.recalc();
    return prev;
  }

  toJSON() {
    return { level: this.level, xp: this.xp, str: this.str, vit: this.vit, agi: this.agi, points: this.points, gear: this.gear };
  }
}
