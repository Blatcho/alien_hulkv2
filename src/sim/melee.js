// Close quarters and specialists.
//
// Power weapons (config MELEE): the duelist's power sword and the brawler's power fists. Anything
// awake within reach - even clawing the man ahead - takes a blow: a swing (the trooper's slash or
// punch), and a moment later it lands: damage (Strength adds to it), a stagger, a knock back and
// its own swing lost. The sword cuts two at once; the fists knock back even brutes. A man with a
// power weapon never needs the shove below.
//
// The shove: one of them clawing at a trooper from right in front of him - and he drives it back
// with his weapon: it staggers, loses its swing, and he gets a second. Most likely when he can't
// shoot it (reloading, dry); Strength helps; a breacher does it hard and often. Brutes and the
// brood mother are too heavy to shove. (Own RNG stream.)
//
// Specialists (meta/candidates.js archetypes; the original four by their kit - entities.js):
//   veteran   steadies the squad: while he stands, morale never gets to BREAKING (morale.js)
//   heavy     holds the line: in Cover he fires faster and tighter; his rounds pin them down
//   breacher  shoves hard and often (here); gets a door open in half the time (squad.js)
//   marksman  a round into something that hasn't noticed the squad hits for SNIPE x (combat.js)
//   scout     sharp eyes: nothing shadows the squad within SPOT metres of him unseen (alien.js)
//   tech      a cutting torch: welds doors and vents shut without a charge (encounters.js)
//   medic     field dressings (DRESSINGS a mission): patches up a hurt man nearby in a lull (here)
//   rookie    green - but born lucky (his Luck)
import { ABILITY, BREAK, MELEE, SHOVE } from '../core/config.js';
import { walkLimits } from '../gen/layout.js';
import { bodyPoint } from '../vis/sight.js';
import { practice } from './stats.js';

/** The man of this specialism in the squad, on his feet (or null). */
export const specialist = (world, role) => world.squad.order.find((m) => m.role === role) ?? null;

/** His power weapon (config MELEE), if he has one: the sword at his side, or the fists he wears. */
export const meleeOf = (m) => (m.loadout?.melee ? MELEE[m.loadout.melee] : m.weapon?.melee ? MELEE[m.weaponKey] : null) ?? null;
const meleeKey = (m) => m.loadout?.melee ?? (m.weapon?.melee ? m.weaponKey : null);

/** What he could hit right now: awake hostiles within reach of him (nearest first). */
function inReach(world, m, M) {
  const out = [];
  for (const a of world.aliens) {
    if (!a.alive || a.state === 'vent' || (a.state === 'dormant' && m.breakdown?.mode !== 'berserk')) continue;
    const c = bodyPoint(a, 0.5);
    const d = Math.hypot(c.x - m.x, c.y - (m.y + 1.1));
    if (d > M.reach + 0.3 * (a.scale ?? 1)) continue;
    if (a.room !== m.room && !world.physics.los(m.x, m.y + 1.2, c.x, c.y)) continue;
    out.push([d, a]);
  }
  return out.sort((p, q) => p[0] - q[0]).map(([, a]) => a);
}

/**
 * Power weapons: start a swing at whatever is in reach, land it HIT seconds on. Not while he's on a
 * ladder, broken (bar berserk), or changing mags (the sword hand works the reload too).
 */
export function updateStrikes(world, dt) {
  for (const m of world.squad.order) {
    const M = meleeOf(m);
    if (!M) continue;
    m.strikeT = Math.max(0, (m.strikeT ?? 0) - dt);
    m.strikeCool = Math.max(0, (m.strikeCool ?? 0) - dt);
    if (m.strikeHitT > 0 && (m.strikeHitT -= dt) <= 0) land(world, m, M);
    if (m.strikeCool > 0 || m.strikeT > 0 || m.down || (m.mode !== 'walk' && m.mode !== 'crouch') || m.reloadT > 0) continue;
    if (m.breakdown && m.breakdown.mode !== 'berserk') continue;
    const foes = inReach(world, m, M);
    if (!foes.length) continue;
    const wild = m.breakdown?.mode === 'berserk' ? 0.7 : 1;
    m.strikeCool = M.every * wild * (m.mods?.reload ?? 1); // (Speed makes him quicker with it too)
    m.strikeT = M.anim;
    m.strikeHitT = M.hit;
    m.strikeFoes = foes.slice(0, M.cleave);
    m.strikeAnim = M.clip;
    m.facing = Math.sign(foes[0].x - m.x) || m.facing;
    m.burst = 0; // (a duelist stops shooting to swing)
    world.emit('melee-swing', { marine: m, weapon: meleeKey(m) });
  }
}

