// Sentry turrets: a ship's gun on standby (the 'turret' encounter - sim/encounters.js), or one of the
// squad's own Defend guns (world.deployDefence). Either fights for the squad: the nearest awake
// hostile it can see within RANGE gets RATE rounds a second (each hitting for DAMAGE, HIT of the
// time) until its AMMO runs out - config SENTRY, or the gun's own `spec` (DEFEND). Loud, like any
// gun. Its own RNG stream.
import { SENTRY } from '../core/config.js';
import { bodyPoint } from '../vis/sight.js';

export function updateSentries(world, dt) {
  for (const s of world.sentries) {
    if (s.ammo <= 0) continue;
    const S = s.spec ?? SENTRY;
    s.cool -= dt;
    if (s.cool > 0) continue;
    let target = null;
    let best = Infinity;
    for (const a of world.aliens) {
      if (!a.alive || a.state === 'vent' || a.state === 'dormant') continue;
      const c = bodyPoint(a, 0.5);
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d > S.RANGE || d >= best || !world.physics.los(s.x, s.y, c.x, c.y)) continue;
      best = d;
      target = a;
    }
    if (!target) { s.cool = 0.25; continue; }
    const c = bodyPoint(target, 0.5);
    s.facing = Math.sign(c.x - s.x) || s.facing;
    s.ammo--;
    s.cool = 1 / S.RATE;
    const hit = world.sentryRng.chance(S.HIT);
    const x1 = hit ? c.x : c.x + world.sentryRng.float(-0.8, 0.8);
    const y1 = hit ? c.y : c.y + world.sentryRng.float(-0.6, 0.9);
    world.noise(s.x, s.y, S.NOISE);
    world.emit('sentry-shot', { sentry: s, x0: s.x + s.facing * 0.5, y0: s.y, x1, y1, hit });
    if (hit) world.damage(target, world.sentryRng.int(S.DAMAGE[0], S.DAMAGE[1]), s, { x: c.x, y: c.y, dx: s.facing, dy: 0, stagger: 0.15 });
    if (s.ammo <= 0) world.emit('sentry-dry', { sentry: s });
  }
}
