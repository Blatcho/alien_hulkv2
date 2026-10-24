// Marine gunnery: rules-of-engagement target selection, burst fire, hitscan through Rapier,
// reloads. Every trooper carries their loadout's weapon (config WEAPONS): the carbine
// bursts, the heavy repeater hoses, the breacher fires pellet spreads with damage falloff,
// the marksman rifle takes slow precise shots from further away.
// Friendly fire is impossible: marine rays only test world + alien + critter groups.
//
// Lead mode: the player's own marine (m.controlled) shoots for himself - updatePlayerCombat:
// the right stick aims, the trigger fires; a hostile close to his line of aim draws the rounds
// in (assist), so a thumb-stick is enough against something skittering along a ceiling.
import { practice } from './stats.js';
import { ABILITY, BREAK, DRILL, ROE } from '../core/config.js';
import { G } from '../physics/physics.js';
import { bodyPoint, canSee } from '../vis/sight.js';
import { barrelValue, blastSafe } from './hazards.js';

const DEG = Math.PI / 180;
const ASSIST_CONE = 0.32;  // rad off the player's line of aim within which a hostile draws fire
const HELD_SPREAD = 0.8;   // x spread after a couple of seconds on the trigger (lead)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Pure ROE filter: may this marine shoot at entity e under the current mental state?
 *   cautious  only hostiles, and only after the squad has been attacked
 *   normal    anything that MOVES: awake hostiles, scurrying vermin, and survivors nobody has
 *             identified yet (friendly fire!). Sleeping hostiles don't move, so they're left alone.
 *   alert     every hostile, sleeping ones included; nothing else (disciplined)
 */
export function roeAllows(roe, e, { attackedRecently, quietVermin = false }) {
  if (!e.alive) return false;
  if (e.kind === 'prop') return roe !== ROE.CAUTIOUS || attackedRecently;
  if (e.kind === 'survivor') return roe === ROE.NORMAL && !e.identified && e.moving;
  const hostile = e.kind === 'alien' && e.state !== 'vent';
  switch (roe) {
    case ROE.CAUTIOUS: return hostile && attackedRecently;
    case ROE.NORMAL: return (hostile && e.state !== 'dormant') || (e.kind === 'critter' && e.moving && !quietVermin);
    case ROE.ALERT: return hostile;
    default: return false;
  }
}

function canShoot(m) {
  return m.alive && (m.mode === 'walk' || m.mode === 'crouch') && m.reloadT <= 0 && m.signalT <= 0;
}

export function muzzle(m, crouched) {
  return { x: m.x + m.facing * 0.85, y: m.y + (crouched ? 1.05 : 1.5) * (m.scale ?? 1) };
}

/** A man gone berserk (sim/breakdown.js): faster, wilder, quicker on the trigger. */
const berserk = (m, k) => (m.breakdown?.mode === 'berserk' ? BREAK.BERSERK[k] : 1);