/** The blow lands on whoever is still there. */
function land(world, m, M) {
  const dir = m.facing || 1;
  let hits = 0;
  for (const a of m.strikeFoes ?? []) {
    if (!a.alive || a.state === 'vent') continue;
    const c = bodyPoint(a, 0.5);
    if (Math.hypot(c.x - m.x, c.y - (m.y + 1.1)) > M.reach + 0.8) continue; // it got away
    const [lo, hi] = M.damage;
    let dmg = world.melee.float(lo, hi) * (1 + MELEE.STR * ((m.stats?.str ?? 5) - 5)) * (world.stimT > 0 ? 1.15 : 1);
    if (m.mods?.crit > 0 && world.luck.chance(m.mods.crit)) dmg *= 1.8;
    world.damage(a, dmg, m, { x: c.x, y: c.y, dx: dir, dy: 0, stagger: M.stagger });
    hits++;
    world.emit('melee-hit', { marine: m, alien: a, weapon: meleeKey(m), x: c.x, y: c.y, dir });
    if (!a.alive) continue;
    const heavy = a.type === 'brute' || a.type === 'brood';
    if (heavy && !M.heavy) continue;
    const [wl, wr] = walkLimits(world.level.rooms[a.room]);
    if (a.surface === 'floor') a.x = Math.min(wr, Math.max(wl, a.x + dir * M.push * (heavy ? 0.4 : 1)));
    a.staggerT = Math.max(a.staggerT ?? 0, M.stagger * (heavy ? 0.5 : 1));
    if (a.state === 'attack') a.state = 'hunt';
    a.attackT = 0;
    a.repathT = 0;
  }
  m.strikeFoes = null;
  if (hits) {
    practice(m, 'str', 0.6);
    world.barks.say(m, 'melee', 0.25);
  }
}

export function updateMelee(world, dt) {
  updateStrikes(world, dt);
  for (const m of world.squad.order) {
    m.shoveCool = Math.max(0, m.shoveCool - dt);
    m.bashT = Math.max(0, m.bashT - dt);
    if (meleeOf(m)) continue; // (he has better than a shove)
    if (m.shoveCool > 0 || (m.mode !== 'walk' && m.mode !== 'crouch')) continue;
    const a = world.aliens.find((o) => o.alive && o.state === 'attack' && o.target === m && o.surface === 'floor'
      && o.type !== 'brute' && o.type !== 'brood' && Math.abs(o.x - m.x) < SHOVE.REACH && Math.abs(o.y - m.y) < 1);
    if (!a) continue;
    const breacher = m.role === 'breacher';
    m.shoveCool = SHOVE.COOL * (breacher ? 0.6 : 1);
    const pressed = m.reloadT > 0 || m.mag <= 0;
    const p = SHOVE.BASE + 0.06 * ((m.stats?.str ?? 5) - 5) + (pressed ? SHOVE.PRESSED : 0) + (breacher ? SHOVE.BREACHER : 0) + (m.breakdown?.mode === 'berserk' ? BREAK.BERSERK.SHOVE : 0);
    if (!world.melee.chance(p)) continue;
    const dir = Math.sign(a.x - m.x) || m.facing;
    world.damage(a, SHOVE.DAMAGE * (breacher ? 2 : 1), m, { x: a.x, y: a.y + 0.9, dx: dir, dy: 0, stagger: 0 });
    if (!a.alive) continue;
    const [wl, wr] = walkLimits(world.level.rooms[a.room]);
    a.x = Math.min(wr, Math.max(wl, a.x + dir * SHOVE.PUSH * (breacher ? 1.6 : 1)));
    a.staggerT = Math.max(a.staggerT, SHOVE.STAGGER * (breacher ? 1.7 : 1));
    a.state = 'hunt';
    a.attackT = 0;
    a.repathT = 0;
    m.facing = dir;
    m.bashT = 0.4;
    practice(m, 'str', 0.5);
    world.emit('shove', { marine: m, alien: a });
    world.barks.say(m, 'shove', 0.5);
  }
}

/**
 * The medic's field dressings: out of a fight, a hurt man within reach of him (under HURT of his
 * health) gets patched up - DRESSING hp, DRESSINGS of them a mission.
 */
export function updateMedic(world, dt) {
  const k = world.abilities;
  k.dressT -= dt;
  if (k.dressings <= 0 || k.dressT > 0 || world.squad.engaged) return;
  const medic = specialist(world, 'medic');
  if (!medic || medic.reloadT > 0) return;
  const hurt = world.squad.order.find((o) => o.hp < o.maxHp * ABILITY.HURT && o.room === medic.room && Math.abs(o.x - medic.x) < ABILITY.REACH);
  if (!hurt) return;
  k.dressings--;
  k.dressT = ABILITY.DRESS_EVERY;
  hurt.hp = Math.min(hurt.maxHp, hurt.hp + ABILITY.DRESSING);
  medic.signalT = Math.max(medic.signalT, 0.8);
  practice(medic, 'int', 1);
  world.emit('dressing', { marine: hurt, by: medic });
  world.barks.say(medic, 'dressing', 1, { name: hurt.name });
}
