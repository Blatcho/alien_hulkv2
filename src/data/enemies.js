// Enemy archetypes. Numbers are per-level base values; the spawner scales them by zone tier.
// Every humanoid is the painted undead knight (assets/rigs/undead.json, cut from the concept sheet by
// tools/undead_from_concept.py); the variants differ in loadout, tint, size and behaviour.
export const ENEMY_TYPES = {
  knight: {
    rig: 'undead', clipOpts: { shield: true }, shield: true, tint: 0xd4dcec, hp: 70, damage: 14, speed: 120, scale: 1.08,
    attack: { clip: 'slash', reach: 95, cooldown: 1100, range: 110 }, aggro: 520, xp: 24, tier: 1,
    armored: true, bone: true, guardChance: 0.35, staggerThreshold: 18, hurtSfx: 'sfx_skeleton_rattle', deathSfx: 'sfx_enemy_death',
    bodyW: 44, bodyH: 124, name: 'Bone Knight', poise: 2, wander: true,
  },
  spearman: {
    rig: 'undead', clipOpts: {}, tint: 0xb6c6aa, hp: 48, damage: 11, speed: 150, scale: 0.98,
    attack: { clip: 'thrust', reach: 130, cooldown: 1400, range: 145 }, aggro: 600, xp: 20, tier: 1,
    armored: false, bone: true, guardChance: 0, staggerThreshold: 10, hurtSfx: 'sfx_skeleton_rattle', deathSfx: 'sfx_enemy_death',
    bodyW: 40, bodyH: 116, name: 'Grave Reaver', poise: 1,
  },
  skeleton: {
    rig: 'undead', clipOpts: {}, tint: 0xc4c0bc, hp: 40, damage: 10, speed: 110, scale: 1,
    attack: { clip: 'slash', reach: 85, cooldown: 900, range: 100 }, aggro: 480, xp: 16, tier: 1,
    armored: false, bone: true, guardChance: 0, staggerThreshold: 8, hurtSfx: 'sfx_skeleton_rattle', deathSfx: 'sfx_skeleton_rattle',
    bodyW: 36, bodyH: 118, name: 'Hollow Bones', poise: 0, rattle: true, wander: true,
  },
  bat: {
    rig: 'bat', flying: true, hp: 18, damage: 7, speed: 230, scale: 1.3,
    attack: { clip: 'attack', reach: 40, cooldown: 1600, range: 60 }, aggro: 650, xp: 8, tier: 0,
    armored: false, guardChance: 0, staggerThreshold: 0, hurtSfx: 'sfx_bat', deathSfx: 'sfx_bat',
    bodyW: 40, bodyH: 30, name: 'Gloom Bat', poise: 0, hoverY: 118,
  },
  warden: {
    rig: 'undead', clipOpts: {}, tint: 0xe0b4a4, hp: 900, damage: 26, speed: 95, scale: 1.5,
    attack: { clip: 'overhead', reach: 170, cooldown: 1500, range: 190 }, aggro: 900, xp: 400, tier: 3,
    armored: true, bone: true, guardChance: 0.15, staggerThreshold: 60, hurtSfx: 'sfx_hit_metal1', deathSfx: 'sfx_boss_roar',
    bodyW: 70, bodyH: 196, name: 'The Gate Warden', poise: 5, boss: true,
    extraAttacks: [{ clip: 'sweep', reach: 230, range: 260, chance: 0.4 }],
  },
};