function pickTarget(world, m) {
  const W = m.weapon;
  const ctx = { attackedRecently: world.time - world.attackedAt < ROE.ATTACKED_WINDOW, quietVermin: !!world.relics?.has('ships_cat') };
  // Berserk: every hostile in sight, whatever the fire discipline.
  const roe = m.breakdown?.mode === 'berserk' ? ROE.ALERT : world.settings.roe;
  let best = null;
  let bestScore = Infinity;
  for (const e of world.targets()) {
    // A barrel the player pointed at is shot regardless of fire discipline - once it's safe.
    const forced = e.kind === 'prop' && world.doctrine?.forced === e && blastSafe(world, e);
    if (!forced && !roeAllows(roe, e, ctx)) continue;
    const c = bodyPoint(e, 0.5); // up on a wall or the ceiling too
    const dx = c.x - m.x;
    const d = Math.hypot(dx, e.y - m.y);
    if (d > W.range || !e.visible) continue;
    if (!canSee(world, m, e)) {
      // Allow turning to face a close threat behind us.
      if (!(d < 5 && world.physics.los(m.x, m.y + 1.4, c.x, c.y))) continue;
    }
    // Needs a clear line of fire from the muzzle too (eye LOS through a shaft isn't enough).
    const side = Math.sign(dx) || m.facing;
    if (!world.physics.los(m.x + side * 0.85, m.y + 1.3, c.x, c.y)) continue;
    let score = d + (Math.sign(dx) !== m.facing ? 3 : 0) + (e.kind === 'critter' ? 4 : 0) + (e.state === 'dormant' ? 2 : 0);
    if (e.kind === 'prop') {
      // Tactical shot: only when hostiles crowd a fuel barrel and no friendly is near it.
      const value = barrelValue(world, e);
      if (!value && !forced) continue;
      score -= forced ? 50 : 12 * value;
    }
    if (W.pellets > 1 && d > W.range * 0.7) score += 6; // breachers wait for close targets
    // Priorities: one dragging a man off, a screamer (before it calls them all in), one getting away.
    if (e.drag) score -= 10;
    if (e.screams) score -= 8;
    if (e.flee) score -= 2;
    // Sticky targeting: the current target gets a bonus so troopers don't spin between
    // threats on either side every few frames.
    if (e === m.target) score -= 4;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/**
 * One shot (every pellet of it). `t` is what he's shooting at; `aim` (lead mode) the player's own
 * line of fire in radians, in which case `t` may be null (he fires where he points) or the
 * hostile his aim is drawn to.
 */
function fire(world, m, t, aim = null) {
  const W = m.weapon;
  const crouched = m.crouch || world.squad.cover;
  const o = muzzle(m, crouched);
  const { x: tx, y: ty } = t ? bodyPoint(t, 0.5) : { x: o.x + Math.cos(aim) * W.range, y: o.y + Math.sin(aim) * W.range };
  let spread = W.spread * m.mods.spread * (m.panicT > 0 ? 2.2 : 1) * world.morale.mods.spread * berserk(m, 'SPREAD'); // panicking: firing wild
  if (crouched) spread *= 0.6;
  if (m.role === 'heavy' && world.squad.cover) spread *= ABILITY.HOLD.spread; // holding the line
  if (world.squad.running && m.moving) spread *= 1.8;
  if (world.settings.roe === ROE.ALERT) spread *= 0.8;
  if (world.stimT > 0) spread *= 0.75;
  if (t?.moving && W.pellets === 1) spread *= t.state === 'leap' || t.state === 'drop' || t.state === 'spring' ? 2.4 : 1.7; // skittering targets are hard to track
  if (aim !== null) spread *= 1 + HELD_SPREAD * Math.min(1, (m.fireT ?? 0) / 2); // the longer he leans on the trigger, the wilder
  const base = Math.atan2(ty - o.y, tx - o.x);
  const rays = [];
  for (let p = 0; p < W.pellets; p++) {
    const ang = base + world.rng.float(-spread, spread) * DEG * (W.pellets > 1 ? 1 : 1 + Math.abs(tx - o.x) / 20);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const mask = G.WORLD | G.ALIEN | G.CRITTER | G.SURVIVOR | (t?.kind === 'prop' || aim !== null ? G.PROP : 0);
    let hit = world.physics.raycast(o.x, o.y, dx, dy, W.range, mask);
    // A round that misses its target can still find a barrel or console on its way.
    if (t && t.kind !== 'prop' && hit?.entity !== t) {
      // (Barrels right next to the shooter sit below the line of fire.)
      const stray = world.physics.raycast(o.x, o.y, dx, dy, hit ? hit.dist : W.range, G.PROP);
      if (stray && stray.dist > 3) hit = stray;
    }
    const x1 = hit ? hit.x : o.x + dx * W.range;
    const y1 = hit ? hit.y : o.y + dy * W.range;
    rays.push({ x1, y1, entity: hit?.entity ?? null, wall: !!hit && !hit.entity, dx, dy, dist: hit ? hit.dist : W.range });
  }
  m.mag--;
  m.shots++;
  world.stats.shots++;
  world.noise(m.x, m.y, W.noise);
  const first = rays[0];
  world.emit('shot', { marine: m, weapon: m.weaponKey, x0: o.x, y0: o.y, x1: first.x1, y1: first.y1, entity: first.entity, wall: first.wall, rays });
  for (const r of rays) {
    if (!r.entity) continue;
    let dmg = world.rng.int(W.damage[0], W.damage[1]) * (world.stimT > 0 ? 1.15 : 1) * m.mods.damage;
    if (m.mods.crit > 0 && world.luck.chance(m.mods.crit)) { dmg *= 1.8; practice(m, 'lck', 0.15); } // Luck
    if (r.entity.kind === 'alien') practice(m, 'acc', 1 / (W.pellets ?? 1));
    if (W.falloff) dmg *= Math.min(1, Math.max(0.25, 1.25 - r.dist / W.range));
    // The marksman: a round into one that hasn't noticed the squad (asleep, or shadowing it).
    if (m.role === 'marksman' && r.entity.kind === 'alien' && (r.entity.state === 'dormant' || r.entity.stalk)) dmg *= ABILITY.SNIPE;
    world.damage(r.entity, dmg, m, { x: r.x1, y: r.y1, dx: r.dx, dy: r.dy, stagger: m.mods.stagger === 1 ? W.stagger : (W.stagger ?? 0.12) * m.mods.stagger });
  }
}

/** Someone else in his room already changing mags? */
const reloading = (world, m) => world.squad.order.some((o) => o !== m && o.reloadT > 0 && o.room === m.room);

/** Change mags (a top-up, or empty). A squad-mate calls out that he's covering him. */
function reload(world, m, topup = false) {
  m.reloadT = m.weapon.reload * m.mods.reload;
  world.emit('reload', { marine: m, topup });
  world.bark(m, topup ? 'topup' : 'reload', topup ? 0.3 : 0.5);
  const mate = world.squad.order.find((o) => o !== m && o.target && o.room === m.room && o.reloadT <= 0);
  if (mate && !topup) world.barks.later(0.4, mate, 'covering', 0.5);
}

/** A squad-mate needs covering: reloading, working on a man down, or down himself. */
function covering(world, m) {
  const sq = world.squad;
  return reloading(world, m) || (sq.action?.type === 'revive' && sq.action.by !== m) || world.marines.some((o) => o.alive && o.down && o.room === m.room);
}

export function updateMarineCombat(world, m, dt) {
  if (!m.alive) return;
  const W = m.weapon;
  if (m.reloadT > 0) {
    m.reloadT -= dt;
    if (m.reloadT <= 0) {
      const take = Math.min(W.mag - m.mag, m.reserve);
      m.mag += take;
      m.reserve -= take;
    }
  }
  if (m.controlled) return updatePlayerCombat(world, m, dt);
  // Frozen, running or hiding (sim/breakdown.js): not firing.
  if (m.breakdown && m.breakdown.mode !== 'berserk') { m.target = null; m.burst = 0; return; }
  // Power fists (no gun): he only tracks the nearest threat to face it - sim/melee.js does the rest.
  if (W.melee) {
    m.targetT -= dt;
    if (m.targetT <= 0) { m.targetT = 0.25; m.target = pickTarget(world, m); }
    if (m.target && !m.target.alive) m.target = null;
    if (m.target && !m.strikeT) m.facing = Math.sign(m.target.x - m.x) || m.facing;
    m.burst = 0;
    return;
  }
  if (m.strikeT > 0) return; // mid-swing with his sword (sim/melee.js)
  m.targetT -= dt;
  if (m.target && (!m.target.alive || m.target.state === 'vent')) m.target = null;
  if (m.targetT <= 0) {
    m.targetT = 0.2 + world.rng.float(0, 0.1);
    const next = canShoot(m) || m.reloadT > 0 ? pickTarget(world, m) : null;
    // Snap to a new target before firing; weapons already up (engaged stance) react faster.
    if (next && next !== m.target) m.acquireT = (next.kind === 'prop' ? 0.12 : world.settings.roe === ROE.ALERT ? 0.2 : m.stance === 'engaged' ? 0.32 : m.stance === 'alert' ? 0.42 : 0.62) * m.mods.acquire * (m.panicT > 0 ? 1.6 : 1) * world.morale.mods.acquire * berserk(m, 'ACQUIRE');
    m.target = next;
  }
  if (m.acquireT > 0) { m.acquireT -= dt; if (m.target) m.facing = Math.sign(m.target.x - m.x) || m.facing; return; }
  const t = m.target;
  // The minigun spins up before it fires (and winds down with nothing to shoot at).
  if (W.spin) {
    const was = m.spin ?? 0;
    m.spin = t ? Math.min(1, was + dt / W.spin) : Math.max(0, was - dt / (W.spin * 2));
    if (t && was === 0) world.emit('spin-up', { marine: m });
    if (t && m.spin < 1) { m.pauseT = Math.max(0, (m.pauseT ?? 0) - dt); return; } // (both at once)
  }
  if (!t) {
    m.burst = 0;
    // A lull: top up a half-empty magazine - one man at a time.
    if (canShoot(m) && !world.squad.engaged && m.mag < W.mag * DRILL.TOPUP && m.reserve > 0 && !reloading(world, m)) reload(world, m, true);
    return;
  }
  const dir = Math.sign(t.x - m.x) || m.facing;
  if (dir !== m.facing) { m.facing = dir; m.turnT = 0.18; }
  if (m.turnT > 0) { m.turnT -= dt; return; }
  if (!canShoot(m)) return;
  // Staggered reloads: running low while nobody else is changing mags and someone else is still
  // firing - change now, so the squad never runs dry all at once. (Not with one in his face.)
  if (m.mag > 0 && m.mag <= W.mag * DRILL.LOW && m.reserve > 0 && m.burst <= 0 && !reloading(world, m)
    && world.squad.order.some((o) => o !== m && o.target && o.room === m.room && o.reloadT <= 0)
    && !world.aliens.some((a) => a.alive && a.room === m.room && Math.abs(a.x - m.x) < 3)) {
    reload(world, m);
    return;
  }
  if (m.mag <= 0) {
    if (m.reserve > 0) {
      reload(world, m);
    } else if (!m.dry) {
      m.dry = true;
      world.bark(m, 'dry');
    }
    return;
  }
  if (m.pauseT > 0) { m.pauseT -= dt; return; }
  if (m.burst <= 0) {
    m.burst = world.rng.int(W.burst[0], W.burst[1]);
    m.shotT = 0;
  }
  const rate = W.rate * (world.stimT > 0 ? 1.2 : 1) * (world.settings.roe === ROE.ALERT ? 1.1 : 1) * (m.role === 'heavy' && world.squad.cover ? ABILITY.HOLD.rate : 1) * berserk(m, 'RATE');
  m.shotT -= dt;
  while (m.shotT <= 0 && m.burst > 0 && m.mag > 0) {
    fire(world, m, t);
    m.burst--;
    m.shotT += 1 / rate;
    if (!t.alive) break;
  }
  if (m.burst <= 0 || !t.alive) { m.burst = 0; m.pauseT = W.pause * world.rng.float(0.7, 1.4) * (covering(world, m) ? DRILL.COVER : 1); }
}

/** Lead: the hostile nearest the player's line of aim (within the assist cone) with a clear shot. */
function pickPlayerTarget(world, m, angle) {
  const W = m.weapon;
  const o = muzzle(m, m.crouch || world.squad.cover);
  let best = null;
  let bestScore = Infinity;
  for (const e of world.targets()) {
    if (!e.alive || e.kind === 'survivor' || !e.visible) continue;
    if (e.kind === 'alien' && e.state === 'vent') continue;
    const c = bodyPoint(e, 0.5);
    const d = Math.hypot(c.x - o.x, c.y - o.y);
    if (d > W.range) continue;
    const off = Math.abs(wrap(Math.atan2(c.y - o.y, c.x - o.x) - angle));
    if (off > ASSIST_CONE) continue;
    if (!world.physics.los(o.x, o.y, c.x, c.y)) continue;
    let score = off * 12 + d * 0.3 + (e.kind === 'critter' ? 4 : 0) + (e.kind === 'prop' ? 2 : 0);
    if (e === m.target) score -= 1.5; // sticky
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/**
 * Lead mode: the player's own gun. The right stick aims him (and turns him), the trigger fires
 * at the weapon's rate for as long as it's held and there's a round in the mag; RB changes mags
 * (world.reloadWeapon). m.target is what his aim is drawn to - the HUD marks it - and nothing
 * fires by itself.
 */
function updatePlayerCombat(world, m, dt) {
  const W = m.weapon;
  const pad = world.pad;
  const stick = Math.hypot(pad.aimX, pad.aimY);
  m.aiming = stick > 0.35 && !m.down;
  if (m.aiming) {
    if (Math.abs(pad.aimX) > 0.25) m.facing = Math.sign(pad.aimX);
    m.aimAngle = Math.atan2(pad.aimY, Math.abs(pad.aimX)); // elevation (+ up), in his facing
    m.aimSet = true;
  } else { m.aimSet = false; m.aimAngle = 0; }
  if (m.down || (m.breakdown && m.breakdown.mode !== 'berserk')) { m.target = null; m.burst = 0; m.fireT = 0; return; }
  const angle = m.facing > 0 ? m.aimAngle : Math.PI - m.aimAngle;
  if (W.melee) {
    // Power fists: he squares up to the nearest threat; sim/melee.js swings for him.
    m.targetT -= dt;
    if (m.targetT <= 0) { m.targetT = 0.1; m.target = pickPlayerTarget(world, m, angle); }
    if (m.target && !m.target.alive) m.target = null;
    m.burst = 0;
    return;
  }
  if (m.strikeT > 0) return;
  m.targetT -= dt;
  if (m.target && (!m.target.alive || m.target.state === 'vent')) m.target = null;
  if (m.targetT <= 0) { m.targetT = 0.1; m.target = m.aiming || pad.fire ? pickPlayerTarget(world, m, angle) : null; }
  if (m.wantReload) {
    m.wantReload = false;
    if (m.reloadT <= 0 && m.mag < W.mag && m.reserve > 0 && canShoot(m)) reload(world, m, m.mag > 0);
  }
  // The minigun spins up while the trigger is held, and winds down off it.
  if (W.spin) {
    const was = m.spin ?? 0;
    m.spin = pad.fire ? Math.min(1, was + dt / W.spin) : Math.max(0, was - dt / (W.spin * 2));
    if (pad.fire && was === 0) world.emit('spin-up', { marine: m });
  }
  m.shotT -= dt;
  if (!pad.fire || (W.spin && m.spin < 1)) { m.burst = 0; m.fireT = 0; m.shotT = Math.max(0, m.shotT); return; }
  if (!canShoot(m)) { m.burst = 0; return; } // changing mags, on a ladder, signalling
  if (m.mag <= 0) {
    m.burst = 0;
    if (m.reserve > 0) reload(world, m);
    else if (!m.dry) { m.dry = true; world.bark(m, 'dry'); }
    return;
  }
  m.fireT = (m.fireT ?? 0) + dt;
  m.burst = 1;
  const rate = W.rate * (world.stimT > 0 ? 1.2 : 1) * (m.role === 'heavy' && world.squad.cover ? ABILITY.HOLD.rate : 1) * berserk(m, 'RATE');
  while (m.shotT <= 0 && m.mag > 0) {
    if (m.target && !m.target.alive) m.target = null;
    fire(world, m, m.target, angle);
    m.shotT += 1 / rate;
  }
}
